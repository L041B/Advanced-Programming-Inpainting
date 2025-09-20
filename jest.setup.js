// Setup environment variables for tests
process.env.DB_HOST = "localhost";
process.env.DB_PORT = "5432";
process.env.DB_NAME = "test_db";
process.env.DB_USER = "test_user";
process.env.DB_PASS = "test_pass";
process.env.JWT_SECRET = "test_jwt_secret";
process.env.NODE_ENV = "test";
process.env.REDIS_HOST = "localhost";
process.env.REDIS_PORT = "6379";

// Mock database and external dependencies at the module level
jest.mock("./src/config/database", () => ({
  DbConnection: {
    getInstance: jest.fn().mockReturnValue({
      getSequelizeInstance: jest.fn().mockReturnValue({
        define: jest.fn(),
        authenticate: jest.fn().mockResolvedValue(true),
        sync: jest.fn().mockResolvedValue(true),
        close: jest.fn().mockResolvedValue(true),
      }),
    }),
  },
}));

jest.mock("./src/models/User", () => ({
  User: {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
}));

jest.mock("./src/models/Dataset", () => ({
  Dataset: {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  },
}));




// Mock repository layer
jest.mock("./src/repository/datasetRepository", () => ({
  DatasetRepository: {
    getInstance: jest.fn().mockReturnValue({
      datasetExists: jest.fn(),
      createDataset: jest.fn(),
      getDatasetByUserIdAndName: jest.fn(),
      updateDataset: jest.fn(),
      deleteDataset: jest.fn(),
      getDatasetById: jest.fn(),
      getUserDatasets: jest.fn(),
    }),
  },
}));

jest.mock("./src/repository/userRepository", () => ({
  UserRepository: {
    getInstance: jest.fn().mockReturnValue({
      isAdmin: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    }),
  },
}));

// Mock services
jest.mock("./src/services/tokenService", () => ({
  TokenService: {
    getInstance: jest.fn(),
  },
}));

// Mock logger factory
jest.mock("./src/factory/loggerFactory", () => ({
  loggerFactory: {
    createApiLogger: jest.fn(() => ({
      log: jest.fn(),
    })),
    createErrorLogger: jest.fn(() => ({
      log: jest.fn(),
      logDatabaseError: jest.fn(),
      logValidationError: jest.fn(),
      logAuthenticationError: jest.fn(),
      logAuthorizationError: jest.fn(),
      logFileUploadError: jest.fn(),
    })),
    createDatasetLogger: jest.fn(() => ({
      log: jest.fn(),
      logDatasetCreation: jest.fn(),
      logDataProcessing: jest.fn(),
      logDatasetUpdate: jest.fn(),
    })),
    createInferenceLogger: jest.fn(() => ({
      log: jest.fn(),
    })),
  },
}));

// Set up global test environment
global.console = {
  ...console,
  // Suppress console.log during tests unless explicitly needed
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Set test environment variables
process.env.JWT_SECRET = "test-jwt-secret";
process.env.NODE_ENV = "test";