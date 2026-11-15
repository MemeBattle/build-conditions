import type { Preview } from 'storybook-react-rsbuild';

import { createBuildConditionsDecorator, createBuildConditionsGlobalTypes } from '../../src/addon';

/**
 * Condition groups for the demo are declared in src/testGroups.d.ts
 * (platform: desktop | mobile, runtime: server | client)
 */
const conditionsConfig = {
    platform: { values: ['desktop', 'mobile'], defaultValue: 'desktop', icon: 'browser' },
    runtime: { values: ['client', 'server'], defaultValue: 'client', icon: 'globe' },
} as const;

const preview: Preview = {
    parameters: {
        title: require('../../package.json').name,
    },
    globalTypes: createBuildConditionsGlobalTypes(conditionsConfig),
    decorators: [createBuildConditionsDecorator(conditionsConfig)],
};

export default preview;
