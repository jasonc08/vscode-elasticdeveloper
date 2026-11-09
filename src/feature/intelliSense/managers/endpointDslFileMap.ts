'use strict'

/**
 * Maps an `rest-api-spec` endpoint key (e.g. `indices.get_mapping`) to the
 * file name that holds its Query DSL graph in `resources/<version>/endpoints/`
 * (e.g. `_mappings`).
 *
 * The two sets of names were never kept in sync in the shipped resources, so
 * resolving a key by its own file name used to miss almost every endpoint and
 * left the body completion without a graph to work from.
 */

const EndpointDslFileMap: { [endpointId:string]: string } = {
    // indices / mapping / settings / analysis
    'indices.get_mapping': '_mappings',
    'indices.put_mapping': '_mappings',
    'indices.get_field_mapping': '_mappings',
    'indices.create': '_index_settings',
    'indices.get_settings': '_index_settings',
    'indices.put_settings': '_index_settings',
    'indices.analyze': '_index_analysis',
    'indices.put_alias': '_aliases',
    'indices.get_alias': '_aliases',
    'indices.delete_alias': '_aliases',
    'indices.update_aliases': '_aliases',
    'indices.put_template': '_index_settings',
    'indices.validate_query': '_query_dsl',
    'indices.rollover': '_index_settings',
    'indices.shrink': '_index_settings',
    'indices.split': '_index_settings',
    'indices.upgrade': '_index_settings',

    // search family
    'search': 'search',
    'count': 'count',
    'explain': 'explain',
    'field_caps': 'field_caps',
    'rank_eval': 'rank_eval',
    'search_template': 'search_template',
    'render_search_template': 'render_search_template',
    'msearch': 'msearch',
    'msearch_template': 'msearch_template',

    // document CRUD / scroll / mget / terms
    'index': 'index',
    'create': 'create',
    'update': 'update',
    'bulk': 'bulk',
    'mget': 'mget',
    'scroll': 'scroll',
    'clear_scroll': 'clear_scroll',
    'termvectors': 'termvectors',
    'mtermvectors': 'mtermvectors',
    'reindex': 'reindex',
    'update_by_query': 'update_by_query',
    'delete_by_query': 'delete_by_query',

    // ingest / script
    'ingest.put_pipeline': 'ingest.put_pipeline',
    'ingest.simulate': 'ingest.simulate',
    'put_script': 'put_script',

    // cluster
    'cluster.allocation_explain': 'cluster.allocation_explain',
    'cluster.put_settings': 'cluster.put_settings',
    'cluster.reroute': 'cluster.reroute',

    // snapshot
    'snapshot.create': 'snapshot.create',
    'snapshot.create_repository': 'snapshot.create_repository',
    'snapshot.restore': 'snapshot.restore'
};

/**
 * Returns the Query DSL file names to try for an endpoint key, most specific
 * first. The endpoint key itself is always a candidate so that resources which
 * do follow the naming convention keep working.
 */
export function getDslFileCandidates(endpointId:string): string[] {

    let candidates:string[] = [];

    if(!endpointId) {
        return candidates;
    }

    if(endpointId.startsWith('endpoint_')) {
        endpointId = endpointId.replace('endpoint_', '');
    }

    candidates.push(endpointId);

    let mapped = EndpointDslFileMap[endpointId];

    if(mapped && candidates.indexOf(mapped) === -1) {
        candidates.push(mapped);
    }

    // Shared query dsl graph used as a last resort for search-like endpoints.
    if(candidates.indexOf('_query_dsl') === -1) {
        candidates.push('_query_dsl');
    }

    return candidates;
}
