/**
 * Extensible interface defining the condition groups.
 *
 * Consumers extend it via declaration merging:
 *
 * ```typescript
 * declare module '@memebattle/build-conditions' {
 *     interface BuildConditionGroups {
 *         platform: 'desktop' | 'mobile';
 *         runtime: 'server' | 'client';
 *     }
 * }
 * ```
 *
 * Condition values must be unique across all groups: a value is resolved
 * to its group (in types, at runtime, and in the SWC plugin) by the value
 * itself, not by a "group → value" pair.
 *
 * The interface is declared right in the entrypoint on purpose: TypeScript
 * module augmentation only merges with an interface declared in the module
 * being augmented and does not work through a re-export. The rest of the
 * package types live in ./types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface -- populated via declaration merging
export interface BuildConditionGroups {}

export type {
    GroupName,
    Condition,
    BuildConditions,
    PartialBuildConditions,
    AllowedValue,
    Homogeneous,
    SingleGroup,
    GroupOf,
    UniqueGroups,
    AssertUniqueConditionValues,
    UniqueConditionValuesGuard,
    PluginOptions,
    BuildConditionsStorage,
} from './types';
export { getBuildConditions, setBuildConditions, setBuildConditionsStorage } from './storage';
export { switchBuildCondition } from './switchBuildCondition';
export { isBuildConditions } from './isBuildConditions';
