/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  //  indicate to use the ts-jest preset which allows Jest to handle TypeScript files
  preset: "ts-jest",

  // Specify the test environment. 'node' is essential for testing backend applications.
  testEnvironment: "node",

  // Setup environment variables and global mocks
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],

  // Test file patterns
  roots: [
    "<rootDir>/src",
    "<rootDir>/tests"
  ],

  // Specific test files to run
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
  
  // Directory where Jest should output its coverage files
  coverageDirectory: "coverage",
  
  coverageReporters: [
    "text",
    "lcov", 
    "html"
  ],

  // Automatically clear mocks between tests to ensure isolation.
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,

  // Set up a rule for resolving paths (if using aliases like @/src)
  moduleNameMapping: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },

  // Recognize these file extensions
  moduleFileExtensions: [
    "ts",
    "js",
    "json"
  ],

  testTimeout: 30000,
};