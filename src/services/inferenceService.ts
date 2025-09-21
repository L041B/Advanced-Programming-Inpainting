// Imports necessary modules and types
import { DatasetRepository } from "../repository/datasetRepository";
import { InferenceRepository } from "../repository/inferenceRepository";
import { InferenceBlackBoxProxy } from "../proxy/inferenceBlackBoxProxy";
import { TokenService } from "./tokenService";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import jwt from "jsonwebtoken";

interface CreateInferenceData {
    datasetName: string;
    modelId?: string;
    parameters?: Record<string, unknown>;
}

interface DatasetPair {
    imagePath: string;
    maskPath: string;
    frameIndex?: number;
    uploadIndex?: string | number;
}

interface Dataset {
    id: string;
    name: string;
    data: {
        pairs: DatasetPair[];
    };
}

interface InferenceResponse {
    id: string;
    userId: string;
    datasetName: string;
    modelId: string;
    status: string;
    parameters: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
    toJSON(): InferenceResponse;
}

// InferenceService encapsulates the business logic for managing inferences.
export class InferenceService {
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly inferenceRepository = InferenceRepository.getInstance();
    private static readonly tokenService = TokenService.getInstance();
    private static readonly proxy = InferenceBlackBoxProxy.getInstance();
    private static readonly errorManager = ErrorManager.getInstance();
    private static readonly inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

    // Main method to create an inference, handling validation, cost calculation, token reservation, and job queuing.
    static async createInference(userId: string, data: CreateInferenceData): Promise<{ inference: InferenceResponse; jobId: string }> {
        let tokenReservationId: string | undefined;
        InferenceService.inferenceLogger.logInferenceCreation("service_start", userId, data.datasetName, data.modelId);

        try {
            // Validation dataset
            const dataset = await InferenceService.validateDatasetForInference(userId, data.datasetName);
            
            // Cost calculation
            const cost = InferenceService.tokenService.calculateInferenceCost(dataset.data);
            InferenceService.inferenceLogger.log("Token cost calculated", { 
                userId, 
                totalCost: cost.totalCost, 
                breakdown: JSON.stringify(cost.breakdown) 
            });

            // Validate cost
            if (cost.totalCost <= 0) {
                InferenceService.errorLogger.logValidationError("tokenCost", cost.totalCost, "Cost calculation resulted in zero tokens");
                throw InferenceService.errorManager.createError(ErrorStatus.invalidDatasetDataError, "Cannot start inference, cost is zero. The dataset might be empty or invalid.");
            }

            // Token reservation (before database creation)
            tokenReservationId = await InferenceService.reserveTokensOrThrow(userId, cost.totalCost, dataset.id);

            // Log token reservation success
            InferenceService.inferenceLogger.log("Tokens reserved successfully, proceeding to database creation", { 
                userId, 
                tokenReservationId,
                totalCost: cost.totalCost
            });

            // Create database record only after successful token reservation
            const inferenceRecord = await InferenceService.inferenceRepository.createInference({
                userId,
                datasetId: dataset.id,
                modelId: data.modelId || "default_model",
                parameters: { 
                    ...data.parameters, 
                    tokenReservationId, 
                    tokenCost: cost.totalCost,
                    costBreakdown: cost.breakdown
                }
            });

            // Log inference creation
            InferenceService.inferenceLogger.logInferenceCreation(inferenceRecord.id, userId, dataset.name, data.modelId);

            // Create response object
            const inferenceResponse: InferenceResponse = {
                id: inferenceRecord.id,
                userId: inferenceRecord.userId,
                datasetName: data.datasetName,
                modelId: inferenceRecord.modelId,
                status: inferenceRecord.status,
                parameters: inferenceRecord.parameters ?? {},
                createdAt: inferenceRecord.createdAt,
                updatedAt: inferenceRecord.updatedAt,
                toJSON: function(this: InferenceResponse) { 
                    return {
                        id: this.id,
                        userId: this.userId,
                        datasetName: this.datasetName,
                        modelId: this.modelId,
                        status: this.status,
                        parameters: this.parameters,
                        createdAt: this.createdAt,
                        updatedAt: this.updatedAt
                    } as InferenceResponse;
                }
            };

            // Job queuing
            const jobId = await InferenceService.queueInferenceJobOrThrow(
                inferenceResponse,
                userId,
                dataset
            );

            // Log job queued
            InferenceService.inferenceLogger.logJobQueued(inferenceRecord.id, userId, jobId);
            return { inference: inferenceResponse, jobId };

        } catch (error) {
            // Error handling and cleanup
            const err = error as Error & { errorType?: ErrorStatus };
            InferenceService.errorLogger.logDatabaseError("CREATE_INFERENCE_SERVICE", "inference", err.message);
            InferenceService.inferenceLogger.log("Inference creation failed, initiating cleanup", { 
                userId, 
                error: err.message, 
                errorType: err.errorType,
                hadTokenReservation: !!tokenReservationId
            });
            
            // If tokens were reserved, attempt to refund them
            await InferenceService.compensateTokenReservation(tokenReservationId);
            throw error;
        }
    }

