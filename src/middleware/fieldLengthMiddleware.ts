// Import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize error manager and logger
const errorManager: ErrorManager = ErrorManager.getInstance();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Database field length constraints
export const FIELD_LIMITS = {
    USER_NAME: 100,
    USER_SURNAME: 100,
    USER_EMAIL: 255,
    USER_PASSWORD: 255,
    DATASET_NAME: 255,
    MODEL_ID: 255,
    OPERATION_TYPE: 50,
    OPERATION_ID: 255,
    TAG_LENGTH: 100, 
    DESCRIPTION: 1000, 
    JSON_PARAMETERS_SIZE: 1000
} as const;

// Generic field length validation function
export const validateFieldLength = (fieldName: string, value: string | undefined, maxLength: number) => {
    if (value && value.length > maxLength) {
        errorLogger.logValidationError(fieldName, `length: ${value.length}`, `Field exceeds maximum length of ${maxLength} characters`);
        throw errorManager.createError(
            ErrorStatus.invalidFormat,
            `${fieldName} exceeds maximum length of ${maxLength} characters (current: ${value.length})`
        );
    }
};

// Validate JSON parameter size
export const validateJsonParametersSize = (parameters: unknown): void => {
    if (parameters !== undefined && parameters !== null) {
        try {
            const jsonString = JSON.stringify(parameters);
            const sizeInBytes = Buffer.byteLength(jsonString, "utf8");

            // Check if the size exceeds the limit
            if (sizeInBytes > FIELD_LIMITS.JSON_PARAMETERS_SIZE) {
                errorLogger.logValidationError(
                    "parameters", 
                    `size: ${sizeInBytes} bytes`, 
                    `Parameters JSON exceeds maximum size of ${FIELD_LIMITS.JSON_PARAMETERS_SIZE} bytes`
                );
                throw errorManager.createError(
                    ErrorStatus.invalidFormat,
                    `Parameters JSON exceeds maximum size of ${FIELD_LIMITS.JSON_PARAMETERS_SIZE} bytes (current: ${sizeInBytes} bytes)`
                );
            }
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error; 
            }
            // Handle JSON stringify errors
            errorLogger.logValidationError("parameters", "invalid", "Parameters cannot be serialized to JSON");
            throw errorManager.createError(
                ErrorStatus.invalidFormat,
                "Parameters must be a valid JSON object"
            );
        }
    }
};

// Middleware factory for field length validation
export const createFieldLengthValidator = (fields: Record<string, number>) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const body = req.body as Record<string, unknown>;
            
            // Validate each specified field
            for (const [fieldName, maxLength] of Object.entries(fields)) {
                const value = body[fieldName];
                if (typeof value === "string") {
                    validateFieldLength(fieldName, value, maxLength);
                }
            }
            
            next();
        } catch (error) {
            next(error);
        }
    };
};

// Specific validators for common use cases
export const validateUserFieldLengths = createFieldLengthValidator({
    name: FIELD_LIMITS.USER_NAME,
    surname: FIELD_LIMITS.USER_SURNAME,
    email: FIELD_LIMITS.USER_EMAIL,
    password: FIELD_LIMITS.USER_PASSWORD
});

// Validate dataset fields
export const validateDatasetFieldLengths = createFieldLengthValidator({
    name: FIELD_LIMITS.DATASET_NAME,
    datasetName: FIELD_LIMITS.DATASET_NAME
});

// Validate model fields
export const validateInferenceFieldLengths = createFieldLengthValidator({
    modelId: FIELD_LIMITS.MODEL_ID
});

// Validate parameters JSON size
export const validateParametersSize = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const { parameters } = req.body;
        validateJsonParametersSize(parameters);
        next();
    } catch (error) {
        next(error);
    }
};

// Validate array of tags
export const validateTagsLength = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const { tags } = req.body;
        
        // Check if tags is an array
        if (Array.isArray(tags)) {
            for (let i = 0; i < tags.length; i++) {
                const tag = tags[i];
                if (typeof tag === "string") {
                    validateFieldLength(`tags[${i}]`, tag, FIELD_LIMITS.TAG_LENGTH);
                }
            }
        }
        
        next();
    } catch (error) {
        next(error);
    }
};

// Validate request parameters
export const validateParamLength = (paramName: string, maxLength: number) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const value = req.params[paramName];
            if (typeof value === "string") {
                validateFieldLength(paramName, value, maxLength);
            }
            next();
        } catch (error) {
            next(error);
        }
    };
};
