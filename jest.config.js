const transformerConfig = {
    jsc: {
        transform: {
            react: {
                runtime: 'automatic',
            },
        },
    },
};

module.exports = {
    transform: {
        '^.+\\.(t|j)sx?$': ['@swc/jest', transformerConfig],
    },
    setupFilesAfterEnv: ['@testing-library/jest-dom'],
    testEnvironment: 'jest-environment-jsdom',
};
