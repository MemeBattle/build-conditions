/**
 * Condition groups of the fixtures, for the typed plugin options in the tests.
 * The same augmentation as `packages/core/src/testGroups.d.ts`.
 */
import '@memebattle/build-conditions';

declare module '@memebattle/build-conditions' {
    interface BuildConditionGroups {
        platform: 'desktop' | 'mobile';
        runtime: 'server' | 'client';
    }
}
