'use strict'

/**
 * Object helpers.
 *
 * Node's `util.isObject` and `util.isArray` are deprecated. VS Code ships its
 * own Node/Electron runtime and those helpers can be missing (or removed) on
 * newer versions, which used to break the intelliSense graph loading with a
 * `TypeError: isObject is not a function`. These local replacements do not
 * depend on the host runtime.
 */

export function isArray(value:any): value is any[] {
    return Array.isArray(value);
}

export function isObject(value:any): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
