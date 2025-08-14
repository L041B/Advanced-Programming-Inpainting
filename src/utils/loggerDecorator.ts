// Import necessary modules from winston and express.
import { Request, Response } from "express";
import winston from "winston";
import { Logger } from "./logger";

// Define a common interface for log data to ensure type safety.
interface LogData {
    [key: string]: string | number | boolean | undefined | string[];
}

// Define a common interface for authenticated requests
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

// Decorator Interface
export interface LoggerDecorator {
    log(message: string, data?: LogData): void;
}

// Base Decorator
export abstract class BaseLoggerDecorator implements LoggerDecorator {
    protected logger: winston.Logger;

    constructor() {
        this.logger = Logger.getInstance();
    }

    abstract log(message: string, data?: LogData): void;
}

// User Route Logger Decorator
export class UserRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.info(message, { type: "USER_ACTION", ...data });
    }

    // Log user creation events
    logUserCreation(userId: string, email: string): void {
        this.logger.info("USER_CREATED", { type: "USER_ACTION", userId, email });
    }

    // Log user login events
    logUserLogin(email: string, success: boolean): void {
        this.logger.info("USER_LOGIN", { type: "AUTH_ACTION", email, success });
    }

    // Log user update events
    logUserUpdate(userId: string, updatedFields: string[]): void {
        this.logger.info("USER_UPDATED", { type: "USER_ACTION", userId, updatedFields });
    }

    // Log user deletion events
    logUserDeletion(userId: string): void {
        this.logger.info("USER_DELETED", { type: "USER_ACTION", userId });
    }

    // Log user retrieval events
    logUserRetrieval(userId: string): void {
        this.logger.info("USER_RETRIEVED", { type: "USER_ACTION", userId });
    }
}

// Execution Route Logger Decorator
export class ExecutionRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.info(message, { type: "EXECUTION_ACTION", ...data });
    }

    // Log execution creation events
    logExecutionCreation(executionId: string, userId: string, status: string): void {
        this.logger.info("EXECUTION_CREATED", { type: "EXECUTION_ACTION", executionId, userId, status });
    }

    // Log execution retrieval events
    logExecutionRetrieval(executionId: string, userId?: string): void {
        this.logger.info("EXECUTION_RETRIEVED", { type: "EXECUTION_ACTION", executionId, userId });
    }

    // Log execution update events
    logExecutionUpdate(executionId: string, userId: string, updatedFields: string[]): void {
        this.logger.info("EXECUTION_UPDATED", { type: "EXECUTION_ACTION", executionId, userId, updatedFields });
    }

    // Log execution deletion events
    logExecutionDeletion(executionId: string, userId: string): void {
        this.logger.info("EXECUTION_DELETED", { type: "EXECUTION_ACTION", executionId, userId });
    }

    // Log execution status check events
    logExecutionStatusCheck(executionId: string): void {
        this.logger.info("EXECUTION_STATUS_CHECKED", { type: "EXECUTION_ACTION", executionId });
    }

    // Log execution download events
    logExecutionDownload(executionId: string, userId?: string): void {
        this.logger.info("EXECUTION_DOWNLOADED", { type: "EXECUTION_ACTION", executionId, userId });
    }

    // Log preview generation events
    logPreviewGeneration(success: boolean): void {
        this.logger.info("PREVIEW_GENERATED", { type: "EXECUTION_ACTION", success });
    }

    // Log user executions retrieval events
    logUserExecutionsRetrieval(userId: string, count: number): void {
        this.logger.info("USER_EXECUTIONS_RETRIEVED", { type: "EXECUTION_ACTION", userId, count });
    }
}

// Auth Route Logger Decorator
export class AuthRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.info(message, { type: "AUTH_ACTION", ...data });
    }

    // Log token validation events
    logTokenValidation(userId: string, email: string, success: boolean): void {
        this.logger.info("TOKEN_VALIDATED", { type: "AUTH_ACTION", email, userId, success });
    }

    // Log authorization check events
    logAuthorizationCheck(userId: string, requestedUserId: string, authorized: boolean): void {
        this.logger.info("AUTHORIZATION_CHECKED", { type: "AUTH_ACTION", userId, requestedUserId, authorized });
    }

    // Log token expiration events
    logTokenExpiration(email: string): void {
        this.logger.info("TOKEN_EXPIRED", { type: "AUTH_ACTION", email });
    }
}

// API Request/Response Logger Decorator
export class ApiRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.info(message, { type: "API_ACTION", ...data });
    }

    // Log API request events
    logRequest(req: Request): void {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.userId;
        this.logger.info(`API_REQUEST: ${req.method} ${req.path}`, {
            type: "API_REQUEST",
            method: req.method,
            path: req.path,
            userId,
            ip: req.ip,
            userAgent: req.get("User-Agent")
        });
    }

    // Log API response events
    logResponse(req: Request, res: Response, executionTime?: number): void {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.userId;
        this.logger.info(`API_RESPONSE: ${req.method} ${req.path} - ${res.statusCode}`, {
            type: "API_RESPONSE",
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            userId,
            executionTime,
            ip: req.ip
        });
    }

    // Log API error events
    logError(req: Request, error: Error): void {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.userId;
        this.logger.error(`API_ERROR: ${req.method} ${req.path}`, {
            type: "API_ERROR",
            method: req.method,
            path: req.path,
            userId,
            error: error.message,
            stack: error.stack,
            ip: req.ip
        });
    }
}

// Error Logger Decorator
export class ErrorRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.error(message, { type: "ERROR", ...data });
    }

    // Log validation error events
    logValidationError(field: string, value: string | number | undefined, message: string): void {
        this.logger.error("VALIDATION_ERROR", { type: "VALIDATION_ERROR", field, value, message });
    }

    // Log authentication error events
    logAuthenticationError(email?: string, reason?: string): void {
        this.logger.error("AUTHENTICATION_ERROR", { type: "AUTHENTICATION_ERROR", email, reason });
    }

    // Log authorization error events
    logAuthorizationError(userId?: string, resource?: string): void {
        this.logger.error("AUTHORIZATION_ERROR", { type: "AUTHORIZATION_ERROR", userId, resource });
    }

    // Log database error events
    logDatabaseError(operation: string, table?: string, error?: string): void {
        this.logger.error("DATABASE_ERROR", { type: "DATABASE_ERROR", operation, table, error });
    }

    // Log file upload error events
    logFileUploadError(filename?: string, size?: number, error?: string): void {
        this.logger.error("FILE_UPLOAD_ERROR", { type: "FILE_UPLOAD_ERROR", filename, size, error });
    }
}