/* eslint-disable @typescript-eslint/no-explicit-any -- generic wrappers over functions and objects */
/* eslint-disable @typescript-eslint/consistent-type-assertions -- Proxy traps delegate to the resolved branch value */

import type { AllowedValue, Homogeneous, SingleGroup, UniqueConditionValuesGuard } from './types';
import { getBuildConditions } from './storage';

/**
 * Picks a value depending on the active condition. Values are functions or objects.
 *
 * Without the SWC plugin it works at runtime: returns a wrapper that resolves
 * the active condition via `getBuildConditions()` on every access and
 * delegates to the matching branch. When building with fixed conditions, the
 * SWC plugin inlines the winning branch and removes the dead code.
 *
 * ```typescript
 * const Component = switchBuildCondition({
 *     desktop: DesktopComponent,
 *     mobile: MobileComponent,
 * });
 * ```
 *
 * The `default` branch is used when no key matches the active conditions.
 */
export function switchBuildCondition<M extends Record<string, AllowedValue>>(
    conditions: SingleGroup<M> & Homogeneous<M> & UniqueConditionValuesGuard
): M[keyof M];
export function switchBuildCondition(conditions: Record<string, AllowedValue>): AllowedValue {
    const resolve = () => {
        const active = getBuildConditions();
        const activeValues: unknown[] = Object.values(active);

        for (const key of Object.keys(conditions)) {
            if (key === 'default') {
                continue;
            }

            if (activeValues.includes(key)) {
                return conditions[key];
            }
        }

        if ('default' in conditions) {
            return conditions.default;
        }

        throw new Error(`switchBuildCondition: no value for the current conditions ${JSON.stringify(active)}`);
    };

    const allFunctions = Object.values(conditions).every(value => typeof value === 'function');

    if (allFunctions) {
        const wrapper = function (this: any, ...args: any[]) {
            return Reflect.apply(resolve() as (...fnArgs: any[]) => any, this, args);
        };

        return new Proxy(wrapper, {
            get: (target, property, receiver) => {
                if (property === 'length' || property === 'name') {
                    return Reflect.get(target, property, receiver);
                }

                return Reflect.get(resolve() as object, property, receiver);
            },
            set: (_target, property, value, receiver) => Reflect.set(resolve() as object, property, value, receiver),
            has: (_target, property) => Reflect.has(resolve() as object, property),
            getPrototypeOf: () => Reflect.getPrototypeOf(resolve() as object),
        });
    }

    const target = {};

    return new Proxy(target, {
        get: (_target, property, receiver) => Reflect.get(resolve() as object, property, receiver),
        set: (_target, property, value, receiver) => Reflect.set(resolve() as object, property, value, receiver),
        has: (_target, property) => Reflect.has(resolve() as object, property),
        deleteProperty: (_target, property) => Reflect.deleteProperty(resolve() as object, property),
        getPrototypeOf: () => Reflect.getPrototypeOf(resolve() as object),
        ownKeys: () => Reflect.ownKeys(resolve() as object),
        getOwnPropertyDescriptor: (_target, property) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as object, property);

            if (descriptor) {
                descriptor.configurable = true;
            }

            return descriptor;
        },
    });
}
