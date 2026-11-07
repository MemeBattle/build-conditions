import type { Plugin } from 'vite';

import { buildConditions, type BuildConditionsPluginOptions } from '../src/index.ts';

export interface RecordedError {
    message: string;
    pos: number;
}

type Handler = (this: unknown, code: string, id: string) => { code: string; map: unknown } | null;

/**
 * A hand-written fake of the plugin context: `error` records its argument
 * (and the separate position argument in `positions`) and throws.
 */
export function fakeContext(): {
    errors: RecordedError[];
    positions: (number | undefined)[];
    error: (error: RecordedError, pos?: number) => never;
} {
    const errors: RecordedError[] = [];
    const positions: (number | undefined)[] = [];

    return {
        errors,
        positions,
        error(error: RecordedError, pos?: number): never {
            errors.push(error);
            positions.push(pos);

            throw Object.assign(new Error(error.message), { pos: error.pos });
        },
    };
}

export function transformHook(plugin: Plugin): {
    filter: { id: { include: RegExp; exclude: RegExp }; code: string };
    handler: Handler;
} {
    return plugin.transform as unknown as ReturnType<typeof transformHook>;
}

export function pluginHandler(options: BuildConditionsPluginOptions): Handler {
    return transformHook(buildConditions(options)).handler;
}
