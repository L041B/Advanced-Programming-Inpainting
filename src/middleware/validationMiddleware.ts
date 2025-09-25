import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize error manager and logger
const errorManager: ErrorManager = ErrorManager.getInstance();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Generic UUID validation middleware
export const validateUUID = (paramName: string) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        const paramValue = req.params[paramName];
        if (paramValue) {
            const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
            if (!uuidRegex.test(paramValue)) {
                errorLogger.logValidationError("uuidFormat", paramValue, `Invalid UUID format for ${paramName}`);
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    `Invalid ${paramName} format`
                );
                next(error);
                return;
            }
        }
        next();
    };
};

// Specific validators for common use cases
export const validateUserIdFormat = validateUUID("userId");
export const validateInferenceIdFormat = validateUUID("id");
