'use strict'

import * as vscode from 'vscode';
import * as constant from '../../../constant';
import * as fs from 'fs';
import * as path from 'path'

import { Graph, Node, Edge } from "../../../models/graph";
import { Version } from '../../../models/version';
import { LogManager } from '../../../managers/logManager';
import { EnvironmentManager } from '../../../managers/environmentManager';
import { isArray, isObject } from '../../../helpers/object';
import { IEndpoint } from '../models/IEndpoint';
import { getDslFileCandidates } from './endpointDslFileMap';

var _intellisenseGraphManager:IntellisenseGraphManager;

export class IntellisenseGraphManager {
    private _endpoints:any;
    private _graphs:any;
    private _versionNumber:string

    public static get(): IntellisenseGraphManager {

        if(!_intellisenseGraphManager) {
            _intellisenseGraphManager = new IntellisenseGraphManager();
        }

        return _intellisenseGraphManager;
    }

    constructor() {
        this._graphs = {};
        this._endpoints = {};

        EnvironmentManager.subscribe((eventName) => {
            if(eventName === 'environment.changed') {

                this._versionNumber = null;
                this._endpoints = {};
                this._graphs = {};
                LogManager.info(false, 'cleared intellisense graphs and enpoints');
            }
        });
    }

    public get versionNumber():string {
        return this._versionNumber;
    }

    public get graphs():any {
        return this._graphs;
    }

    public getGraphWithMethod(method:string): Graph {
        let key = 'method_' + method.toLowerCase();

        if(!this._graphs[key]) {
            this.loadEndpointGraphs();
        }

        return this._graphs[key];
    }

    public getEndpointWithId(endpointId:string): IEndpoint {
        return this._endpoints[endpointId];
    }

    public getGraphWithEndpointId(endpointId:string): Graph {

        if(!this._graphs[endpointId]) {
            this.loadGraphWithEndpointId(endpointId);
        }

        return this._graphs[endpointId];
    }

    private loadGraphWithEndpointId(endpointId:string) {

        let graph = new Graph();
        let files:string[] =[];
        let imported:string[] = [];
        let endpointFile = this.getEndpointFile(endpointId);

        if(endpointFile) {
            files.push(endpointFile);

            // Collect every `__children_of` target before loading anything: a file
            // can reference a fragment that lives in another imported file, so the
            // reference set has to be known up front.
            let childrenOfTargets = this.collectChildrenOfTargets(files);

            while(files.length > 0){
                let file = files.pop();

                if(!imported.find(f=> f === file)) {
                    imported.push(file);

                    const fileContent = fs.readFileSync(file, 'utf-8');
                    let source = JSON.parse(fileContent);
                    let keys = Object.keys(source);

                    for(let key of keys) {
                        if(key === ("__import_file")) {

                            if(isArray(source[key])) {
                                for(let importFile of source[key]) {
                                    importFile = this.getEndpointFile(importFile);

                                    if(importFile) {
                                        files.push(importFile);
                                    }
                                }
                            }

                        } else if(key.startsWith('__')) {
                            if(key !== '__inactive') {
                                if(key === '__templates' && isObject(source[key])) {
                                    // A template file can hold several shared fragments. The
                                    // endpoint body template (`index_mappings` for _mapping,
                                    // `search` for _search, ...) is the only one that becomes
                                    // top level; every other fragment is reachable through
                                    // `__children_of` and must stay out of the root.
                                    let templates = source[key];
                                    let templateNames = Object.keys(templates);
                                    let rootTemplate = templateNames.indexOf('index_mappings') > -1
                                        ? 'index_mappings'
                                        : null;

                                    for(let templateName of templateNames) {
                                        let template = templates[templateName];

                                        if(templateName === rootTemplate) {
                                            this.loadEndpointDslGraph(template, graph, 0);
                                        } else if(this.isChildrenOfTarget(templates, templateName) ||
                                                  childrenOfTargets.has(templateName)) {
                                            // Referenced by `__children_of` (possibly from another
                                            // imported file): load it under the template name so
                                            // the reference resolves, and keep it out of the
                                            // root by using a depth that is never zero.
                                            this.loadEndpointDslGraph(template, graph, 100, templateName);
                                        } else {
                                            this.loadEndpointDslGraph(template, graph, 100);
                                        }
                                    }
                                } else {
                                    this.loadEndpointDslGraph(source[key], graph, 100);
                                }
                            }
                            delete source[key];
                        }
                    }

                    this.loadEndpointDslGraph(source, graph);
                }
            }

            let nodes = graph.getNodes();
            graph.addNode('root', 'root', { depth:-1, types:["object"]});

            for(let node of nodes) {
                node.data.isDynamicNode = node.label.endsWith('}');

                if(node.data.depth === 0) {
                    node.data.types.forEach(t=> graph.addEdge('root', node.id, null, t));
                }
            }

            this.composeChildrenOf(graph);

            // Engine/version specific fields (7.x, 8.x, OpenSearch) are not part of
            // the bundled 6.x DSL files, so they are layered on afterwards.
            this.applyOverlays(graph, path.basename(endpointFile, '.json'));

            // Overlays can reference shared fragments through `__children_of` as
            // well, so the composition has to run once more.
            this.composeChildrenOf(graph);

            this.addQueryAliases(graph);

            this._graphs[endpointId] = graph;

            LogManager.verbose('loaded graph %s with %s nodes and %s edges', endpointId, graph.getNodes().length, graph.getEdges().length);
        }
    }

