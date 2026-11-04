import { defineConfig } from 'oxfmt';

export default defineConfig({
    // .gitignore covers node_modules, dist, storybook-static and swc-plugin/target
    ignorePatterns: ['pnpm-lock.yaml'],
    singleQuote: true,
    arrowParens: 'avoid',
    printWidth: 120,
    tabWidth: 4,
    trailingComma: 'es5',
    overrides: [{ files: ['*.yml', '*.yaml'], options: { tabWidth: 2 } }],
});
