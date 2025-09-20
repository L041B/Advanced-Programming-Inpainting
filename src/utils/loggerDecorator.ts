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

    // Log token-related events
    logTokenUpdate(userId: string, newTokenAmount: number): void {
        this.logger.info("USER_TOKENS_UPDATED", { type: "USER_ACTION", userId, newTokenAmount });
    }

    logTokenReservation(userId: string, amount: number, operationType: string, reservationId: string): void {
        this.logger.info("TOKENS_RESERVED", { type: "TOKEN_ACTION", userId, amount, operationType, reservationId });
    }

    logTokenUsage(userId: string, amount: number, operationType: string): void {
        this.logger.info("TOKENS_USED", { type: "TOKEN_ACTION", userId, amount, operationType });
    }

    logTokenRefund(userId: string, amount: number, operationType: string): void {
        this.logger.info("TOKENS_REFUNDED", { type: "TOKEN_ACTION", userId, amount, operationType });
    }

    logTokenRecharge(userId: string, amount: number, adminUserId: string): void {
        this.logger.info("TOKENS_RECHARGED", { type: "TOKEN_ACTION", userId, amount, adminUserId });
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

// Dataset Route Logger Decorator
export class DatasetRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.info(message, { type: "DATASET_ACTION", ...data });
    }

    // Log dataset creation events
    logDatasetCreation(userId: string, datasetName: string, type?: string): void {
        this.logger.info("DATASET_CREATED", { type: "DATASET_ACTION", userId, datasetName, datasetType: type });
    }

    // Log dataset retrieval events
    logDatasetRetrieval(userId: string, datasetName: string): void {
        this.logger.info("DATASET_RETRIEVED", { type: "DATASET_ACTION", userId, datasetName });
    }

    // Log dataset update events
    logDatasetUpdate(userId: string, datasetName: string, processedItems?: number): void {
        this.logger.info("DATASET_UPDATED", { type: "DATASET_ACTION", userId, datasetName, processedItems });
    }

    // Log dataset deletion events
    logDatasetDeletion(userId: string, datasetName: string): void {
        this.logger.info("DATASET_DELETED", { type: "DATASET_ACTION", userId, datasetName });
    }

    // Log dataset data processing events
    logDataProcessing(userId: string, datasetName: string, fileType: string, success: boolean): void {
        this.logger.info("DATA_PROCESSED", { type: "DATASET_ACTION", userId, datasetName, fileType, success });
    }

    // Log file upload events
    logFileUpload(userId: string, datasetName: string, fileName: string, fileSize?: number): void {
        this.logger.info("FILE_UPLOADED", { type: "DATASET_ACTION", userId, datasetName, fileName, fileSize });
    }

    // Log image serving events
    logImageServed(userId: string, imagePath: string): void {
        this.logger.info("IMAGE_SERVED", { type: "DATASET_ACTION", userId, imagePath });
    }

    // Log user datasets retrieval events
    logUserDatasetsRetrieval(userId: string, count: number): void {
        this.logger.info("USER_DATASETS_RETRIEVED", { type: "DATASET_ACTION", userId, count });
    }

    // Log repository operations
    logRepositoryOperation(operation: string, userId: string, datasetName?: string): void {
        this.logger.info("DATASET_REPOSITORY_OPERATION", { type: "DATASET_ACTION", operation, userId, datasetName });
    }
}

// Inference Route Logger Decorator
export class InferenceRouteLogger extends BaseLoggerDecorator {
    log(message: string, data?: LogData): void {
        this.logger.info(message, { type: "INFERENCE_ACTION", ...data });
    }

    // Log inference creation events
    logInferenceCreation(inferenceId: string, userId: string, datasetName: string, modelId?: string): void {
        this.logger.info("INFERENCE_CREATED", { type: "INFERENCE_ACTION", inferenceId, userId, datasetName, modelId });
    }