    /**
     * Copies the nodes reached through `__children_of` onto the referencing node,
     * so `query: { __children_of: "query_dsl" }` exposes every query type.
     */
    private composeChildrenOf(graph:Graph) {

        let edges = graph.findEdges(edge=> edge.kind === 'children_of');

        for(let edge of edges) {
            let incomingEdges = graph.findEdges(e=> e.targetId == edge.sourceId && e.kind !== 'children_of');

            if(incomingEdges.length > 0) {
                let stack:Edge[] = graph.findEdges(e=> e.sourceId == edge.sourceId && e.kind === 'children_of');
                let children:string[] = [];
                let visited:string[] = [];

                while(stack.length > 0) {
                    let current = stack.pop();

                    if(!visited.find(v => v === current.targetId)) {
                        visited.push(current.targetId);

                        if(current.kind === 'children_of') {
                            let childrenOfEdges = graph.getEdgesWithSourceId(current.targetId);
                            childrenOfEdges.forEach(e => stack.push(e));
                        } else {
                            children.push(current.targetId);
                        }

                    }

                }

                for(let childNodeId of children) {
                    let child = graph.getNodeWithId(childNodeId);

                    if(child && child.data && child.data.types) {
                        child.data.types.forEach(t=>
                            graph.addEdge(edge.sourceId, child.id, null, t)
                        );
                    }
                }
            }
        }
    }

    /**
     * Layers the engine/version specific additions (Elasticsearch 7.x and 8.x,
     * OpenSearch) on top of a graph that was built from the bundled 6.x files.
     *
     * Overlay format:
     * {
     *   "graphs": {
     *     "*": { "<label>/<path>": { .. DSL .. } },   // applies to every graph
     *     "search": { "root": { .. DSL .. }, "query": { .. DSL .. } },
     *     "_mappings": { "{_doc}": { .. DSL .. } }
     *   }
     * }
     *
     * The key is a label path starting at the graph root. A missing path is not an
     * error: the same overlay is shared by many endpoints.
     */
    private applyOverlays(graph:Graph, dslFileName:string) {

        for(let overlayFile of this.getOverlayFiles()) {

            let overlay:any;

            try {
                overlay = JSON.parse(fs.readFileSync(overlayFile, 'utf-8'));
            } catch(ex) {
                LogManager.warning(false, 'failed to load intelliSense overlay %s', overlayFile);
                continue;
            }

            let graphs = overlay.graphs || {};
            let sections:any[] = [];

            if(graphs['*']) {
                sections.push(graphs['*']);
            }

            if(graphs[dslFileName]) {
                sections.push(graphs[dslFileName]);
            }

            for(let section of sections) {

                for(let labelPath of Object.keys(section)) {

                    let target = this.findNodeByLabelPath(graph, labelPath);

                    if(!target) {
                        continue;
                    }

                    this.mergeOverlaySection(graph, target, section[labelPath]);
                }
            }
        }

        for(let node of graph.getNodes()) {
            if(node.data && node.data.isDynamicNode === undefined) {
                node.data.isDynamicNode = node.label.endsWith('}');
            }
        }
    }