    // Attempts to reserve tokens for the inference, throwing errors for any issues encountered.
    private static async reserveTokensOrThrow(userId: string, totalCost: number, datasetId: string): Promise<string> {
        const operationId = `inference_on_${datasetId}`;
        InferenceService.inferenceLogger.log("Token reservation requested", { userId, amount: totalCost, type: "inference", operationId });

        // Validate cost
        type ReservationResult = string | { success: boolean; reservationId?: string; error?: string };
        const reservationResult: ReservationResult = await InferenceService.tokenService.reserveTokens(userId, totalCost, "inference", operationId);

        // Handle different response types
        if (typeof reservationResult === "string") {
            return InferenceService.handleStringReservationResult(reservationResult, userId, totalCost);
        }

        return InferenceService.handleObjectReservationResult(reservationResult, userId, totalCost);
    }

    // Handles string responses from the token reservation service.
    private static handleStringReservationResult(reservationResult: string, userId: string, totalCost: number): string {
        // Validate error string
        if (InferenceService.isErrorString(reservationResult)) {
            InferenceService.errorLogger.logDatabaseError("RESERVE_TOKENS", "token_service", reservationResult);
            throw InferenceService.errorManager.createError(ErrorStatus.tokenReservationFailedError, reservationResult);
        }

        // Validate UUID
        if (InferenceService.isValidUUID(reservationResult)) {
            InferenceService.inferenceLogger.log("Tokens reserved successfully", { userId, reservationId: reservationResult, amount: totalCost });
            return reservationResult;
        }

        // Unexpected response
        InferenceService.errorLogger.logDatabaseError("RESERVE_TOKENS", "token_service", `Unexpected response: ${reservationResult}`);
        throw InferenceService.errorManager.createError(ErrorStatus.tokenReservationFailedError, `Unexpected token service response: ${reservationResult}`);
    }

    // Handles object responses from the token reservation service.
    private static handleObjectReservationResult(
        reservationResult: { success: boolean; reservationId?: string; error?: string },
        userId: string,
        totalCost: number
    ): string {
        // Validate success flag
        if (!reservationResult?.success) {
            const errorMsg = reservationResult?.error || "Token reservation failed";
            InferenceService.errorLogger.logDatabaseError("RESERVE_TOKENS", "token_service", errorMsg);
            
            // Specific error handling
            if (errorMsg.includes("Insufficient tokens")) {
                throw InferenceService.errorManager.createError(ErrorStatus.insufficientTokensError, errorMsg);
            }
            throw InferenceService.errorManager.createError(ErrorStatus.tokenReservationFailedError, errorMsg);
        }

        // Validate reservation ID
        if (reservationResult.reservationId) {
            InferenceService.inferenceLogger.log("Tokens reserved successfully", { userId, reservationId: reservationResult.reservationId, amount: totalCost });
            return reservationResult.reservationId;
        }

        // Missing reservation ID
        InferenceService.errorLogger.logDatabaseError("RESERVE_TOKENS", "token_service", "No reservation ID returned from token service");
        throw InferenceService.errorManager.createError(ErrorStatus.tokenReservationFailedError, "Token service did not return a reservation ID");
    }

