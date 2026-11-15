import type { Condition, UniqueConditionValuesGuard, UniqueGroups } from './types';
import { getBuildConditions } from './storage';

/**
 * Checks whether the given conditions are active. Accepts either a single
 * condition string or an array of conditions — in the latter case returns
 * `true` only when all of them are active at once.
 *
 * The group name is not specified — it is unambiguously derived from the
 * value, because condition values are unique across groups.
 *
 * Without the SWC plugin the check runs at runtime via `getBuildConditions()`
 * and throws when conditions are not set. When building with fixed conditions,
 * the SWC plugin folds the call into `true` / `false`.
 */
export function isBuildConditions(condition: Condition & UniqueConditionValuesGuard): boolean;
export function isBuildConditions<const L extends readonly Condition[]>(
    conditions: L & UniqueGroups<L> & UniqueConditionValuesGuard
): boolean;
export function isBuildConditions(conditions: Condition | readonly Condition[]): boolean {
    const active = getBuildConditions();
    const activeValues: unknown[] = Object.values(active);
    const list = Array.isArray(conditions) ? conditions : [conditions];

    return list.every(condition => activeValues.includes(condition));
}
