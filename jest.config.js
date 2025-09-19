/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // Indica a Jest di usare il preset di ts-jest per trasformare i file .ts
  preset: "ts-jest",

  // Specifica l'ambiente di test. 'node' è essenziale per testare applicazioni backend.
  testEnvironment: "node",

  // Setup environment variables and global mocks
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],

  // Test file patterns
  roots: [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],

  testMatch: [
    "**/tests/authMiddleware.test.ts",
    "**/tests/userMiddleware.test.ts", 
    "**/tests/inferenceMiddleware.test.ts"
  ],

  // Transform TypeScript files
  transform: {
    "^.+\\.ts$": "ts-jest"
  },

  // Coverage settings
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/index.ts",
    "!src/**/index.ts"
  ],
  
  coverageDirectory: "coverage",
  
  coverageReporters: [
    "text",
    "lcov", 
    "html"
  ],

  // Pulisce automaticamente i mock tra ogni test per garantire l'isolamento.
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Imposta una regola per risolvere i percorsi (se usi alias come @/src)
  moduleNameMapping: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },

  moduleFileExtensions: [
    "ts",
    "js",
    "json"
  ],

  testTimeout: 30000,
};