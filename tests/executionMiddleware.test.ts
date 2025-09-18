// tests/executionMiddleware.test.ts
/*
import { Request, Response, NextFunction } from "express";
import { Readable } from "stream";
import * as executionMiddleware from "../src/middleware/executionMiddleware";
import { ExecutionRepository } from "../src/repository/executionRepository";
import { ErrorStatus } from "../src/factory/status";

// Tipo helper per la richiesta autenticata
type AuthenticatedRequest = Request & {
  user?: { userId: string; email: string };
};

// --- Mock delle dipendenze ---
jest.mock("../src/repository/executionRepository", () => ({
  ExecutionRepository: {
    getInstance: jest.fn().mockReturnValue({
      getExecutionBasicInfoWithUserId: jest.fn(),
    }),
  },
}));

// Castiamo l'istanza mockata per avere il controllo dei tipi e l'autocompletamento di Jest
const mockedExecRepoInstance = ExecutionRepository.getInstance();

describe("Execution Middleware Suite", () => {
  let req: Partial<AuthenticatedRequest>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      body: {},
      params: {},
      files: undefined, // Importante resettare i file
      user: undefined,  // e l'utente
      ip: "127.0.0.1",
    };
    res = {};
    next = jest.fn();
  });

  // Helper per creare un file finto come farebbe multer
  const createMockFile = (fieldname: string): Express.Multer.File => ({
    fieldname,
    originalname: `${fieldname}.jpg`,
    encoding: "7bit",
    mimetype: "image/jpeg",
    size: 12345,
    destination: "./uploads",
    filename: `${fieldname}-123.jpg`,
    path: `uploads/${fieldname}-123.jpg`,
    stream: null as Readable,
    buffer: Buffer.from("mock file content"),
  });

  describe("checkFilesPresence", () => {
    it("dovrebbe chiamare next() se entrambi i file sono presenti", () => {
      req.files = {
        originalImage: [createMockFile("originalImage")],
        maskImage: [createMockFile("maskImage")],
      };
      executionMiddleware.checkFilesPresence(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("dovrebbe chiamare next(error) se manca un file", () => {
      req.files = { originalImage: [createMockFile("originalImage")] };
      executionMiddleware.checkFilesPresence(req as Request, res as Response, next);
      
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain("Both originalImage and maskImage files are required");
    });
  });

  describe("checkUpdateFilesPresence", () => {
    it("dovrebbe chiamare next() se non viene inviato nessun file", () => {
        req.files = {};
        executionMiddleware.checkUpdateFilesPresence(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("dovrebbe chiamare next() se viene inviato almeno uno dei file attesi", () => {
        req.files = { originalImage: [createMockFile("originalImage")] };
        executionMiddleware.checkUpdateFilesPresence(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("dovrebbe chiamare next(error) se viene inviato un file con un nome non atteso", () => {
        req.files = { otherFile: [createMockFile("otherFile")] };
        executionMiddleware.checkUpdateFilesPresence(req as Request, res as Response, next);
        
        expect(next).toHaveBeenCalledWith(expect.any(Error));
        const error = (next as jest.Mock).mock.calls[0][0];
        expect(error.message).toContain("At least one image file (original or mask) is required for update");
    });
  });

  // I test per i check dei parametri sono semplici e ripetitivi
  describe.each([
    ["checkExecutionIdParam", "id", "Execution ID is required"],
    ["checkUserIdParam", "userId", "User ID is required"],
    ["checkJobIdParam", "jobId", "Job ID is required"],
  ])("%s", (middlewareName, paramName, errorMessage) => {
    it(`dovrebbe chiamare next() se il parametro "${paramName}" esiste`, () => {
      req.params = { [paramName]: "123" };
      (executionMiddleware as any)[middlewareName](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it(`dovrebbe chiamare next(error) se il parametro "${paramName}" manca`, () => {
      req.params = {};
      (executionMiddleware as any)[middlewareName](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: errorMessage }));
    });
  });

  describe("validateExecutionUUID", () => {
    it("dovrebbe chiamare next() per un UUID valido in params.id", () => {
        req.params = { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" };
        executionMiddleware.validateExecutionUUID(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("dovrebbe chiamare next(error) per un UUID non valido", () => {
        req.params = { id: "invalid-uuid" };
        executionMiddleware.validateExecutionUUID(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "Invalid Execution ID format" }));
    });
  });

  describe("verifyExecutionOwnership", () => {
    const execId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    const ownerId = "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6";

    it("dovrebbe chiamare next() se l'utente è il proprietario", async () => {
      req.user = { userId: ownerId, email: "owner@test.com" };
      req.params = { id: execId };
      // Simula che il DB restituisca l'esecuzione con l'ID utente corretto
      (mockedExecRepoInstance.getExecutionBasicInfoWithUserId as jest.Mock).mockResolvedValue({ userId: ownerId });

      await executionMiddleware.verifyExecutionOwnership(req as AuthenticatedRequest, res as Response, next);

      expect(mockedExecRepoInstance.getExecutionBasicInfoWithUserId).toHaveBeenCalledWith(execId);
      expect(next).toHaveBeenCalledWith();
    });

    it("dovrebbe chiamare next(error 403) se l'utente non è il proprietario", async () => {
        req.user = { userId: "some-other-user-id", email: "other@test.com" };
        req.params = { id: execId };
        (mockedExecRepoInstance.getExecutionBasicInfoWithUserId as jest.Mock).mockResolvedValue({ userId: ownerId });
  
        await executionMiddleware.verifyExecutionOwnership(req as AuthenticatedRequest, res as Response, next);
  
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    });

    it("dovrebbe chiamare next(error 404) se l'esecuzione non viene trovata", async () => {
        req.user = { userId: ownerId, email: "owner@test.com" };
        req.params = { id: execId };
        // Simula che il DB non trovi nulla
        (mockedExecRepoInstance.getExecutionBasicInfoWithUserId as jest.Mock).mockResolvedValue(null);
  
        await executionMiddleware.verifyExecutionOwnership(req as AuthenticatedRequest, res as Response, next);
  
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404, errorType: ErrorStatus.resourceNotFoundError }));
    });

    it("dovrebbe chiamare next(error 401) se l'utente non è autenticato", async () => {
        req.user = undefined; // Nessun utente
        req.params = { id: execId };

        await executionMiddleware.verifyExecutionOwnership(req as AuthenticatedRequest, res as Response, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
    });

    it("dovrebbe chiamare next(error 500) se il repository genera un errore", async () => {
        req.user = { userId: ownerId, email: "owner@test.com" };
        req.params = { id: execId };
        // Simula un errore del database
        const dbError = new Error("Database connection lost");
        (mockedExecRepoInstance.getExecutionBasicInfoWithUserId as jest.Mock).mockRejectedValue(dbError);

        await executionMiddleware.verifyExecutionOwnership(req as AuthenticatedRequest, res as Response, next);
  
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 500, errorType: ErrorStatus.readInternalServerError }));
    });
  });
});*/