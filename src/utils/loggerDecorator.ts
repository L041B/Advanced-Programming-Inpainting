// Import necessary modules from winston and express.
import { Request, Response } from "express";
import winston from "winston";
import { Logger } from "./logger";

// Define a common interface for log data to ensure type safety.
interface LogData {
    [key: string]: string | number | boolean | undefined | string[] | Record<string, unknown>;
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

// Base Logger Decorator 
export abstract class BaseLoggerDecorator implements LoggerDecorator {
    protected logger: winston.Logger;
    // Accept an optional wrapped logger for chaining decorators
    constructor(protected wrappedLogger?: LoggerDecorator) {
        this.logger = Logger.getInstance();
    }

    // Abstract log method to be implemented by subclasses
    abstract log(message: string, data?: LogData): void;
}

// User Route Logger Decorator
export class UserRouteLogger extends BaseLoggerDecorator {

    log(message: string, data?: LogData): void {
        const decoratedData = { type: "USER_ACTION", ...data };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(message, decoratedData);
        } else {
            this.logger.info(message, decoratedData);
        }
    }

    // Log user creation events
    logUserCreation(userId: string, email: string): void {
        this.log("USER_CREATED", { userId, email });
    }

    // Log user login events
    logUserLogin(email: string, success: boolean): void {
        this.log("USER_LOGIN", { email, success });
    }

    // Log user update events
    logUserUpdate(userId: string, updatedFields: string[]): void {
        this.log("USER_UPDATED", { userId, updatedFields });
    }

    // Log user deletion events
    logUserDeletion(userId: string): void {
        this.log("USER_DELETED", { userId });
    }

    // Log user retrieval events
    logUserRetrieval(userId: string): void {
        this.log("USER_RETRIEVED", { userId });
    }

    // Log token-related events
    logTokenUpdate(userId: string, newTokenAmount: number): void {
        this.log("USER_TOKENS_UPDATED", { userId, newTokenAmount });
    }

    // Log token reservation events
    logTokenReservation(userId: string, amount: number, operationType: string, operationId: string): void {
        this.log("TOKENS_RESERVED", { userId, amount, operationType, operationId });
    }

    // Log token confirmation events
    logTokenConfirmation(reservationId: string, tokensSpent: number, remainingBalance: number): void {
        this.log("TOKENS_CONFIRMED", { reservationId, tokensSpent, remainingBalance });
    }

    // Log token refund events
    logTokenRefund(reservationId: string, refundAmount: number, restoredBalance: number): void {
        this.log("TOKENS_REFUNDED", { reservationId, refundAmount, restoredBalance });
    }

    // Log admin token recharge events
    logAdminTokenRecharge(adminUserId: string, targetUserEmail: string, amount: number, newBalance: number): void {
        this.log("ADMIN_TOKEN_RECHARGE", { adminUserId, targetUserEmail, amount, newBalance });
    }

    // Log token balance inquiries
    logTokenBalanceCheck(userId: string, currentBalance: number): void {
        this.log("TOKEN_BALANCE_CHECKED", { userId, currentBalance });
    }
}

// Auth Route Logger Decorator
export class AuthRouteLogger extends BaseLoggerDecorator {

    log(message: string, data?: LogData): void {
        const decoratedData = { type: "AUTH_ACTION", ...data };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(message, decoratedData);
        } else {
            this.logger.info(message, decoratedData);
        }
    }

    // Log token validation events
    logTokenValidation(userId: string, email: string, success: boolean): void {
        this.log("TOKEN_VALIDATED", { email, userId, success });
    }

    // Log authorization check events
    logAuthorizationCheck(userId: string, requestedUserId: string, authorized: boolean): void {
        this.log("AUTHORIZATION_CHECKED", { userId, requestedUserId, authorized });
    }

    // Log token expiration events
    logTokenExpiration(email: string): void {
        this.log("TOKEN_EXPIRED", { email });
    }
}

// API Request/Response Logger Decorator
export class ApiRouteLogger extends BaseLoggerDecorator {

