// Assuming './status' defines the HttpStatus enum, ErrorStatus enum, and the Response/Message interfaces.
import { HttpStatus, ErrorStatus, Response, Message, MessageFactory } from "./status";

// This Map stores the template for each type of error response.
const errorResponseMap: Map<ErrorStatus, Response> = new Map([
    [ErrorStatus.userLoginError,       { message: "User login failed. Please check your credentials.", 
        status: HttpStatus.UNAUTHORIZED, type: "application/json" }],
    [ErrorStatus.emailNotValid,        { message: "Invalid email format provided.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.loginBadRequest,      { message: "Bad request during login. Please verify your input.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.jwtNotValid,          { message: "JWT token is invalid or expired.", 
        status: HttpStatus.UNAUTHORIZED, type: "application/json" }],
    [ErrorStatus.userNotAuthorized,    { message: "User is not authorized to access this resource.", 
        status: HttpStatus.FORBIDDEN, type: "application/json" }],
    [ErrorStatus.resourceNotFoundError,{ message: "Requested resource was not found.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.resourceAlreadyPresent,{ message: "Resource already exists.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.creationInternalServerError, { message: "Internal server error occurred during creation.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.readInternalServerError, { message: "Internal server error occurred while reading data.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.updateInternalServerError, { message: "Internal server error occurred during update.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.deleteInternalServerError, { message: "Internal server error occurred during deletion.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.invalidFormat,        { message: "Invalid format provided.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.routeNotFound,        { message: "Route not found.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.datasetNotFoundError, { message: "Dataset not found.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.datasetAlreadyExistsError, { message: "Dataset with this name already exists.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.datasetUpdateFailedError, { message: "Failed to update dataset.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.datasetDeletionFailedError, { message: "Failed to delete dataset.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.datasetCreationFailedError, { message: "Failed to create dataset.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.inferenceNotFoundError, { message: "Inference not found.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.inferenceCreationFailedError, { message: "Failed to create inference.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.inferenceUpdateFailedError, { message: "Failed to update inference.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.userNotFoundError, { message: "User not found.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.userAlreadyExistsError, { message: "User with this email already exists.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.userCreationFailedError, { message: "Failed to create user.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.userUpdateFailedError, { message: "Failed to update user.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.userDeletionFailedError, { message: "Failed to delete user.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.passwordHashingFailedError, { message: "Failed to process password.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.insufficientTokensError, { message: "Insufficient tokens to perform this operation.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.tokenReservationFailedError, { message: "Failed to reserve tokens for operation.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.tokenConfirmationFailedError, { message: "Failed to confirm token usage.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.tokenRefundFailedError, { message: "Failed to refund tokens.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.tokenRechargeFailedError, { message: "Failed to recharge tokens.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.adminPrivilegesRequiredError, { message: "Admin privileges required for this operation.", 
        status: HttpStatus.FORBIDDEN, type: "application/json" }],
    [ErrorStatus.reservationNotFoundError, { message: "Token reservation not found.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.externalServiceError, { message: "External service unavailable or failed to process request.", 
        status: HttpStatus.SERVICE_UNAVAILABLE, type: "application/json" }],
    [ErrorStatus.inferenceProcessingFailedError, { message: "Failed to process inference request.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.queueInitializationFailedError, { message: "Failed to initialize job queue.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.jobAdditionFailedError, { message: "Failed to add job to processing queue.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.jobStatusRetrievalFailedError, { message: "Failed to retrieve job status.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
    [ErrorStatus.jobNotFoundError, { message: "Job not found in queue.", 
        status: HttpStatus.NOT_FOUND, type: "application/json" }],
    [ErrorStatus.invalidDatasetDataError, { message: "Invalid dataset data provided.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.invalidParametersError, { message: "Invalid parameters provided.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.emptyDatasetError, { message: "Dataset contains no valid pairs for processing.", 
        status: HttpStatus.BAD_REQUEST, type: "application/json" }],
    [ErrorStatus.defaultError,         { message: "An unexpected error occurred.", 
        status: HttpStatus.INTERNAL_SERVER_ERROR, type: "application/json" }],
]);

// The ErrorMessageFactory is responsible for creating error messages.
export class ErrorMessageFactory extends MessageFactory {
    getMessage(type: ErrorStatus): Message {
        // Find the response template in the map. Fallback to defaultError if not found.
        const response = errorResponseMap.get(type) || errorResponseMap.get(ErrorStatus.defaultError)!;
        
        // Return an object that conforms to the Message interface.
        return {
            getResponse: () => response,
        };
    }
}

/*The ErrorManager is a singleton responsible for creating and formatting standardized
* error objects that can be used throughout the application.
*/
export class ErrorManager {
    private static instance: ErrorManager;
    private readonly errorFactory: ErrorMessageFactory;

    private constructor() {
        this.errorFactory = new ErrorMessageFactory();
    }

    // Singleton access method
    public static getInstance(): ErrorManager {
        if (!ErrorManager.instance) {
            ErrorManager.instance = new ErrorManager();
        }
        return ErrorManager.instance;
    }

    // Retrieves a standard response template for a given error type.
    public getErrorResponse(errorType: ErrorStatus): Response {
        // The factory provides the core response object.
        return this.errorFactory.getMessage(errorType).getResponse();
    }

    // Creates a fully-formed, throwable Error object that is compatible
    public createError(errorType: ErrorStatus, customMessage?: string): Error & { status: number; errorType: ErrorStatus; getResponse: () => Response } {
        const responseTemplate = this.getErrorResponse(errorType);
        const message = customMessage || responseTemplate.message;

        // Create a standard Error instance and cast it to our custom type to attach metadata.
        const error = new Error(message) as Error & { status: number; errorType: ErrorStatus; getResponse: () => Response };
        error.status = responseTemplate.status;
        error.errorType = errorType;
        
        // Attach the response generator function directly to the error object.
        error.getResponse = () => ({
            ...responseTemplate,
            message: message 
        });

        return error;
    }
}