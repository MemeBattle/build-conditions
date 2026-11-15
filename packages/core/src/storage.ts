import type { BuildConditionsStorage, PartialBuildConditions } from './types';

declare global {
    var __BUILD_CONDITIONS__: PartialBuildConditions | undefined;
}

/**
 * Default storage — a global variable. Suitable for the browser, tests and
 * Storybook: a single set of conditions exists in one context at a time.
 */
const defaultStorage: BuildConditionsStorage = {
    get: () => globalThis.__BUILD_CONDITIONS__,
    set: conditions => {
        globalThis.__BUILD_CONDITIONS__ = { ...globalThis.__BUILD_CONDITIONS__, ...conditions };
    },
};

let storage: BuildConditionsStorage = defaultStorage;

/** Replaces the conditions storage. Called once during environment initialization */
export function setBuildConditionsStorage(customStorage: BuildConditionsStorage): void {
    storage = customStorage;
}

/**
 * Test helper: restores the default storage and clears any conditions that
 * were set, so tests do not depend on execution order. Exported only from
 * the `testing` entrypoint.
 */
export function resetBuildConditionsStorage(): void {
    storage = defaultStorage;
    delete globalThis.__BUILD_CONDITIONS__;
}

/** Sets conditions in the current storage (the default one is a global variable) */
export function setBuildConditions(conditions: PartialBuildConditions): void {
    if (!storage.set) {
        throw new Error(
            'build-conditions: the current storage does not support setBuildConditions. ' +
                'Set conditions through the storage itself (e.g. via AsyncLocalStorage.run on the server)'
        );
    }

    storage.set(conditions);
}

/**
 * Returns the currently active conditions.
 *
 * Throws when conditions are not set — this guards against calling runtime
 * helpers before conditions are initialized (missing setup file in tests,
 * missing decorator in Storybook, or missing storage registration on the
 * server).
 */
export function getBuildConditions(): PartialBuildConditions {
    const conditions = storage.get();

    if (!conditions || Object.keys(conditions).length === 0) {
        throw new Error(
            'build-conditions: build conditions are not set. ' +
                'Call setBuildConditions (browser, tests, Storybook) ' +
                'or register a storage via setBuildConditionsStorage (server)'
        );
    }

    return conditions;
}