    /**
     * Adds the overlay fields to `target`, descending into fields that already
     * exist so a newer overlay can extend what an older one contributed (e.g. the
     * OpenSearch 3 additions to the `knn` query introduced by OpenSearch 2).
     */
    private mergeOverlaySection(graph:Graph, target:Node, section:any) {

        if(!section || typeof section !== 'object') {
            return;
        }

        let existing: { [label:string]: Node } = {};

        graph.getEdgesWithSourceId(target.id).forEach(e=> {
            let node = graph.getNodeWithId(e.targetId);

            if(node) {
                existing[node.label] = node;
            }
        });

        let additions:any = {};
        let depth = target.data && target.data.depth >= 0 ? target.data.depth + 1 : 0;

        for(let field of Object.keys(section)) {

            let value = section[field];
            let existingNode = existing[field];

            if(!existingNode) {
                additions[field] = value;
                continue;
            }

            // Only object-like nodes can be extended; scalars and arrays keep the
            // definition that is already there.
            if(value && typeof value === 'object' && !isArray(value) && !value.__as_type) {
                this.mergeOverlaySection(graph, existingNode, value);
            }
        }

        if(Object.keys(additions).length > 0) {
            this.loadEndpointDslGraph(additions, graph, depth, target.id);
        }
    }

    private findNodeByLabelPath(graph:Graph, labelPath:string):Node {

        let current:any = graph.getNodeWithId('root');

        if(!current) {
            return null;
        }

        if(!labelPath || labelPath === 'root' || labelPath === '$') {
            return current;
        }

        for(let label of labelPath.split('/')) {

            let next:any = null;

            for(let edge of graph.getEdgesWithSourceId(current.id)) {
                let node = graph.getNodeWithId(edge.targetId);

                if(node && node.label === label) {
                    next = node;
                    break;
                }
            }

            if(!next) {
                return null;
            }

            current = next;
        }

        return current;
    }

    private getOverlayFiles():string[] {
        return this.getOverlayFilesWithSuffix('.json');
    }

    private getOverlayEndpointFiles():string[] {
        return this.getOverlayFilesWithSuffix('.endpoints.json');
    }

    /**
     * Overlays are cumulative: a 7.x cluster keeps everything added in 6.x, and
     * OpenSearch 2.x keeps the 1.x additions.
     *
     * Elasticsearch is only supported up to 7.10 - everything newer is
     * OpenSearch, which is versioned separately (1.x / 2.x / 3.x).
     *
     * File names are `<engine>-<version><suffix>` where `<version>` is a major
     * version (`opensearch-3.json`) or a full one (`opensearch-3.2.json`). Major
     * overlays are applied first, then the minor ones, oldest to newest, so that
     * a minor overlay can refine what its major overlay added.
     */
    private getOverlayFilesWithSuffix(suffix:string):string[] {

        let engine = this.getEngine();
        let major = this.getMajorVersion();
        let minor = this.getMinorVersion();

        let extension = vscode.extensions.getExtension(constant.ExtensionId);
        let files:string[] = [];

        if(!extension) {
            return files;
        }

        let overlaysFolder = path.join(extension.extensionPath, 'resources', 'overlays');

        if(!fs.existsSync(overlaysFolder)) {
            return files;
        }

        let enginePrefix = engine + '-';
        let knownVersions = fs.readdirSync(overlaysFolder)
            .filter(f=> f.startsWith(enginePrefix) && f.endsWith(suffix))
            .map(f=> f.substring(enginePrefix.length, f.length - suffix.length))
            .filter(v=> /^\d+(\.\d+)*$/.test(v))
            .sort((a, b)=> this.compareVersions(a, b));

        if(knownVersions.length === 0) {
            return files;
        }

        // Without an explicit version on the environment, apply everything that
        // ships for this engine. Overlays are cumulative, so applying the newest
        // one only would leave out what the earlier ones added.
        let latestMajor = parseInt(knownVersions[knownVersions.length - 1].split('.')[0], 10);
        let targetMajor = (minor === null || minor === undefined) ? latestMajor : major;

        if(engine !== constant.EngineOpenSearch) {
            // Last Elasticsearch version this extension knows about.
            targetMajor = Math.min(targetMajor, constant.LastElasticsearchMajorVersion);
        }

        for(let version of knownVersions) {

            let parts = version.split('.');
            let versionMajor = parseInt(parts[0], 10);

            if(versionMajor > targetMajor) {
                continue;
            }

            // Minor overlays only make sense for the major version in use.
            if(parts.length > 1) {

                if(versionMajor !== targetMajor) {
                    continue;
                }

                if(minor !== null && minor !== undefined && parseInt(parts[1], 10) > minor) {
                    continue;
                }
            }

            files.push(path.join(overlaysFolder, enginePrefix + version + suffix));
        }

        return files;
    }

