/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    roots: ['<rootDir>/__tests__'],
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', useESM: true }],
    },
    extensionsToTreatAsEsm: ['.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    collectCoverage: true,
    collectCoverageFrom: [
        'src/routes/**/*.ts',
        'src/log.ts',
        'src/notify.ts'
    ],
    coveragePathIgnorePatterns: [
        '/node_modules/',
        '/__tests__/',
        '/__mocks__/'
    ],
    coverageThreshold: { global: { statements: 30, branches: 20, functions: 40, lines: 40 } },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '^@/(.*)$': '<rootDir>/src/$1'
    },
    moduleFileExtensions: ['ts','js','json'],
    coverageReporters: ['text','lcov','json','html'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '/__mocks__/',
    ],
};
