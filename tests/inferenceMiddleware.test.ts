import { Request, Response, NextFunction } from "express";
import {
  validateInferenceCreation,
  validateInferenceAccess
} from "../src/middleware/inferenceMiddleware";

describe("Inference Middleware Suite", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = { body: {}, params: {}, ip: "127.0.0.1" };
    res = {};
    next = jest.fn();
  });

  describe("validateInferenceCreation", () => {
    it("should call next() if datasetName is valid", () => {
      req.body = { datasetName: "myDataset" };
      validateInferenceCreation[0](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if datasetName is missing", () => {
      req.body = {};
      validateInferenceCreation[0](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain("Dataset name");
    });

    it("should call next(error) if parameters is not an object", () => {
      req.body = { datasetName: "myDataset", parameters: "not-an-object" };
      validateInferenceCreation[0](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain("parameters");
    });
  });

  describe("validateInferenceAccess", () => {
    it("should call next() for valid UUID", () => {
      req.params = { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479" };
      validateInferenceAccess[0](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) for invalid UUID", () => {
      req.params = { id: "not-a-uuid" };
      validateInferenceAccess[0](req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain("Invalid id format");
    });
  });

});