    private compareVersions(a:string, b:string):number {

        let left = a.split('.').map(n=> parseInt(n, 10) || 0);
        let right = b.split('.').map(n=> parseInt(n, 10) || 0);
        let length = Math.max(left.length, right.length);

        for(let i = 0; i < length; i++) {
            let diff = (left[i] || 0) - (right[i] || 0);

            if(diff !== 0) {
                return diff;
            }
        }

        return 0;
    }

    private getEngine():string {

        let environment = EnvironmentManager.get().environment;

        if(environment && environment.hasEngine) {
            return environment.engine;
        }

        return constant.EngineElasticsearch;
    }

    private getMajorVersion():number {

        let environment = EnvironmentManager.get().environment;

        if(environment && environment.hasVersion) {
            return environment.version.major;
        }

        return Version.parse(constant.DefaultVersion).major;
    }

    private getMinorVersion():number {

        let environment = EnvironmentManager.get().environment;

        if(environment && environment.hasVersion) {
            let minor = environment.version.minor;
            return minor === null || minor === undefined ? null : minor;
        }

        return Version.parse(constant.DefaultVersion).minor;
    }

    /**
     * Elasticsearch accepts a few short names for long standing body fields.
     * The shipped spec only documents the canonical one, so the alias is mirrored
     * onto the graph to keep it discoverable through completion.
     */
    private addQueryAliases(graph:Graph) {

        let aliases:{ [alias:string]: string } = {
            'aggs': 'aggregations'
        };

        for(let alias of Object.keys(aliases)) {

            let canonical = aliases[alias];
            let canonicalNode = graph.findNode(n=> n.label === canonical && n.data && n.data.depth === 0);

            if(!canonicalNode || graph.findNode(n=> n.label === alias && n.data && n.data.depth === 0)) {
                continue;
            }

            let aliasId = alias;

            graph.addNode(aliasId, alias, {
                ...canonicalNode.data,
                id: alias,
                aliasOf: canonical
            });

            let canonicalEdges = graph.getEdgesWithSourceId(canonicalNode.id);

            for(let edge of canonicalEdges) {
                graph.addEdge(aliasId, edge.targetId, null, edge.kind);
            }

            if(canonicalNode.data.types) {
                canonicalNode.data.types.forEach(t=> graph.addEdge('root', aliasId, null, t));
            }
        }
    }

    /**
     * Walks the endpoint file and everything it imports, collecting every id that
     * is referenced through `__children_of`.
     */
    private collectChildrenOfTargets(startFiles:string[]): Set<string> {

        let targets = new Set<string>();
        let pending = startFiles.slice();
        let visited:string[] = [];

        while(pending.length > 0) {

            let file = pending.pop();

            if(!file || visited.indexOf(file) > -1) {
                continue;
            }

            visited.push(file);

            let source:any;

            try {
                source = JSON.parse(fs.readFileSync(file, 'utf-8'));
            } catch(ex) {
                continue;
            }

            this.collectChildrenOfTargetsFrom(source, targets);

            if(isArray(source.__import_file)) {
                for(let importName of source.__import_file) {
                    let importedFile = this.getEndpointFile(importName);

                    if(importedFile) {
                        pending.push(importedFile);
                    }
                }
            }
        }

        return targets;
    }

