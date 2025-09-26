// Import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
import { validateInferenceIdFormat } from "./validationMiddleware";

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
        let parametersType: string;
        if (parameters === null) {
            parametersType = "null";
        } else if (Array.isArray(parameters)) {
            parametersType = "array";
        } else if (typeof parameters === "object") {
            parametersType = JSON.stringify(parameters);
        } else {
            parametersType = JSON.stringify(parameters);
        }
        errorLogger.logValidationError(
            "parameters",
            parametersType,
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
    checkCreateInferenceFields
];

// validateInferenceAccess is a chain for accessing a specific inference by its ID.
export const validateInferenceAccess = [
    validateInferenceIdFormat
];