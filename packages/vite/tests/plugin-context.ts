import type { Plugin } from 'vite';

import { buildConditions, type BuildConditionsPluginOptions } from '../src/index.ts';

export interface RecordedError {
    message: string;
    pos: number;
}

type Handler = (this: unknown, code: string, id: string) => { code: string; map: unknown } | null;

/** A hand-written fake of the plugin context: `error` records its argument and throws */
export function fakeContext(): { errors: RecordedError[]; error: (error: RecordedError) => never } {
    const errors: RecordedError[] = [];

    return {
        errors,
        error(error: RecordedError): never {
            errors.push(error);

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