    private collectChildrenOfTargetsFrom(node:any, targets:Set<string>) {

        if(!node || typeof node !== 'object') {
            return;
        }

        if(isArray(node)) {
            for(let entry of node) {
                this.collectChildrenOfTargetsFrom(entry, targets);
            }
            return;
        }

        let childrenOf = node.__children_of;

        if(isArray(childrenOf)) {
            for(let id of childrenOf) {
                if(typeof id === 'string') {
                    targets.add(id);
                }
            }
        } else if(typeof childrenOf === 'string') {
            targets.add(childrenOf);
        }

        for(let key of Object.keys(node)) {
            if(key !== '__children_of') {
                this.collectChildrenOfTargetsFrom(node[key], targets);
            }
        }
    }

    private isChildrenOfTarget(templates:any, templateName:string):boolean {

        for(let name of Object.keys(templates)) {
            let template = templates[name];

            if(!template || typeof template !== 'object') {
                continue;
            }

            let childrenOf = template.__children_of;

            // `__children_of` can be a single id or an array of ids.
            if(isArray(childrenOf) && childrenOf.indexOf(templateName) > -1) {
                return true;
            }

            if(childrenOf === templateName) {
                return true;
            }
        }

        return false;
    }

    private loadEndpointDslGraph(source, graph:Graph, startDepth:number = 0, rootId:string = null) {

        // When the fragment is referenced through `__children_of`, the reference
        // points at the fragment itself (e.g. `mappings_properties`). Create that
        // node so the reference can be resolved during graph composition.
        if(rootId && isObject(source) && !graph.getNodeWithId(rootId)) {
            graph.addNode(rootId, rootId, { depth: startDepth - 1, types: ['object'] });
        }

        let stack:any[] = [];
        stack.push( {
            source: source,
            path: rootId,
            types: [],
            depth: startDepth
        });

        while(stack.length > 0) {
            let context = stack.pop();
            let source = context.source;
            let path = context.path;

            if(isArray(source)) {
                this.addArrayNodeToEndpointDslGraph(source, path, null, null, context, stack, graph);
            } else if(isObject(source)) {

                let keys = Object.keys(source);

                for(let key of keys) {
                    let current = source[key];
                    let types:string[] = []

                    if(!key.startsWith('__')) {

                        let nodeId = path + '/' + key;

                        if(path == null) {
                            nodeId = key;
                        }

                        if(isArray(current)) {

                            this.addArrayNodeToEndpointDslGraph(current, path, nodeId, key, context, stack, graph);

                        } else if(isObject(current)) {

                            let currentObject:any = current;
                            let type = 'object';

                            if(currentObject.__as_type) {

                                if(isArray(currentObject.__as_type)) {
                                    currentObject.__as_type.forEach(t=> types.push(t));
                                } else {
                                    types.push(currentObject.__as_type);
                                }
                            } else {
                                types.push(type);
                            }

                            if(currentObject.__array || currentObject.__object || currentObject.__string) {

                                if(currentObject.__array) {

                                    graph.addNode(nodeId + '-array', key, {
                                        id: key,
                                        types: ['array'],
                                        depth: context.depth
                                    });

                                    graph.addEdge(path, nodeId + '-array', null, 'array');
                                    stack.push({ source: currentObject.__array, path: nodeId + '-array', types: ['array'], depth: context.depth + 1});
                                }

                                if(currentObject.__object) {

                                    graph.addNode(nodeId + '-object', key, {
                                        id: key,
                                        types: ['object'],
                                        depth: context.depth
                                    });

                                    graph.addEdge(path, nodeId + '-object', null, 'object');
                                    stack.push({ source:currentObject.__object, path: nodeId + '-object', types: ['object'], depth: context.depth + 1});
                                }

                                if(currentObject.__string) {

                                    graph.addNode(nodeId + '-string', key, {
                                        id: key,
                                        types: ['string'],
                                        depth: context.depth
                                    });

                                    graph.addEdge(path, nodeId + '-string', null, 'string');
                                    stack.push({ source:currentObject.__string, path: nodeId + '-string', types: ['string'], depth: context.depth + 1});
                                }

                            } else {
                                stack.push({ source:current, path: nodeId, types: types, depth: context.depth + 1});

                                graph.addNode(nodeId, key, {
                                    id: key,
                                    types: types,
                                    depth: context.depth
                                });

                                types.forEach(t=>
                                    graph.addEdge(path, nodeId, null, t)
                                );
                            }

                        } else {

                            let type = typeof(current);
                            let defaultValue = current;

                            types.push(type);

                            graph.addNode(nodeId, key, {
                                id: key,
                                defaultValue: defaultValue,
                                types: types,
                                depth:context.depth
                            });

                            types.forEach(t=>
                                graph.addEdge(path, nodeId, null, type)
                            );

                        }

                    } else if(key === '__children_of') {

                        if(isArray(current)) {

                            for(let c of current) {
                                graph.addEdge(path, c, null, 'children_of');
                            }

                        } else {
                            graph.addEdge(path, current, null, 'children_of');
                        }
                    }
                }
            } else {
                console.log('is not an object...');
            }
        }
    }

