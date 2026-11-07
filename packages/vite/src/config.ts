/**
 * Plugin configuration, see `PluginOptions` in `@memebattle/build-conditions`.
 * A port of `Config::validate` from `packages/swc/src/lib.rs`.
 */
export interface ResolvedConfig {
    /** Condition value → its group name */
    valueToGroup: Map<string, string>;
    /** Group → fixed value (null — the group is switched at runtime) */
    conditions: Map<string, string | null>;
    /** Sorted group names, listed in the unknown-value error */
    groupNames: string[];
}

const SHAPE_ERROR =
    'build-conditions: options must be { groups: { [group]: string[] }, conditions: { [group]: string | null } }';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }

    const proto: unknown = Object.getPrototypeOf(value);

    return proto === Object.prototype || proto === null;
}

/**
 * Validates the configuration and builds the "condition value → its group" map.
 *
 * Checked invariants (the messages are the ones of the Rust plugin):
 * - the group sets in `groups` and `conditions` match;
 * - condition values are unique across groups;
 * - a fixed value belongs to its group.
 *
 * Groups are iterated in sorted key order, as the Rust `BTreeMap` does, so the
 * first reported error is the same in both plugins.
 */
export function resolveConfig(options: unknown): ResolvedConfig {
    // The counterpart of serde rejecting a config of the wrong shape
    if (!isPlainObject(options) || !isPlainObject(options.groups) || !isPlainObject(options.conditions)) {
        throw new Error(SHAPE_ERROR);
    }

    const groups = options.groups;
    const conditions = options.conditions;

    for (const values of Object.values(groups)) {
        if (!Array.isArray(values) || !values.every(value => typeof value === 'string')) {
            throw new Error(SHAPE_ERROR);
        }
    }

    for (const chosen of Object.values(conditions)) {
        if (chosen !== null && typeof chosen !== 'string') {
            throw new Error(SHAPE_ERROR);
        }
    }

    const valueToGroup = new Map<string, string>();

    for (const group of Object.keys(groups).sort()) {
        if (!Object.hasOwn(conditions, group)) {
            throw new Error(`build-conditions: group '${group}' is present in groups but missing from conditions`);
        }

        for (const value of groups[group] as string[]) {
            const other = valueToGroup.get(value);

            if (other !== undefined) {
                throw new Error(
                    `build-conditions: value '${value}' belongs to two groups at once ('${other}' and '${group}'), values must be unique across groups`
                );
            }

            valueToGroup.set(value, group);
        }
    }

    const groupNames = Object.keys(conditions).sort();
    const resolvedConditions = new Map<string, string | null>();

    for (const group of groupNames) {
        const chosen = conditions[group] as string | null;

        if (!Object.hasOwn(groups, group)) {
            throw new Error(`build-conditions: group '${group}' is present in conditions but missing from groups`);
        }

        if (chosen !== null && !(groups[group] as string[]).includes(chosen)) {
            throw new Error(`build-conditions: value '${chosen}' does not belong to group '${group}'`);
        }

        resolvedConditions.set(group, chosen);
    }

    return { valueToGroup, conditions: resolvedConditions, groupNames };
}