    log(message: string, data?: LogData): void {
        const decoratedData = { type: "API_ACTION", ...data };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(message, decoratedData);
        } else {
            this.logger.info(message, decoratedData);
        }
    }

    // Log API request events
    logRequest(req: Request): void {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.userId;
        this.log(`API_REQUEST: ${req.method} ${req.path}`, {
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
        this.log(`API_RESPONSE: ${req.method} ${req.path} - ${res.statusCode}`, {
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
        const errorData = {
            method: req.method,
            path: req.path,
            userId,
            error: error.message,
            stack: error.stack,
            ip: req.ip
        };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(`API_ERROR: ${req.method} ${req.path}`, errorData);
        } else {
            this.logger.error(`API_ERROR: ${req.method} ${req.path}`, { type: "API_ERROR", ...errorData });
        }
    }
}

// Error Logger Decorator
export class ErrorRouteLogger extends BaseLoggerDecorator {

    log(message: string, data?: LogData): void {
        const decoratedData = { type: "ERROR", ...data };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(message, decoratedData);
        } else {
            this.logger.error(message, decoratedData);
        }
    }

    // Log validation error events
    logValidationError(field: string, value: string | number | undefined, message: string): void {
        this.log("VALIDATION_ERROR", { field, value, message });
    }

    // Log authentication error events
    logAuthenticationError(email?: string, reason?: string): void {
        this.log("AUTHENTICATION_ERROR", { email, reason });
    }

    // Log authorization error events
    logAuthorizationError(userId?: string, resource?: string): void {
        this.log("AUTHORIZATION_ERROR", { userId, resource });
    }

    // Log database error events
    logDatabaseError(operation: string, table?: string, error?: string): void {
        this.log("DATABASE_ERROR", { operation, table, error });
    }

    // Log file upload error events
    logFileUploadError(filename?: string, size?: number, error?: string): void {
        this.log("FILE_UPLOAD_ERROR", { filename, size, error });
    }
}

// Dataset Route Logger Decorator
export class DatasetRouteLogger extends BaseLoggerDecorator {

    log(message: string, data?: LogData): void {
        const decoratedData = { type: "DATASET_ACTION", ...data };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(message, decoratedData);
        } else {
            this.logger.info(message, decoratedData);
        }
    }

    // Log dataset creation events
    logDatasetCreation(userId: string, datasetName: string, type?: string): void {
        this.log("DATASET_CREATED", { userId, datasetName, datasetType: type });
    }

    // Log dataset retrieval events
    logDatasetRetrieval(userId: string, datasetName: string): void {
        this.log("DATASET_RETRIEVED", { userId, datasetName });
    }

    // Log dataset update events
    logDatasetUpdate(userId: string, datasetName: string, processedItems?: number): void {
        this.log("DATASET_UPDATED", { userId, datasetName, processedItems });
    }

    // Log dataset deletion events
    logDatasetDeletion(userId: string, datasetName: string): void {
        this.log("DATASET_DELETED", { userId, datasetName });
    }

    // Log dataset data processing events
    logDataProcessing(userId: string, datasetName: string, fileType: string, success: boolean): void {
        this.log("DATA_PROCESSED", { userId, datasetName, fileType, success });
    }

    // Log file upload events
    logFileUpload(userId: string, datasetName: string, fileName: string, fileSize?: number): void {
        this.log("FILE_UPLOADED", { userId, datasetName, fileName, fileSize });
    }

    // Log image serving events
    logImageServed(userId: string, imagePath: string): void {
        this.log("IMAGE_SERVED", { userId, imagePath });
    }

    // Log user datasets retrieval events
    logUserDatasetsRetrieval(userId: string, count: number): void {
        this.log("USER_DATASETS_RETRIEVED", { userId, count });
    }

    // Log repository operations
    logRepositoryOperation(operation: string, userId: string, datasetName?: string): void {
        this.log("DATASET_REPOSITORY_OPERATION", { operation, userId, datasetName });
    }
}

// Inference Route Logger Decorator
export class InferenceRouteLogger extends BaseLoggerDecorator {