    private addArrayNodeToEndpointDslGraph(array:any[], path:string, nodeId:string, nodeLabel:string, context:any, stack:any[] , graph:Graph) {

        if(array.length > 0) {

            if(!nodeId) {
                nodeId = path;
            } else {
                graph.addNode(nodeId, nodeLabel, { types: ['array'], depth: context.depth});
                graph.addEdge(path, nodeId, null, 'array');
            }

            for(let index = 0; index < array.length;index++) {
                let arrayEntry =  array[index];
                let arrayEntryTypes:string[] = []
                let id = '['+ index +']';
                let arrayEntryNodeId = nodeId +'/['+ index +']';
                let depth = context.depth + 1;

                if(isObject(arrayEntry)) {

                    let arrayEntryObject:any = arrayEntry;
                    let arrayEntryType = 'object';

                    if(arrayEntryObject.__as_type) {

                        if(isArray(arrayEntryObject.__as_type)) {
                            arrayEntryObject.__as_type.forEach(t=> arrayEntryTypes.push(t));
                        } else {
                            arrayEntryTypes.push(arrayEntryObject.__as_type);
                        }

                    } else {
                        arrayEntryTypes.push(arrayEntryType);
                    }

                    graph.addNode(arrayEntryNodeId, '[0]', {
                        id: id,
                        types: arrayEntryTypes,
                        depth: depth
                    });

                    arrayEntryTypes.forEach(t=>
                        graph.addEdge(nodeId, arrayEntryNodeId, null, t)
                    );

                    stack.push({ source:arrayEntry, path: arrayEntryNodeId, depth: depth});

                } else {
                    let type = typeof(arrayEntry);

                    graph.addNode(arrayEntryNodeId, id, {
                        id: id,
                        types: [type],
                        defaultValue: arrayEntry.toString(),
                        depth: depth
                    });

                    graph.addEdge(nodeId, arrayEntryNodeId, null, type);
                }
            }
        }
    }

    private loadEndpointGraphs() {

        let definitions:{ endpointId:string, endpoint:IEndpoint, params:any }[] = [];
        let files = this.getEndpointSpecificationFiles();

        for(let file of files) {

            const fileContent = fs.readFileSync(file, 'utf-8');
            let source = JSON.parse(fileContent);
            let endpointId = Object.keys(source)[0];

            definitions.push({
                endpointId: endpointId,
                endpoint: source[endpointId],
                params: source.params || {}
            });
        }

        // OpenSearch plugins (`_plugins/*`) are not part of the bundled
        // rest-api-spec, so they are contributed through overlay files.
        for(let file of this.getOverlayEndpointFiles()) {

            try {
                const fileContent = fs.readFileSync(file, 'utf-8');
                let source = JSON.parse(fileContent);
                let params = source.params || {};

                for(let endpointId of Object.keys(source)) {

                    if(endpointId === 'params') {
                        continue;
                    }

                    let endpoint = source[endpointId];

                    if(!endpoint || !endpoint.methods || !endpoint.url || !endpoint.url.paths) {
                        continue;
                    }

                    definitions.push({ endpointId: endpointId, endpoint: endpoint, params: params });
                }
            } catch(ex) {
                LogManager.warning(false, 'failed to load endpoint overlay %s', file);
            }
        }

        for(let definition of definitions) {
            this.addEndpointToMethodGraphs(definition.endpointId, definition.endpoint);
        }

        let graphNames = Object.keys(this._graphs);

        for(let definition of definitions) {

            let parameterNames = Object.keys(definition.params || {});

            if(parameterNames.length === 0) {
                continue;
            }

            for(let graphName of graphNames) {
                if(graphName.startsWith('method_')) {
                    let graph = this._graphs[graphName] as Graph;
                    let nodes = graph.findNodes(n=> n.data.kind === 'endpoint');

                    for(let node of nodes) {

                        for(let name of parameterNames) {
                            let parameter = definition.params[name];
                            let parameterId = node.id + '/' + name;
                            graph.addNode(parameterId, name, {
                                kind: 'parameter',
                                ...parameter
                             });
                            graph.addEdge(node.id, parameterId);
                        }
                    }
                }
            }
        }

        let keys = Object.keys(this._graphs);

        for(let key of keys) {

            if(key.startsWith('method_')) {

                let graph = this._graphs[key] as Graph;
                let nodes = graph.getNodes();
                let edges = graph.getEdges();

                for(let node of nodes) {
                    node.data.isDynamicNode = node.label.endsWith('}');
                }

                LogManager.verbose('loaded graph %s with %s nodes and %s edges',key, nodes.length, edges.length);
            }
        }
    }