    // Log inference retrieval events
    logInferenceRetrieval(inferenceId: string, userId: string): void {
        this.logger.info("INFERENCE_RETRIEVED", { type: "INFERENCE_ACTION", inferenceId, userId });
    }

    // Log inference status check events
    logInferenceStatusCheck(jobId: string): void {
        this.logger.info("INFERENCE_STATUS_CHECKED", { type: "INFERENCE_ACTION", jobId });
    }

    // Log inference results download events
    logInferenceResultsDownload(inferenceId: string, userId: string): void {
        this.logger.info("INFERENCE_RESULTS_DOWNLOADED", { type: "INFERENCE_ACTION", inferenceId, userId });
    }

    // Log output file serving events
    logOutputFileServed(filePath: string): void {
        this.logger.info("OUTPUT_FILE_SERVED", { type: "INFERENCE_ACTION", filePath });
    }

    // Log job queuing events
    logJobQueued(inferenceId: string, userId: string, jobId?: string): void {
        this.logger.info("JOB_QUEUED", { type: "INFERENCE_ACTION", inferenceId, userId, jobId });
    }

    // Log job validation events
    logJobValidation(success: boolean, pairCount?: number): void {
        this.logger.info("JOB_VALIDATED", { type: "INFERENCE_ACTION", success, pairCount });
    }

    // Log user inferences retrieval events
    logUserInferencesRetrieval(userId: string, count: number): void {
        this.logger.info("USER_INFERENCES_RETRIEVED", { type: "INFERENCE_ACTION", userId, count });
    }

    // Log queue operations
    logJobAdded(inferenceId: string, userId: string, jobId?: string): void {
        this.logger.info("JOB_ADDED_TO_QUEUE", { type: "INFERENCE_ACTION", inferenceId, userId, jobId });
    }

    logJobStatusRetrieved(jobId: string, status: string): void {
        this.logger.info("JOB_STATUS_RETRIEVED", { type: "INFERENCE_ACTION", jobId, status });
    }

    // Log worker operations
    logWorkerStarted(): void {
        this.logger.info("INFERENCE_WORKER_STARTED", { type: "INFERENCE_ACTION" });
    }

    logWorkerStopped(): void {
        this.logger.info("INFERENCE_WORKER_STOPPED", { type: "INFERENCE_ACTION" });
    }

    logJobProcessingStarted(jobId: string, inferenceId: string): void {
        this.logger.info("JOB_PROCESSING_STARTED", { type: "INFERENCE_ACTION", jobId, inferenceId });
    }

    logJobProcessingCompleted(jobId: string, inferenceId: string): void {
        this.logger.info("JOB_PROCESSING_COMPLETED", { type: "INFERENCE_ACTION", jobId, inferenceId });
    }

    logJobProcessingFailed(jobId: string, inferenceId: string, error: string): void {
        this.logger.error("JOB_PROCESSING_FAILED", { type: "INFERENCE_ACTION", jobId, inferenceId, error });
    }

    // Log blackbox adapter operations
    logBlackBoxProcessingStarted(userId: string): void {
        this.logger.info("BLACKBOX_PROCESSING_STARTED", { type: "INFERENCE_ACTION", userId });
    }

    logBlackBoxProcessingCompleted(userId: string, imageCount?: number, videoCount?: number): void {
        this.logger.info("BLACKBOX_PROCESSING_COMPLETED", { type: "INFERENCE_ACTION", userId, imageCount, videoCount });
    }

    logBlackBoxProcessingFailed(userId: string, error: string): void {
        this.logger.error("BLACKBOX_PROCESSING_FAILED", { type: "INFERENCE_ACTION", userId, error });
    }

    // Log queue connection operations
    logQueueConnected(): void {
        this.logger.info("INFERENCE_QUEUE_CONNECTED", { type: "INFERENCE_ACTION" });
    }

    logQueueClosed(): void {
        this.logger.info("INFERENCE_QUEUE_CLOSED", { type: "INFERENCE_ACTION" });
    }
}