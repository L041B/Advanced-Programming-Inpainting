// Import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

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

    // Validate optional fields
    if (modelId !== undefined && (typeof modelId !== "string" || modelId.length === 0)) {
        errorLogger.logValidationError("modelId", modelId, "\"modelId\" must be a non-empty string if provided.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "Model ID must be a non-empty string if provided and cannot contain only spaces."));
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

// checkInferenceIdParam validates that the 'id' from the URL parameters is a valid UUID
const checkInferenceIdParam = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    
    // Validate presence and format of id
    if (!id || !uuidRegex.test(id)) {
        errorLogger.logValidationError("inferenceId", id, "A valid inference ID (UUID) is required in the URL path.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "A valid inference ID is required."));
    }

    next();
};

// checkFileTokenParam validates that the 'token' from the URL for file access is present.
const checkFileTokenParam = (req: AuthRequest, res: Response, next: NextFunction): void => {
    let { token } = req.params;
    
    // Trim token if it's a string
    if (typeof token === "string") token = token.trim();

    // Validate presence and format of token
    if (!token || typeof token !== "string" || token.length === 0) {
        errorLogger.logValidationError("token", token, "A file access token is required in the URL path.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "A file access token is required and cannot be empty or contain only spaces."));
    }

    // Update params with trimmed token
    req.params = { ...req.params, token };
    next();
};


// validateInferenceCreation is a chain of middlewares for validating inference creation requests
export const validateInferenceCreation = [
    checkCreateInferenceFields
];

// @const validateInferenceAccess is a chain for accessing a specific inference by its ID.
export const validateInferenceAccess = [
    checkInferenceIdParam
];

// validateFileAccess is a chain for accessing a protected file via a token.
export const validateFileAccess = [
    checkFileTokenParam
];