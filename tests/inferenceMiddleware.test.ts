import { InferenceMiddleware } from "../src/middleware/inferenceMiddleware";
import { DatasetRepository } from "../src/repository/datasetRepository";
import jwt from "jsonwebtoken";

// Mock external dependencies
jest.mock("../src/repository/datasetRepository");
jest.mock("jsonwebtoken");

const mockedDatasetRepository = DatasetRepository as jest.Mocked<typeof DatasetRepository>;
const mockedJwt = jwt as jest.Mocked<typeof jwt>;

describe("Inference Middleware Suite", () => {
  let mockDatasetRepo: Partial<DatasetRepository>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup repository instance mock
    mockDatasetRepo = {
      createDataset: jest.fn(),
      getDatasetByUserIdAndName: jest.fn(),
      updateDataset: jest.fn(),
      datasetExists: jest.fn(),
      deleteDataset: jest.fn(),
      getDatasetById: jest.fn()
    };
    mockedDatasetRepository.getInstance.mockReturnValue(mockDatasetRepo as unknown as DatasetRepository);

    // Set test JWT secret
    process.env.JWT_SECRET = "test-secret";
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("validateCreateInference", () => {
    const userId = "user-123";

    it("should return error if dataset name is missing", async () => {
      const inferenceData = {
        datasetName: "",
        modelId: "model-123"
      };

      const result = await InferenceMiddleware.validateCreateInference(userId, inferenceData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Dataset name is required");
      expect(mockDatasetRepo.getDatasetByUserIdAndName).not.toHaveBeenCalled();
    });

    it("should return error if dataset is not found", async () => {
      const inferenceData = {
        datasetName: "nonexistent-dataset",
        modelId: "model-123"
      };

      (mockDatasetRepo.getDatasetByUserIdAndName as jest.Mock).mockResolvedValue(null);

      const result = await InferenceMiddleware.validateCreateInference(userId, inferenceData);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Dataset not found");
    });
  });

  describe("validateFileToken", () => {
    const userId = "user-123";
    const filePath = `inferences/${userId}/result.png`;

    it("should validate file token successfully", async () => {
      const tokenPayload = {
        userId,
        filePath,
        type: "file_access"
      } as jwt.JwtPayload & { userId: string; filePath: string; type: string };

      (mockedJwt.verify as jest.Mock).mockReturnValue(tokenPayload);

      const result = await InferenceMiddleware.validateFileToken("valid-token");

      expect(result.success).toBe(true);
      expect(result.userId).toBe(userId);
      expect(result.filePath).toBe(filePath);
      expect(mockedJwt.verify).toHaveBeenCalledWith("valid-token", "test-secret");
    });

    it("should return error for invalid token", async () => {
      (mockedJwt.verify as jest.Mock).mockImplementation(() => {
        throw new jwt.JsonWebTokenError("Invalid token");
      });

      const result = await InferenceMiddleware.validateFileToken("invalid-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid or expired file token");
    });

    it("should return error for expired token", async () => {
      (mockedJwt.verify as jest.Mock).mockImplementation(() => {
        throw new jwt.TokenExpiredError("Token expired", new Date());
      });

      const result = await InferenceMiddleware.validateFileToken("expired-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid or expired file token");
    });

    it("should return error if file path doesn't belong to user", async () => {
      const tokenPayload = {
        userId: "user-123",
        filePath: "inferences/user-456/result.png", // Different user
        type: "file_access"
      } as jwt.JwtPayload & { userId: string; filePath: string; type: string };

      (mockedJwt.verify as jest.Mock).mockReturnValue(tokenPayload);

      const result = await InferenceMiddleware.validateFileToken("malicious-token");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Access denied");
    });

    it("should handle missing JWT_SECRET", async () => {
      delete process.env.JWT_SECRET;
      
      const tokenPayload = {
        userId,
        filePath,
        type: "file_access"
      } as jwt.JwtPayload & { userId: string; filePath: string; type: string };

      (mockedJwt.verify as jest.Mock).mockReturnValue(tokenPayload);

      const result = await InferenceMiddleware.validateFileToken("token");

      expect(result.success).toBe(true);
      expect(mockedJwt.verify).toHaveBeenCalledWith("token", "fallback_secret");
    });
  });
});

      

