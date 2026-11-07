import type { BuildConditionGroups } from '../index';
import type { GroupName, PartialBuildConditions } from '../types';
import { setBuildConditions } from '../storage';

/** Prefix for keys in globals, to avoid clashes with other addons */
export const BUILD_CONDITIONS_GLOBAL_PREFIX = 'buildConditions_';

export interface BuildConditionsToolbarGroup<G extends GroupName = GroupName> {
    /** Group values available for switching in the toolbar */
    values: readonly BuildConditionGroups[G][];
    /** Default value of the group */
    defaultValue: BuildConditionGroups[G];
    /** Title of the toolbar item (defaults to the group name) */
    title?: string;
    /** Storybook icon name for the toolbar item */
    icon?: string;
}

/** Addon configuration: which condition groups are switchable in the toolbar */
export type BuildConditionsAddonConfig = {
    [G in GroupName]?: BuildConditionsToolbarGroup<G>;
};

interface ToolbarItem {
    value: string;
    title: string;
}

interface GlobalType {
    name: string;
    description: string;
    defaultValue: string;
    toolbar: {
        icon: string;
        items: ToolbarItem[];
        dynamicTitle: boolean;
    };
}

/**
 * While no condition groups are declared, the mapped config type collapses
 * to `{}` — iterate over the entries with an explicit group type.
 */
function configEntries(config: BuildConditionsAddonConfig): [string, BuildConditionsToolbarGroup | undefined][] {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Object.entries loses mapped-type keys
    return Object.entries(config) as [string, BuildConditionsToolbarGroup | undefined][];
}

/**
 * Creates `globalTypes` for the Storybook preview config: one toolbar item
 * per condition group from the configuration.
 *
 * ```typescript
 * // .config/storybook/preview.ts
 * export const globalTypes = createBuildConditionsGlobalTypes({
 *     platform: { values: ['desktop', 'mobile'], defaultValue: 'desktop' },
 * });
 * ```
 */
export function createBuildConditionsGlobalTypes(config: BuildConditionsAddonConfig): Record<string, GlobalType> {
    const globalTypes: Record<string, GlobalType> = {};

    for (const [group, groupConfig] of configEntries(config)) {
        if (!groupConfig) {
            continue;
        }

        globalTypes[BUILD_CONDITIONS_GLOBAL_PREFIX + group] = {
            name: groupConfig.title ?? group,
            description: `Build condition: ${group}`,
            defaultValue: groupConfig.defaultValue,
            toolbar: {
                icon: groupConfig.icon ?? 'beaker',
                items: groupConfig.values.map(value => ({ value, title: value })),
                dynamicTitle: true,
            },
        };
    }

    return globalTypes;
}

interface StoryContextLike {
    globals?: Record<string, unknown>;
}

/**
 * Creates a global decorator for the Storybook preview config: reads the
 * toolbar-selected values from `context.globals` and applies them via
 * `setBuildConditions` before rendering the story.
 *
 * ```typescript
 * // .config/storybook/preview.ts
 * export const decorators = [createBuildConditionsDecorator(addonConfig)];
 * ```
 */
export function createBuildConditionsDecorator(config: BuildConditionsAddonConfig) {
    return function buildConditionsDecorator<T>(story: () => T, context: StoryContextLike): T {
        const conditions: Record<string, unknown> = {};

        for (const [group, groupConfig] of configEntries(config)) {
            if (!groupConfig) {
                continue;
            }

            conditions[group] = context.globals?.[BUILD_CONDITIONS_GLOBAL_PREFIX + group] ?? groupConfig.defaultValue;
        }

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- keys come from BuildConditionsAddonConfig
        setBuildConditions(conditions as PartialBuildConditions);

        return story();
    };
}
