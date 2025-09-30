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

    // Validate that all parameter values are strings
    if (parameters && typeof parameters === "object") {
        // Define supported output formats
        const SUPPORTED_OUTPUT_FORMATS = ["png", "jpg", "jpeg", "mp4", "avi"];
        const ALLOWED_PARAMETER_KEYS = ["quality", "blendMode", "outputFormat", "customParameter"];
        
        // Check for invalid parameter keys
        const parameterKeys = Object.keys(parameters);
        const invalidKeys = parameterKeys.filter(key => !ALLOWED_PARAMETER_KEYS.includes(key));
        
        if (invalidKeys.length > 0) {
            errorLogger.logValidationError(
                "parameters",
                `Invalid keys: ${invalidKeys.join(", ")}`,
                `Parameters can only contain these keys: ${ALLOWED_PARAMETER_KEYS.join(", ")}`
            );
            return next(errorManager.createError(
                ErrorStatus.invalidFormat,
                `Invalid parameter: ${invalidKeys.join(", ")}. Allowed parameters are: ${ALLOWED_PARAMETER_KEYS.join(", ")}`
            ));
        }
        
        for (const [key, value] of Object.entries(parameters)) {
            if (typeof value !== "string") {
                errorLogger.logValidationError(
                    `parameters.${key}`,
                    typeof value === "object" ? JSON.stringify(value) : String(value),
                    `Parameter "${key}" must be a string value`
                );
                return next(errorManager.createError(
                    ErrorStatus.invalidFormat, 
                    `Parameters must be a string value. Received: ${typeof value}`
                ));
            }
            
            // Special validation for outputFormat parameter
            if (key === "outputFormat") {
                // Remove leading dot if present and convert to lowercase for comparison
                const normalizedFormat = value.toLowerCase().replace(/^\./, "");
                
                if (!SUPPORTED_OUTPUT_FORMATS.includes(normalizedFormat)) {
                    const displayFormats = SUPPORTED_OUTPUT_FORMATS.map(format => `.${format}`);
                    errorLogger.logValidationError(
                        `parameters.${key}`,
                        value,
                        `Parameter "outputFormat" must be one of: ${displayFormats.join(", ")}`
                    );
                    return next(errorManager.createError(
                        ErrorStatus.invalidFormat,
                        `Parameter "outputFormat" must be one of the supported formats: ${displayFormats.join(", ")}. Received: ${value}`
                    ));
                }
            }
        }
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