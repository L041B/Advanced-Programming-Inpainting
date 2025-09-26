// tests/validationMiddleware.test.ts

import { Request, Response, NextFunction } from "express";
import * as userMiddleware from "../src/middleware/userMiddleware";
import { ErrorStatus } from "../src/factory/status";
import { validateUserIdFormat } from "../src/middleware/validationMiddleware";

describe("User Middleware Suite", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    // Reset objects before each test
    req = {
      body: {},
      params: {},
      ip: "127.0.0.1",
    };
    res = {};
    next = jest.fn();
  });

  describe("checkRequiredFields", () => {
    it("should call next() if all required fields are present", () => {
      req.body = { name: "John", surname: "Doe", email: "john@doe.com", password: "password123" };
      userMiddleware.checkRequiredFields(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) if one or more fields are missing", () => {
      req.body = { name: "John", surname: "Doe" }; // missing email and password
      userMiddleware.checkRequiredFields(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.status).toBe(400);
      expect(error.errorType).toBe(ErrorStatus.invalidFormat);
      expect(error.message).toContain("email");
      expect(error.message).toContain("password");
    });
  });

  describe("validateNameFormat", () => {
    it("should call next() for valid names and surnames", () => {
      req.body = { name: "John", surname: "Doe" };
      userMiddleware.validateNameFormat(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next() for names with apostrophes and hyphens", () => {
        req.body = { name: "D'Artagnan", surname: "O'Malley-Smith" };
        userMiddleware.validateNameFormat(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) for names with numbers or invalid symbols", () => {
      req.body = { name: "John123", surname: "Doe" };
      userMiddleware.validateNameFormat(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain("must contain only letters");
    });
  });

  describe("validateEmailFormat", () => {
    it("should call next() for a valid email", () => {
      req.body = { email: "test.user@example.co.uk" };
      userMiddleware.validateEmailFormat(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) for an invalid email", () => {
      req.body = { email: "invalid-email@domain" };
      userMiddleware.validateEmailFormat(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.errorType).toBe(ErrorStatus.emailNotValid);
    });
  });

  describe("validatePasswordStrength", () => {
    it("should call next() for a sufficiently long password", () => {
      req.body = { password: "longenoughpassword" };
      userMiddleware.validatePasswordStrength(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) for a password that is too short", () => {
      req.body = { password: "short" };
      userMiddleware.validatePasswordStrength(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toContain("at least 8 characters long");
    });

    it("should call next() if the password field is not present (useful for update)", () => {
        req.body = { name: "John" }; // No password field
        userMiddleware.validatePasswordStrength(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
    });
  });

  describe("sanitizeUserData", () => {
    it("should trim and lowercase user data", () => {
      req.body = {
        name: "  John  ",
        surname: "  Doe  ",
        email: "  Test@Example.COM  ",
      };
      userMiddleware.sanitizeUserData(req as Request, res as Response, next);

      expect(req.body.name).toBe("John");
      expect(req.body.surname).toBe("Doe");
      expect(req.body.email).toBe("test@example.com");
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe("checkLoginFields", () => {
    it("should call next() if email and password are present", () => {
        req.body = { email: "test@test.com", password: "123" };
        userMiddleware.checkLoginFields(req as Request, res as Response, next);
        expect(next).toHaveBeenCalledWith();
    });
    
    it("should call next(error) if email or password is missing", () => {
        req.body = { email: "test@test.com" };
        userMiddleware.checkLoginFields(req as Request, res as Response, next);

        expect(next).toHaveBeenCalledWith(expect.any(Error));
        const error = (next as jest.Mock).mock.calls[0][0];
        expect(error.errorType).toBe(ErrorStatus.loginBadRequest);
    });
  });

  describe("sanitizeLoginData", () => {
    it("should trim and lowercase the login email", () => {
        req.body = { email: "  MyEmail@Domain.COM  ", password: "123" };
        userMiddleware.sanitizeLoginData(req as Request, res as Response, next);

        expect(req.body.email).toBe("myemail@domain.com");
        expect(next).toHaveBeenCalledWith();
    });
  });

  describe("validateUserIdFormat (from validationMiddleware)", () => {
    it("should call next() for a valid UUID", () => {
      req.params = { userId: "f47ac10b-58cc-4372-a567-0e02b2c3d479" };
      validateUserIdFormat(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });

    it("should call next(error) for an invalid UUID", () => {
      req.params = { userId: "not-a-valid-uuid" };
      validateUserIdFormat(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      const error = (next as jest.Mock).mock.calls[0][0];
      expect(error.message).toBe("Invalid userId format");
    });

    it("should call next() if the userId parameter is not present", () => {
      req.params = {};
      validateUserIdFormat(req as Request, res as Response, next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});