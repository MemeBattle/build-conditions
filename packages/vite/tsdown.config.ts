import { defineConfig, type UserConfig } from 'tsdown';

const config: UserConfig = defineConfig({
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node20.19',
    // Declarations come from oxc isolated declarations. The type import from
    // @memebattle/build-conditions (a workspace devDependency) stays external,
    // so the consumer's augmentation applies
    dts: true,
    deps: { neverBundle: ['@memebattle/build-conditions'] },
    fixedExtension: false,
    clean: true,
});

export default config;
