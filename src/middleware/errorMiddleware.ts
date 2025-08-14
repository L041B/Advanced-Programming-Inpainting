// Import necessary types from Express and custom factory modules.
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize instances of loggers and the error manager.
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
const errorManager: ErrorManager = ErrorManager.getInstance();

// Define a custom error interface that extends the base Error.
interface CustomError extends Error {
    status?: number;
    statusCode?: number;
    errorType?: ErrorStatus;
    getResponse?: () => ErrorResponse;
}

// Define the structure of the final error response object.
interface ErrorResponse {
    status: number;
    message: string;
    type: string; 
}

// We use chain of responsibility pattern to handle error responses.

/** Log the incoming error. Its sole job is to record the error details.
 * @param err The error object.
 * @param req The Express request object.
 * @param res The Express response object.
 */
export function logErrors(err: CustomError, req: Request, res: Response, next: NextFunction) {    
    errorLogger.log("Application error occurred", {
        errorName: err.name,
        errorMessage: err.message,
        statusCode: err.status || err.statusCode || 500,
        requestUrl: req.url,
        requestMethod: req.method,
        ip: req.ip
    });

    next(err); // Proceed to the next step.
}

/** Classify the error. This middleware assigns a standard internal error type (from ErrorStatus enum) 
 * if one hasn't been assigned already.
 */
export function classifyError(err: CustomError, req: Request, res: Response, next: NextFunction) {
    if (!err.errorType) {
        // This logic maps HTTP statuses and error names to our internal enum.
        if (err.name === "ValidationError" || err.status === 400) {
            err.errorType = ErrorStatus.invalidFormat;
        } else if (err.name === "UnauthorizedError" || err.status === 401) {
            err.errorType = ErrorStatus.jwtNotValid;
        } else if (err.status === 403) {
            err.errorType = ErrorStatus.userNotAuthorized;
        } else if (err.status === 404) {
            err.errorType = ErrorStatus.resourceNotFoundError;
        } else {
            err.errorType = ErrorStatus.defaultError;
        }

        // Log the classification result.
        errorLogger.log("Error classified", {
            originalErrorType: err.name,
            classifiedAs: ErrorStatus[err.errorType],
            statusCode: err.status || err.statusCode
        });
    }
    next(err);
}

// Format the error response.
export function formatErrorResponse(err: CustomError, req: Request, res: Response, next: NextFunction) {
    // If the error already has a custom response generator, we don't overwrite it.
    if (err.getResponse && typeof err.getResponse === "function") {
        next(err);
    } else {
        // Get the template response message from our error manager based on the classified error type.
        const errorResponse = errorManager.getErrorResponse(err.errorType || ErrorStatus.defaultError);
        // Attach the `getResponse` function to the error object.
        err.getResponse = () => {
            return {
                ...errorResponse,
                message: err.message || errorResponse.message
            };
        };
        next(err);
    }
}

// This middleware handles requests for routes that do not exist.
export function routeNotFound(req: Request, res: Response, next: NextFunction) {
    // Log the request for a non-existent route.
    errorLogger.log("Route not found", { requestedRoute: `${req.method} ${req.path}`, ip: req.ip });

    // Create a specific "route not found" error using the error manager and pass it to the error handlers.
    const errorResponse = errorManager.getErrorResponse(ErrorStatus.routeNotFound);
    const error = new Error(errorResponse.message) as CustomError;
    error.errorType = ErrorStatus.routeNotFound;
    error.status = errorResponse.status;
    error.getResponse = () => errorResponse;
    
    next(error);
}

// Send the error response to the client.
export function generalErrorHandler(err: CustomError, req: Request, res: Response) {
    // The '!' non-null assertion is used here because we know that `getResponse` will be defined after `formatErrorResponse` is called.
    const response = err.getResponse!();

    // Log the error response details.
    errorLogger.log("Error response sent to client", {
        statusCode: response.status,
        message: response.message,
        requestUrl: req.url,
    });

    // Send the error response to the client.
    res.status(response.status).json({
        success: false,
        message: response.message
    });
}