    private addEndpointToMethodGraphs(endpointId:string, endpoint:IEndpoint) {

        if(!endpointId || !endpoint || !endpoint.methods) {
            return;
        }

        let graphEndpointId = 'endpoint_' + endpointId;
        this._endpoints[graphEndpointId] = endpoint;

        for(let method of endpoint.methods) {

            let key = 'method_' + method.toLowerCase();

            if(!this._graphs[key]) {
                this._graphs[key] = new Graph();
            }

            let graph = this._graphs[key];

            graph.addNode(graphEndpointId, graphEndpointId, { kind: 'endpoint' });

            if(endpoint.url && endpoint.url.params) {
                let parameterNames = Object.keys(endpoint.url.params);

                for(let name of parameterNames) {
                    let parameter = endpoint.url.params[name];
                    let parameterId = graphEndpointId + '/' + name;
                    graph.addNode(parameterId, name, {
                        kind: 'parameter',
                        ...parameter
                     });
                    graph.addEdge(graphEndpointId, parameterId);
                }

            }

            for(let path of endpoint.url.paths) {
                let steps:string[] = path.split('/').splice(1);
                let previousStepId:any = null;

                for(let index = 0; index < steps.length; index++) {
                    let step = steps[index];
                    let stepId = step;

                    if(stepId.length == 0 && steps.length == 1) {
                        stepId = '/';
                        step = '/';
                    }

                    if(previousStepId) {
                        stepId = previousStepId + '/'+ step;
                    }

                    graph.addNode(stepId, step, { kind: 'step' });

                    if(index == steps.length - 1) {
                        graph.addEdge(stepId, graphEndpointId);
                    }

                    if(previousStepId) {
                        graph.addEdge(previousStepId, stepId);
                    }

                    previousStepId = stepId;
                }
            }
        }
    }

    private getEndpointSpecificationFiles():string[] {

        let files:string[] = [];
        let extension = vscode.extensions.getExtension(constant.ExtensionId);
        let versionNumber = this.getVersionNumber();

        if(versionNumber) {

            let folderPath =  path.join(extension.extensionPath, 'resources', versionNumber, 'rest-api-spec');
            files = this.getFilesWithFolderPath(folderPath)
                                            .filter(f=> !f.endsWith('_common.json'))

            LogManager.verbose('found %s files for rest-api-spec version %s', files.length, versionNumber);
        }

        return files;
    }

    private getEndpointFile(endpointId:string):string {

        if(!endpointId) {
            return null;
        }

        let extension = vscode.extensions.getExtension(constant.ExtensionId);
        let versionNumbers:string[] = [];
        let file:any = null;

        // Use the environment version when it has one; otherwise fall back to
        // the newest version available on disk.
        let versionNumber = this.getVersionNumber();

        if(versionNumber) {
            versionNumbers.push(versionNumber);
        } else {
            versionNumbers.push(this.getDefaultVersionNumber());

            // Fallback: try every version folder, newest first.
            let newest = this.getVersionFolders().sort((a, b)=> this.compareVersions(b, a));
            for(let v of newest) {
                versionNumbers.push(v);
            }
        }

        versionNumbers = versionNumbers.filter(v=> !!v);

        // The endpoint key from rest-api-spec (e.g. `indices.get_mapping`) does not
        // always match the Query DSL file name in `endpoints/` (e.g. `_mappings`),
        // so every candidate name is tried before giving up.
        let candidates = getDslFileCandidates(endpointId);

        for(let versionNumber of versionNumbers) {

            let folderPath = path.join(extension.extensionPath, 'resources', versionNumber, 'endpoints');

            for(let candidate of candidates) {

                let candidatePath = path.join(folderPath, candidate + '.json');

                if(fs.existsSync(candidatePath)) {
                    return candidatePath;
                }
            }
        }

        return file;
    }

