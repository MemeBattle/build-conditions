/* eslint-disable @typescript-eslint/no-explicit-any -- generic types over condition maps */

import type { BuildConditionGroups } from './index';

export type GroupName = keyof BuildConditionGroups;

/** Any condition value from any group */
export type Condition = BuildConditionGroups[GroupName];

/** Complete set of conditions: every group has a concrete value */
export type BuildConditions = {
    [G in GroupName]: BuildConditionGroups[G];
};

/** Partial set of conditions */
export type PartialBuildConditions = Partial<BuildConditions>;

export type AllowedValue = ((...args: any[]) => any) | Record<string, unknown>;

/**
 * Exotic React components (`memo`, `forwardRef`): their types are callable,
 * but at runtime `typeof` yields `'object'` for them, so the homogeneity
 * check classifies them as objects.
 */
type ExoticLike = { readonly $$typeof: symbol };

/** All values are functions */
type AllFunctions<M> = {
    [K in keyof M]: M[K] extends ExoticLike ? never : M[K] extends (...args: any[]) => any ? M[K] : never;
};

/** All values are objects */
type AllObjects<M> = {
    [K in keyof M]: M[K] extends ExoticLike
        ? M[K]
        : M[K] extends (...args: any[]) => any
          ? never
          : M[K] extends Record<string, unknown>
            ? M[K]
            : never;
};

/** Homogeneity: functions XOR objects (mixing within a single call is forbidden) */
export type Homogeneous<M> = M extends AllFunctions<M> ? M : M extends AllObjects<M> ? M : never;

/** All keys (except 'default') belong to exactly one condition group */
export type SingleGroup<M> = {
    [G in GroupName]: Exclude<keyof M, 'default'> extends BuildConditionGroups[G] ? M : never;
}[GroupName];

/** The group a condition value belongs to */
export type GroupOf<C extends Condition> = {
    [G in GroupName]: C extends BuildConditionGroups[G] ? G : never;
}[GroupName];

/** Array of conditions: at most one value per group */
export type UniqueGroups<L extends readonly Condition[]> = L extends readonly [
    infer Head extends Condition,
    ...infer Tail extends readonly Condition[],
]
    ? [Extract<Tail[number], BuildConditionGroups[GroupOf<Head>]>] extends [never]
        ? [UniqueGroups<Tail>] extends [never]
            ? never
            : L
        : never
    : L;

/** Values of every group except G */
type OtherGroupsValues<G extends GroupName> = BuildConditionGroups[Exclude<GroupName, G>];

/** Intersection of each group's values with the rest — must be never */
type DuplicateConditionValues = {
    [G in GroupName]: BuildConditionGroups[G] & OtherGroupsValues<G>;
}[GroupName];

/**
 * If group values overlap, the type resolves to an error string,
 * otherwise to BuildConditions. Used as a constraint on the public API.
 */
export type AssertUniqueConditionValues = [DuplicateConditionValues] extends [never]
    ? BuildConditions
    : 'Error: condition value is used in more than one group';

/**
 * Public API constraint: while group values are unique the type is transparent
 * (unknown in an intersection); once the invariant is violated the parameter
 * resolves to an error string and helper calls stop compiling.
 */
export type UniqueConditionValuesGuard = [DuplicateConditionValues] extends [never]
    ? unknown
    : 'Error: condition value is used in more than one group';

/** Configuration of the SWC and Vite plugins */
export interface PluginOptions {
    /**
     * Complete composition of condition groups: group → all of its values.
     * The plugin uses it to resolve a condition value to its group and to
     * tell a value from another group apart from a typo (build error).
     */
    groups: {
        [G in GroupName]: readonly BuildConditionGroups[G][];
    };
    /**
     * Chosen group values: a string means the group is fixed and its calls
     * are transformed, null means the group is switched at runtime.
     */
    conditions: {
        [G in GroupName]: BuildConditionGroups[G] | null;
    };
}

/**
 * Storage of the current build conditions.
 *
 * The package is not tied to a specific storage mechanism: the environment can
 * replace the storage via `setBuildConditionsStorage`. For example, a server
 * registers a storage backed by its own `AsyncLocalStorage` to isolate the
 * conditions of concurrent requests — without pulling `node:async_hooks` into
 * the package or into client bundles.
 */
export interface BuildConditionsStorage {
    get(): PartialBuildConditions | undefined;
    /**
     * Sets the conditions. A storage may not support direct writes (e.g. a
     * server-side one backed by `AsyncLocalStorage`, where conditions are set
     * only via `als.run`) — in that case `setBuildConditions` throws.
     */
    set?(conditions: PartialBuildConditions): void;
}
