
jest.mock("./src/factory/loggerFactory", () => ({
  loggerFactory: {
    createApiLogger: () => ({
      log: jest.fn(),
    }),
    createErrorLogger: () => ({
      log: jest.fn(),
      logDatabaseError: jest.fn(),
      logAuthorizationError: jest.fn(), 
    }),
  },
}));