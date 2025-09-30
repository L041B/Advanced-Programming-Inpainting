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

// Helper function to validate dataset name
const validateDatasetName = (datasetName: string | undefined): string | null => {
    if (!datasetName || typeof datasetName !== "string" || datasetName.length === 0) {
        errorLogger.logValidationError("datasetName", datasetName, "A non-empty \"datasetName\" string is required.");
        return "Dataset name is required and cannot be empty or contain only spaces.";
    }

    if (datasetName.length > FIELD_LIMITS.DATASET_NAME) {
        errorLogger.logValidationError("datasetName", `length: ${datasetName.length}`, `Dataset name exceeds maximum length of ${FIELD_LIMITS.DATASET_NAME} characters`);
        return `Dataset name exceeds maximum length of ${FIELD_LIMITS.DATASET_NAME} characters (current: ${datasetName.length})`;
    }

    return null;
};

// Helper function to validate model ID
const validateModelId = (modelId: string | undefined): string | null => {
    if (modelId !== undefined && (typeof modelId !== "string" || modelId.length === 0)) {
        errorLogger.logValidationError("modelId", modelId, "\"modelId\" must be a non-empty string if provided.");
        return "Model ID must be a non-empty string if provided and cannot contain only spaces.";
    }

    if (modelId && modelId.length > FIELD_LIMITS.MODEL_ID) {
        errorLogger.logValidationError("modelId", `length: ${modelId.length}`, `Model ID exceeds maximum length of ${FIELD_LIMITS.MODEL_ID} characters`);
        return `Model ID exceeds maximum length of ${FIELD_LIMITS.MODEL_ID} characters (current: ${modelId.length})`;
    }

    return null;
};

// Helper function to validate parameters object type
const validateParametersType = (parameters: unknown): string | null => {
    if (parameters !== undefined && (typeof parameters !== "object" || Array.isArray(parameters) || parameters === null)) {
        let parametersType: string;
        if (parameters === null) {
            parametersType = "null";
        } else if (Array.isArray(parameters)) {
            parametersType = "array";
        } else {
            parametersType = JSON.stringify(parameters);
        }
        errorLogger.logValidationError(
            "parameters",
            parametersType,
            "\"parameters\" must be a JSON object if provided."
        );
        return "\"parameters\" must be a JSON object if provided.";
    }
    return null;
};

// Helper function to validate parameter keys
const validateParameterKeys = (parameters: Record<string, unknown>): string | null => {
    const ALLOWED_PARAMETER_KEYS = ["quality", "blendMode", "outputFormat", "customParameter"];
    const parameterKeys = Object.keys(parameters);
    const invalidKeys = parameterKeys.filter(key => !ALLOWED_PARAMETER_KEYS.includes(key));
    
    if (invalidKeys.length > 0) {
        errorLogger.logValidationError(
            "parameters",
            `Invalid keys: ${invalidKeys.join(", ")}`,
            `Parameters can only contain these keys: ${ALLOWED_PARAMETER_KEYS.join(", ")}`
        );
        return `Invalid parameter: ${invalidKeys.join(", ")}. Allowed parameters are: ${ALLOWED_PARAMETER_KEYS.join(", ")}`;
    }
    return null;
};

// Helper function to validate output format
const validateOutputFormat = (value: string): string | null => {
    const SUPPORTED_OUTPUT_FORMATS = ["png", "jpg", "jpeg", "mp4", "avi"];
    const normalizedFormat = value.toLowerCase().replace(/^\./, "");
    
    if (!SUPPORTED_OUTPUT_FORMATS.includes(normalizedFormat)) {
        const displayFormats = SUPPORTED_OUTPUT_FORMATS.map(format => `.${format}`);
        errorLogger.logValidationError(
            "parameters.outputFormat",
            value,
            `Parameter "outputFormat" must be one of: ${displayFormats.join(", ")}`
        );
        return `Parameter "outputFormat" must be one of the supported formats: ${displayFormats.join(", ")}. Received: ${value}`;
    }
    return null;
};

// Helper function to validate parameter values
const validateParameterValues = (parameters: Record<string, unknown>): string | null => {
    for (const [key, value] of Object.entries(parameters)) {
        if (typeof value !== "string") {
            const valueString = typeof value === "object" && value !== null 
                ? JSON.stringify(value) 
                : String(value);
            errorLogger.logValidationError(
                `parameters.${key}`,
                valueString,
                `Parameter "${key}" must be a string value`
            );
            return `Parameters must be a string value. Received: ${typeof value}`;
        }
        
        if (key === "outputFormat") {
            const formatError = validateOutputFormat(value);
            if (formatError) return formatError;
        }
    }
    return null;
};

// checkCreateInferenceFields middleware validates request body for creating an inference
const checkCreateInferenceFields = (req: AuthRequest, res: Response, next: NextFunction): void => {
    const body = req.body as { datasetName?: string; modelId?: string; parameters?: unknown };
    let { datasetName, modelId, parameters } = body;

    // Trim string inputs
    if (typeof datasetName === "string") datasetName = datasetName.trim();
    if (typeof modelId === "string") modelId = modelId.trim();

    // Validate datasetName
    const datasetNameError = validateDatasetName(datasetName);
    if (datasetNameError) {
        return next(errorManager.createError(ErrorStatus.invalidFormat, datasetNameError));
    }

    // Validate modelId
    const modelIdError = validateModelId(modelId);
    if (modelIdError) {
        return next(errorManager.createError(ErrorStatus.invalidFormat, modelIdError));
    }

    // Validate parameters type
    const parametersTypeError = validateParametersType(parameters);
    if (parametersTypeError) {
        return next(errorManager.createError(ErrorStatus.invalidFormat, parametersTypeError));
    }

    // Validate parameters content if provided
    if (parameters && typeof parameters === "object") {
        const parameterKeysError = validateParameterKeys(parameters as Record<string, unknown>);
        if (parameterKeysError) {
            return next(errorManager.createError(ErrorStatus.invalidFormat, parameterKeysError));
        }

        const parameterValuesError = validateParameterValues(parameters as Record<string, unknown>);
        if (parameterValuesError) {
            return next(errorManager.createError(ErrorStatus.invalidFormat, parameterValuesError));
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