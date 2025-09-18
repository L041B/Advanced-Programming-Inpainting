import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../src/models/User";
import { ExecutionDao } from "../src/dao/executionDao";
import * as authMiddleware from "../src/middleware/authMiddleware";
import { ErrorStatus } from "../src/factory/status";

// Extended type for request with our custom properties
type AuthenticatedRequest = Request & {
  user?: { userId: string; email: string };
  token?: string;
};

// --- Mock external dependencies ---
// Mock the User model and its findByPk method
jest.mock("../src/models/User", () => ({
  User: {
    findByPk: jest.fn(),
  },
}));

// Mock the DAO and its methods
jest.mock("../src/dao/executionDao", () => ({
  ExecutionDao: {
    getInstance: jest.fn().mockReturnValue({
      isOwner: jest.fn(),
    }),
  },
}));

// Mock the jsonwebtoken module
jest.mock("jsonwebtoken");

// Cast mocked modules for correct Jest type-checking
const mockedUser = User as jest.Mocked<typeof User>;
const mockedJwt = jwt as jest.Mocked<typeof jwt>;
const mockedExecutionDaoInstance = ExecutionDao.getInstance();

describe("Auth Middleware Suite", () => {
  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    // Reset req, res, next objects before each test for isolation
    req = {
      headers: {},
      params: {},
      body: {},
      ip: "127.0.0.1",
      path: "/test-path",
      method: "GET",
    };
    res = {}; // Our middleware does not use 'res', so we leave it empty
    next = jest.fn(); // Mock the next function
    process.env.JWT_SECRET = "test-secret"; // Set a secret for tests
  });

  // Clears all mocks after each test (good practice, even if clearMocks:true does this)
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("checkAuthHeader", () => {
    it("should call next() if the \"authorization\" header exists", () => {
      req.headers = { authorization: "Bearer token" };
      authMiddleware.checkAuthHeader(req as AuthenticatedRequest, res as Response, next);
      expect(next).toHaveBeenCalledWith(); // Called without errors
    });

    it("should call next(error) if the \"authorization\" header is missing", () => {
      authMiddleware.checkAuthHeader(req as AuthenticatedRequest, res as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(401);
      expect(error.errorType).toBe(ErrorStatus.jwtNotValid);
    });
  });

  describe("extractToken", () => {
    it("should extract the token, add it to req.token and call next()", () => {
      req.headers = { authorization: "Bearer valid-token" };
      authMiddleware.extractToken(req as AuthenticatedRequest, res as Response, next);
      expect(req.token).toBe("valid-token");
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if the token is not in the format \"Bearer <token>\"", () => {
      req.headers = { authorization: "Bearer " }; // Empty space
      authMiddleware.extractToken(req as AuthenticatedRequest, res as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(401);
    });
  });

  describe("verifyToken", () => {
    it("should decode the token, add the data to req.user and call next()", () => {
      const userPayload = { userId: "123", email: "test@example.com" };
      req.token = "valid-token";
      (mockedJwt.verify as jest.Mock).mockReturnValue(userPayload); // Simulate successful JWT verification

      authMiddleware.verifyToken(req as AuthenticatedRequest, res as Response, next);

      expect(mockedJwt.verify).toHaveBeenCalledWith("valid-token", "test-secret");
      expect(req.user).toEqual(userPayload);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if the token is invalid or expired", () => {
      req.token = "invalid-token";
      mockedJwt.verify.mockImplementation(() => {
        throw new jwt.JsonWebTokenError("Invalid token");
      }); // Simulate failure

      authMiddleware.verifyToken(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(403);
    });

     it("should call next(error) if JWT_SECRET is not defined", () => {
      delete process.env.JWT_SECRET; // Simulate missing environment variable
      req.token = "any-token";
      
      authMiddleware.verifyToken(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(500);
    });
  });

  describe("verifyUserExists", () => {
    it("should call next() if the user is found in the DB", async () => {
      req.user = { userId: "123", email: "test@example.com" };
      // Simulate user found as Model (mock object with id property)
      mockedUser.findByPk.mockResolvedValue({ id: "123" } as User);

      await authMiddleware.verifyUserExists(req as AuthenticatedRequest, res as Response, next);

      expect(mockedUser.findByPk).toHaveBeenCalledWith("123");
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if the user is not in the DB", async () => {
      req.user = { userId: "404", email: "notfound@example.com" };
      mockedUser.findByPk.mockResolvedValue(null); // Simulate user not found

      await authMiddleware.verifyUserExists(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(401);
    });

     it("should call next(error) if the DB search fails", async () => {
      req.user = { userId: "123", email: "test@example.com" };
      mockedUser.findByPk.mockRejectedValue(new Error("DB Connection Error")); // Simulate DB error

      await authMiddleware.verifyUserExists(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(500);
    });
  });

  describe("checkUserAuthorization", () => {
    it("should call next() if the user ID matches the one in params", () => {
      req.user = { userId: "user-1", email: "test@test.com" };
      req.params = { userId: "user-1" };

      authMiddleware.checkUserAuthorization(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if the IDs do not match", () => {
      req.user = { userId: "user-1", email: "test@test.com" };
      req.params = { userId: "user-2" }; // Different ID

      authMiddleware.checkUserAuthorization(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(403);
    });
  });

  describe("checkExecutionOwnership", () => {
    it("should call next() if the user is the owner of the execution", async () => {
      req.user = { userId: "owner-1", email: "owner@test.com" };
      req.params = { id: "exec-1" }; // Execution ID
      (mockedExecutionDaoInstance.isOwner as jest.Mock).mockResolvedValue(true);

      await authMiddleware.checkExecutionOwnership(req as AuthenticatedRequest, res as Response, next);

      expect(mockedExecutionDaoInstance.isOwner).toHaveBeenCalledWith("exec-1", "owner-1");
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if the user is not the owner", async () => {
      req.user = { userId: "not-owner", email: "hacker@test.com" };
      req.params = { id: "exec-1" };
      (mockedExecutionDaoInstance.isOwner as jest.Mock).mockResolvedValue(false);

      await authMiddleware.checkExecutionOwnership(req as AuthenticatedRequest, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(403);
    });
  });
});