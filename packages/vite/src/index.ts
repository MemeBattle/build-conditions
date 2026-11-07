/**
 * Vite plugin of `@memebattle/build-conditions`: a JS port of the SWC plugin.
 *
 * It edits only the helper call sites, the dead branches, the dead
 * declarations and the dead imports; types, comments and formatting outside
 * those ranges stay untouched, and a hires sourcemap maps the result back.
 */
import type { GroupName, PluginOptions } from '@memebattle/build-conditions';
import type { Plugin } from 'vite';

import { resolveConfig } from './config.ts';
import { MODULE_SPECIFIER, transformBuildConditions } from './transform.ts';

/**
 * The options of the plugin: `PluginOptions` typed by the declared condition
 * groups. A `vite.config.ts` program that does not see the consumer's
 * `BuildConditionGroups` augmentation falls back to plain string records,
 * instead of rejecting every literal config.
 */
export type BuildConditionsPluginOptions = [GroupName] extends [never]
    ? { groups: Record<string, readonly string[]>; conditions: Record<string, string | null> }
    : PluginOptions;

const SCRIPT_ID = /\.[cm]?[jt]sx?$/;

/**
 * `buildConditions({ groups, conditions })` with the same config as the SWC
 * plugin: a fixed group folds its calls, a `null` group stays in runtime mode.
 * An invalid config throws right away, at config time.
 */
export function buildConditions(options: BuildConditionsPluginOptions): Plugin {
    const config = resolveConfig(options);

    return {
        name: 'build-conditions',
        // Before @vitejs/plugin-react, which still sees JSX for Fast Refresh
        enforce: 'pre',
        transform: {
            filter: {
                id: { include: SCRIPT_ID, exclude: /\/node_modules\// },
                code: MODULE_SPECIFIER,
            },
            handler(code, id) {
                const filename = id.replace(/[?#].*$/, '');

                // Defensive: hosts that ignore hook filters
                if (
                    !SCRIPT_ID.test(filename) ||
                    filename.includes('/node_modules/') ||
                    !code.includes(MODULE_SPECIFIER)
                ) {
                    return null;
                }

                const result = transformBuildConditions(code, filename, config);
                const [error] = result.errors;

                if (error !== undefined) {
                    // The build contexts of Rollup and Rolldown add loc and frame only from the second argument
                    this.error({ message: error.message, pos: error.pos }, error.pos);
                }

                if (result.map === null) {
                    return null;
                }

                return { code: result.code, map: result.map };
            },
        },
    };
}
