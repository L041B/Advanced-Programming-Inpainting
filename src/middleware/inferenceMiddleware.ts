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
    const { datasetName, modelId, parameters } = req.body;

    // Validate datasetName
    if (!datasetName || typeof datasetName !== "string" || datasetName.trim().length === 0) {
        errorLogger.logValidationError("datasetName", datasetName, "A non-empty \"datasetName\" string is required.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "A non-empty \"datasetName\" string is required."));
    }

    // Validate optional fields
    if (modelId !== undefined && typeof modelId !== "string") {
        errorLogger.logValidationError("modelId", modelId, "\"modelId\" must be a string if provided.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "\"modelId\" must be a string if provided."));
    }

    // parameters is optional but if provided must be a JSON object
    if (parameters !== undefined && (typeof parameters !== "object" || Array.isArray(parameters) || parameters === null)) {
        errorLogger.logValidationError("parameters", parameters, "\"parameters\" must be a JSON object if provided.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "\"parameters\" must be a JSON object if provided."));
    }

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

    // Validate presence and format of token
    const { token } = req.params;
    if (!token || typeof token !== "string" || token.trim().length === 0) {
        errorLogger.logValidationError("token", token, "A file access token is required in the URL path.");
        return next(errorManager.createError(ErrorStatus.invalidFormat, "A file access token is required."));
    }

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