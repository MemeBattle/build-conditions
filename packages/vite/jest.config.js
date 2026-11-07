export default {
    displayName: 'vite',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+\\.ts$': [
            '@swc/jest',
            { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'es6' } },
        ],
    },
    testMatch: ['<rootDir>/tests/**/*.test.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/tests/project/'],
};