    // Validates if a string is an error message.
    private static isErrorString(result: string): boolean {
        return result.startsWith("Error:") || result.includes("Insufficient tokens") || result.includes("failed");
    }

    // Validates if a string is a valid UUID.
    private static isValidUUID(result: string): boolean {
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        return uuidRegex.test(result);
    }

    // Attempts to refund reserved tokens in case of inference creation failure.
    private static async compensateTokenReservation(tokenReservationId?: string): Promise<void> {
        if (!tokenReservationId) return;
        
        try {
            // Refund tokens
            InferenceService.inferenceLogger.log("Initiating token refund for failed inference", { tokenReservationId });
            const refundResult = await InferenceService.tokenService.refundTokens(tokenReservationId);
            
            // Log refund result
            if (typeof refundResult === "object" && refundResult !== null) {
                InferenceService.inferenceLogger.log("Token refund processed successfully", {
                    tokenReservationId,
                    tokensRefunded: refundResult.tokensRefunded || 0,
                    restoredBalance: refundResult.restoredBalance || 0
                });
            }
        } catch (refundError) {
            const refundErr = refundError as Error;
            InferenceService.errorLogger.logDatabaseError("REFUND_TOKENS", "compensation", refundErr.message);
            // Don't rethrow the refund error, just log it
            InferenceService.errorLogger.logDatabaseError("TOKEN_CLEANUP_FAILED", "compensation", `Failed to refund tokens for reservation ${tokenReservationId}: ${refundErr.message}`);
        }
    }

    // Queues the inference job with the external inference proxy service.
    private static async queueInferenceJobOrThrow(
        inferenceRecord: InferenceResponse,
        userId: string,
        dataset: Dataset
    ): Promise<string> {
        // Queue job with the inference proxy
        InferenceService.inferenceLogger.log("Queuing inference job", { inferenceId: inferenceRecord.id, userId });
        const jobResult = await InferenceService.proxy.processDataset(
            inferenceRecord.id,
            userId,
            dataset.data,
            inferenceRecord.parameters || {}
        );

        // Handle different response types
        if (typeof jobResult === "string") {
            if (jobResult.startsWith("Error:")) {
                InferenceService.errorLogger.logDatabaseError("QUEUE_JOB", "inference_proxy", jobResult);
                throw InferenceService.errorManager.createError(ErrorStatus.jobAdditionFailedError, jobResult);
            }
            return jobResult;
        } else if (
            // Object with success flag
            typeof jobResult === "object" &&
            jobResult !== null &&
            "success" in jobResult &&
            (jobResult as { success: boolean }).success &&
            "jobId" in jobResult
        ) {
            return (jobResult as { jobId: string }).jobId;
        } else {
            InferenceService.errorLogger.logDatabaseError(
                "QUEUE_JOB",
                "inference_proxy",
                (typeof jobResult === "object" && jobResult !== null && "error" in jobResult)
                    ? (jobResult as { error?: string }).error || "Failed to queue job"
                    : "Failed to queue job"
            );
            throw InferenceService.errorManager.createError(
                ErrorStatus.jobAdditionFailedError,
                (typeof jobResult === "object" && jobResult !== null && "error" in jobResult)
                    ? (jobResult as { error?: string }).error || "Failed to queue inference job"
                    : "Failed to queue inference job"
            );
        }
    }

