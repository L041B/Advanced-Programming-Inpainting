// Import necessary modules from Express and project factories.
import { Request, Response, NextFunction } from 'express';
import { ErrorManager } from '../factory/errorManager';
import { ErrorStatus, HttpStatus } from '../factory/status';
import { loggerFactory, ErrorRouteLogger } from '../factory/loggerFactory';

// Initialize the error logger and error manager instances.
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
const errorManager = ErrorManager.getInstance();

// Define a shared custom error interface to ensure type safety across the chain.
interface CustomError extends Error {
    status?: number;
    statusCode?: number; 
    errorType?: ErrorStatus;
    // The function that produces the final, client-facing response object.
    getResponse?: () => { status: number; message: string; };
}

// Log Errors is a part of the error handling chain that logs error details.
function logErrors(err: CustomError, req: Request, res: Response, next: NextFunction) {
    errorLogger.log('Application error occurred', {
        errorName: err.name,
        errorMessage: err.message,
        statusCode: err.status || err.statusCode || 500, 
        requestUrl: req.originalUrl,
        requestMethod: req.method,
        ip: req.ip
    });
    next(err);
}

// The classifyErrors middleware inspects the error and assigns a standardized internal `errorType`
function classifyError(err: CustomError, req: Request, res: Response, next: NextFunction) {
    if (!err.errorType) {
        // Map common error properties to our internal ErrorStatus enum.
        const status = err.status || err.statusCode;
        switch (status) {
            case HttpStatus.BAD_REQUEST:
                err.errorType = ErrorStatus.invalidFormat;
                break;
            case HttpStatus.UNAUTHORIZED:
                err.errorType = ErrorStatus.jwtNotValid;
                break;
            case HttpStatus.FORBIDDEN:
                err.errorType = ErrorStatus.userNotAuthorized;
                break;
            case HttpStatus.NOT_FOUND:
                err.errorType = ErrorStatus.resourceNotFoundError;
                break;
            default:
                err.errorType = ErrorStatus.defaultError;
        }
    }
    next(err);
}

// Format Error Response is a middleware that ensures every error object has a `getResponse` method attached to it.
function formatErrorResponse(err: CustomError, req: Request, res: Response, next: NextFunction) {
    // If the error already has a response generator skip this step.
    if (err.getResponse) {
        return next(err);
    }
    
    // Get the response template from the ErrorManager based on the classified error type.
    const errorResponseTemplate = errorManager.getErrorResponse(err.errorType || ErrorStatus.defaultError);

    // Attach the generator function to the error.
    err.getResponse = () => {
        return {
            ...errorResponseTemplate,
            message: err.message || errorResponseTemplate.message,
        };
    };
    next(err);
}

// getResponse method is a function that generates the final error response object.
function generalErrorHandler(err: CustomError, req: Request, res: Response, next: NextFunction) {
    if (res.headersSent) {
        return next(err);
    }
    
    const response = err.getResponse!();

    // Send the final JSON response to the client.
    res.status(response.status).json({
        success: false,
        message: response.message,
    });
}

// Route Not Found Handler is a middleware that handles route errors.
export function routeNotFoundHandler(req: Request, res: Response, next: NextFunction) {
    const error = errorManager.createError(
        ErrorStatus.routeNotFound, 
        `Route not found: ${req.method} ${req.originalUrl}`
    );
    
    next(error);
}

// Exported error handling chain
export const errorHandlingChain = [
    logErrors,
    classifyError,
    formatErrorResponse,
    generalErrorHandler
];