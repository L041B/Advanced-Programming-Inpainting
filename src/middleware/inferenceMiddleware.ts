// Import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
import { validateInferenceIdFormat } from "./validationMiddleware";
import { validateInferenceFieldLengths, validateParametersSize, FIELD_LIMITS } from "./fieldLengthMiddleware";

// Initialize singletons
const errorManager = ErrorManager.getInstance();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Extend Express Request to include user info added by auth middleware
interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

// checkCreateInferenceFields middleware validates request body for creating an inference
const checkCreateInferenceFields = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const body = req.body as { datasetName?: string; modelId?: string; parameters?: unknown };
    let { datasetName, modelId, parameters } = body;

    // Trim string inputs
    if (typeof datasetName === "string") datasetName = datasetName.trim();
    if (typeof modelId === "string") modelId = modelId.trim();

    // Validate datasetName
    if (!datasetName || typeof datasetName !== "string" || datasetName.length === 0) {
        errorLogger.logValidationError("datasetName", datasetName, "A non-empty \"datasetName\" string is required.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "Dataset name is required and cannot be empty or contain only spaces."));
    }

    // Check datasetName length
    if (datasetName.length > FIELD_LIMITS.DATASET_NAME) {
        errorLogger.logValidationError("datasetName", `length: ${datasetName.length}`, `Dataset name exceeds maximum length of ${FIELD_LIMITS.DATASET_NAME} characters`);
        return next(errorManager.createError(ErrorStatus.invalidFormat, `Dataset name exceeds maximum length of ${FIELD_LIMITS.DATASET_NAME} characters (current: ${datasetName.length})`));
    }

    // Validate optional fields
    if (modelId !== undefined && (typeof modelId !== "string" || modelId.length === 0)) {
        errorLogger.logValidationError("modelId", modelId, "\"modelId\" must be a non-empty string if provided.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "Model ID must be a non-empty string if provided and cannot contain only spaces."));
    }

    // Check modelId length if provided
    if (modelId && modelId.length > FIELD_LIMITS.MODEL_ID) {
        errorLogger.logValidationError("modelId", `length: ${modelId.length}`, `Model ID exceeds maximum length of ${FIELD_LIMITS.MODEL_ID} characters`);
        return next(errorManager.createError(ErrorStatus.invalidFormat, `Model ID exceeds maximum length of ${FIELD_LIMITS.MODEL_ID} characters (current: ${modelId.length})`));
    }

    // parameters is optional but if provided must be a JSON object
    if (parameters !== undefined && (typeof parameters !== "object" || Array.isArray(parameters) || parameters === null)) {
        errorLogger.logValidationError(
            "parameters",
            parameters === null ? "null" : Array.isArray(parameters) ? "array" : typeof parameters === "object" ? "object" : String(parameters),
            "\"parameters\" must be a JSON object if provided."
        );
        return next(errorManager.createError(ErrorStatus.invalidFormat, "\"parameters\" must be a JSON object if provided."));
    }

    // Update body with trimmed values
    req.body = { ...body, datasetName, modelId, parameters };
    next();
};

// validateInferenceCreation is a chain of middlewares for validating inference creation requests
export const validateInferenceCreation = [
    checkCreateInferenceFields,
    validateInferenceFieldLengths,
    validateParametersSize
];

// validateInferenceAccess is a chain for accessing a specific inference by its ID.
export const validateInferenceAccess = [
    validateInferenceIdFormat
];