    // Validates that the dataset exists and is non-empty for the given user.
    private static async validateDatasetForInference(userId: string, datasetName: string): Promise<Dataset> {
        try {
            // Log the start of dataset validation
            InferenceService.inferenceLogger.log("Starting dataset validation", { userId, datasetName });
            
            // Fetch dataset
            const dataset = await InferenceService.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
            if (!dataset) {
                InferenceService.errorLogger.logDatabaseError("VALIDATE_DATASET", "datasets", `Dataset '${datasetName}' not found for user ${userId}`);
                throw InferenceService.errorManager.createError(ErrorStatus.resourceNotFoundError, "The specified dataset was not found.");
            }

            // Check if dataset has an ID
            if (!dataset.id) {
                InferenceService.errorLogger.logDatabaseError("VALIDATE_DATASET", "datasets", `Dataset '${datasetName}' has no ID`);
                throw InferenceService.errorManager.createError(ErrorStatus.invalidDatasetDataError, "Dataset is missing required ID field.");
            }

            // Log dataset found
            InferenceService.inferenceLogger.log("Dataset found", { 
                userId, 
                datasetName,
                datasetId: dataset.id,
                hasData: !!dataset.data
            });
            
            // Validate dataset content
            const data = dataset.data as { pairs: DatasetPair[] } | null;
            if (!(data?.pairs?.length)) {
                InferenceService.errorLogger.logValidationError("dataset_pairs", data?.pairs?.length || 0, "Dataset contains no valid pairs");
                throw InferenceService.errorManager.createError(ErrorStatus.emptyDatasetError, "The selected dataset is empty.");
            }
            
            // Log successful validation
            InferenceService.inferenceLogger.logDataProcessing(userId, datasetName, "validation", true);
            InferenceService.inferenceLogger.log("Dataset validation completed", { 
                userId, 
                datasetName,
                datasetId: dataset.id, 
                pairCount: data.pairs.length 
            });
            
            return { 
                id: dataset.id,
                name: dataset.name,
                data 
            } as Dataset;
        } catch (error) {
            if (error instanceof Error && (error as Error & { errorType?: ErrorStatus }).errorType) {
                throw error;
            }
            const err = error as Error;
            InferenceService.errorLogger.logDatabaseError("VALIDATE_DATASET", "datasets", err.message);
            throw InferenceService.errorManager.createError(ErrorStatus.readInternalServerError, "Failed to validate dataset for inference.");
        }
    }

    // Validates a file access token and extracts the user ID and file path.
    static async validateFileToken(token: string): Promise<{ userId: string; filePath: string }> {
        try {
            // Log token validation attempt
            InferenceService.inferenceLogger.log("Validating file access token", { tokenPrefix: token.substring(0, 10) + "..." });

            // Decode the JWT token
            const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; filePath: string; type: string };
            
            // Validate token structure
            if (!decoded?.userId || !decoded?.filePath) {
                InferenceService.errorLogger.logAuthenticationError(undefined, "Invalid token structure");
                throw InferenceService.errorManager.createError(ErrorStatus.jwtNotValid, "The file access token is malformed.");
            }
            
            // Validate token type
            if (decoded.type !== "file_access") {
                InferenceService.errorLogger.logAuthenticationError(undefined, "Wrong token type for file access");
                throw InferenceService.errorManager.createError(ErrorStatus.jwtNotValid, "This token is not valid for file access.");
            }
            
            // Ensure the file path belongs to the user 
            if (!decoded.filePath.startsWith(`inferences/${decoded.userId}/`)) {
                InferenceService.errorLogger.logAuthorizationError(decoded.userId, decoded.filePath);
                throw InferenceService.errorManager.createError(ErrorStatus.userNotAuthorized, "Access to this file is denied.");
            }
            
            // Log successful validation
            InferenceService.inferenceLogger.log("File token validated successfully", { userId: decoded.userId, filePath: decoded.filePath });
            return { userId: decoded.userId, filePath: decoded.filePath };
            
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError) {
                InferenceService.errorLogger.logAuthenticationError(undefined, `JWT validation failed: ${error.message}`);
                throw InferenceService.errorManager.createError(ErrorStatus.jwtNotValid, "The file access link is invalid or expired.");
            }
            
            // Log token validation failure
            if (error instanceof Error && (error as Error & { errorType?: ErrorStatus }).errorType) {
                throw error;
            }

            // Log unexpected errors
            const err = error as Error;
            InferenceService.errorLogger.logDatabaseError("VALIDATE_FILE_TOKEN", "jwt", err.message);
            throw InferenceService.errorManager.createError(ErrorStatus.readInternalServerError, "Failed to validate file token.");
        }
    }
}