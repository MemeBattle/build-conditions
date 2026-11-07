import { mergeRsbuildConfig } from '@rsbuild/core';
import type { StorybookConfig } from 'storybook-react-rsbuild';

/**
 * Package demo stand: vanilla storybook-react-rsbuild.
 * The JSX runtime is enabled directly through swc — without @rsbuild/plugin-react.
 */
const config: StorybookConfig = {
    stories: ['../../src/**/*.story.tsx'],
    framework: 'storybook-react-rsbuild',
    rsbuildFinal: rsbuildConfig =>
        mergeRsbuildConfig(rsbuildConfig, {
            tools: {
                swc: {
                    jsc: {
                        parser: { syntax: 'typescript', tsx: true },
                        transform: { react: { runtime: 'automatic' } },
                    },
                },
            },
        }),
};

export default config;