    private getFilesWithFolderPath(folderPath:string, filterWithPrefix:string='', filterWithExtension:string = '.json') {

        let jsonFiles:string[] = [];

        if(fs.existsSync(folderPath)) {

            let files = fs.readdirSync(folderPath);

            for(let file of files) {
                const extension = path.extname(file);

                if(file.startsWith(filterWithPrefix)) {

                    if(extension === filterWithExtension) {
                        jsonFiles.push(
                            path.join(folderPath, file)
                        );
                    }
                }
            }
        }

        return jsonFiles;
    }

    private getVersionFolders():string[] {

        let extension = vscode.extensions.getExtension(constant.ExtensionId);

        if(!extension) {
            return [];
        }

        let folderPath = path.join(extension.extensionPath, 'resources');

        if(!fs.existsSync(folderPath)) {
            return [];
        }

        // Only folders named like a version are candidates; `overlays` lives here too.
        return fs.readdirSync(folderPath)
            .filter(f=> /^\d+(\.\d+)*$/.test(f))
            .filter(f=> fs.statSync(path.join(folderPath, f)).isDirectory());
    }

    private getNewestVersionWithEndpoints(folders:string[]):string {

        let extension = vscode.extensions.getExtension(constant.ExtensionId);

        if(!extension || folders.length === 0) {
            return null;
        }

        let withEndpoints = folders.filter(f=>
            fs.existsSync(path.join(extension.extensionPath, 'resources', f, 'endpoints'))
        );

        let candidates = withEndpoints.length > 0 ? withEndpoints : folders;

        let sorted = candidates.slice().sort((a, b)=> {
            let left = Version.parse(a);
            let right = Version.parse(b);

            return (left.major - right.major) ||
                ((left.minor || 0) - (right.minor || 0)) ||
                ((left.patch || 0) - (right.patch || 0));
        });

        return sorted[sorted.length - 1];
    }

    private getDefaultVersionNumber():string {

        let versionNumber:string = null;
        let version = Version.parse(constant.DefaultVersion);
        let folders = this.getVersionFolders();

        let closestVersion = Version.getClosest(version, folders);

        if(closestVersion) {
            versionNumber = closestVersion.toString();
        }

        return versionNumber;
    }

    private getVersionNumber():string {

        let versionNumber:string = null;

        if(this._versionNumber) {
            versionNumber = this._versionNumber;
        } else {
            let environment = EnvironmentManager.get().environment;
            let folders = this.getVersionFolders();

            if(environment && environment.hasVersion) {

                if(this.getEngine() === constant.EngineOpenSearch || environment.version.major >= 6) {
                    // 7.x/8.x and OpenSearch are not bundled as their own folders.
                    // They reuse the newest (6.5) endpoint files plus overlays, so the
                    // closest-version lookup must not drag the base back to 2.x/5.x.
                    versionNumber = this.getNewestVersionWithEndpoints(folders);
                } else {
                    let closestVersion = Version.getClosest(environment.version, folders);

                    if(closestVersion) {
                        versionNumber = closestVersion.toString();
                    }
                }

            } else if(environment) {
                LogManager.warning(false, 'failed getting version from environment %s', environment);

                let version = Version.parse(constant.DefaultVersion);
                LogManager.warning(false, 'using default version %s', version);
            }

            // Last resort: use the newest version that has endpoints when no
            // version could be determined above.
            if(!versionNumber) {
                versionNumber = this.getNewestVersionWithEndpoints(folders);
            }

        }

        if(!versionNumber) {
            LogManager.warning(false, 'failed getting versionNumber');
        } else {
            this._versionNumber = versionNumber;
        }

        return versionNumber;
    }
}