    log(message: string, data?: LogData): void {
        const decoratedData = { type: "INFERENCE_ACTION", ...data };
        if (this.wrappedLogger) {
            this.wrappedLogger.log(message, decoratedData);
        } else {
            this.logger.info(message, decoratedData);
        }
    }

    // Log inference creation events
    logInferenceCreation(inferenceId: string, userId: string, datasetName: string, modelId?: string): void {
        this.log("INFERENCE_CREATED", { inferenceId, userId, datasetName, modelId });
    }

    // Log inference retrieval events
    logInferenceRetrieval(inferenceId: string, userId: string): void {
        this.log("INFERENCE_RETRIEVED", { inferenceId, userId });
    }

    // Log inference status check events
    logInferenceStatusCheck(jobId: string): void {
        this.log("INFERENCE_STATUS_CHECKED", { jobId });
    }

    // Log inference results download events
    logInferenceResultsDownload(inferenceId: string, userId: string): void {
        this.log("INFERENCE_RESULTS_DOWNLOADED", { inferenceId, userId });
    }

    // Log output file serving events
    logOutputFileServed(filePath: string): void {
        this.log("OUTPUT_FILE_SERVED", { filePath });
    }

    // Log job queuing events
    logJobQueued(inferenceId: string, userId: string, jobId?: string): void {
        this.log("JOB_QUEUED", { inferenceId, userId, jobId });
    }

    // Log job validation events
    logJobValidation(success: boolean, pairCount?: number): void {
        this.log("JOB_VALIDATED", { success, pairCount });
    }

    // Log user inferences retrieval events
    logUserInferencesRetrieval(userId: string, count: number): void {
        this.log("USER_INFERENCES_RETRIEVED", { userId, count });
    }

    // Log queue operations
    logJobAdded(inferenceId: string, userId: string, jobId?: string): void {
        this.log("JOB_ADDED_TO_QUEUE", { inferenceId, userId, jobId });
    }

    logJobStatusRetrieved(jobId: string, status: string): void {
        this.log("JOB_STATUS_RETRIEVED", { jobId, status });
    }

    // Log worker operations
    logWorkerStarted(): void {
        this.log("INFERENCE_WORKER_STARTED", {});
    }

    // Log worker stop events
    logWorkerStopped(): void {
        this.log("INFERENCE_WORKER_STOPPED", {});
    }

    // Log worker start events
    logJobProcessingStarted(jobId: string, inferenceId: string): void {
        this.log("JOB_PROCESSING_STARTED", { jobId, inferenceId });
    }

    // Log job completion events
    logJobProcessingCompleted(jobId: string, inferenceId: string): void {
        this.log("JOB_PROCESSING_COMPLETED", { jobId, inferenceId });
    }

    // Log job failure events
    logJobProcessingFailed(jobId: string, inferenceId: string, error: string): void {
        this.log("JOB_PROCESSING_FAILED", { jobId, inferenceId, error });
    }

    // Log blackbox adapter operations
    logBlackBoxProcessingStarted(userId: string): void {
        this.log("BLACKBOX_PROCESSING_STARTED", { userId });
    }

    // Log blackbox processing completion events
    logBlackBoxProcessingCompleted(userId: string, imageCount?: number, videoCount?: number): void {
        this.log("BLACKBOX_PROCESSING_COMPLETED", { userId, imageCount, videoCount });
    }

    // Log blackbox processing failure events
    logBlackBoxProcessingFailed(userId: string, error: string): void {
        this.log("BLACKBOX_PROCESSING_FAILED", { userId, error });
    }

    // Log queue connection operations
    logQueueConnected(): void {
        this.log("INFERENCE_QUEUE_CONNECTED", {});
    }

    // Log queue disconnection events
    logQueueClosed(): void {
        this.log("INFERENCE_QUEUE_CLOSED", {});
    }

    // Log data processing events (adding missing method used in service)
    logDataProcessing(userId: string, datasetName: string, operationType: string, success: boolean): void {
        this.log("DATA_PROCESSING", { userId, datasetName, operationType, success });
    }
}