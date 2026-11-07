import { defineConfig } from 'oxfmt';

export default defineConfig({
    // .gitignore covers node_modules, dist, storybook-static and packages/swc/target
    ignorePatterns: [
        'pnpm-lock.yaml',
        // Shared plugin test fixtures: output.js comes from the swc codegen, input.js is kept as written
        'fixtures/',
    ],
    singleQuote: true,
    arrowParens: 'avoid',
    printWidth: 120,
    tabWidth: 4,
    trailingComma: 'es5',
    overrides: [{ files: ['*.yml', '*.yaml'], options: { tabWidth: 2 } }],
});
