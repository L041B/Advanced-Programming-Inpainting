// Enumeration of HTTP status codes
export enum HttpStatus {
    OK = 200, // Successful request
    CREATED = 201, // Resource created successfully
    NO_CONTENT = 204, // No content to return
    BAD_REQUEST = 400, // Client error: Bad request
    UNAUTHORIZED = 401, // Client error: Unauthorized
    FORBIDDEN = 403, // Client error: Forbidden
    NOT_FOUND = 404, // Client error: Not found
    INTERNAL_SERVER_ERROR = 500, // Server error: Internal server error
    SERVICE_UNAVAILABLE = 503 // Server error: Service unavailable
}


// Enumeration of success statuses
export enum SuccessStatus {
    userLoginSuccess, // User login success message
    passageLoginSuccess, // Passage login success message
    creationSuccess, // Successful resource creation
    readSuccess, // Successful resource read
    updateSuccess, // Successful resource update
    deleteSuccess, // Successful resource deletion
    defaultSuccess // Default success message
}

// Enumeration of error statuses
export enum ErrorStatus {
    userLoginError, // User login error message
    emailNotValid, // Invalid email format error
    loginBadRequest, // Login bad request error message
    jwtNotValid, // JWT authentication failure
    userNotAuthorized, // Authorization error message
    passageLoginError, // Passage login error message
    creationInternalServerError, // Error during resource creation
    readInternalServerError, // Error during resource read
    updateInternalServerError, // Error during resource update
    deleteInternalServerError, // Error during resource deletion
    resourceNotFoundError, // Resource not found error
    resourceAlreadyPresent, // Resource already exists error
    invalidDateFormat, // Invalid date format error
    invalidHourFormat, // Invalid hour format error
    invalidFormat, // Invalid format error
    invalidFormatOrResourceNotFound, // Invalid format or resource not found error
    routeNotFound, // Route not found error
    functionNotWorking, // Function not working error
    datasetNotFoundError, // Dataset not found error
    datasetAlreadyExistsError, // Dataset already exists error
    datasetUpdateFailedError, // Dataset update failed error
    datasetDeletionFailedError, // Dataset deletion failed error
    datasetCreationFailedError, // Dataset creation failed error
    inferenceNotFoundError, // Inference not found error
    inferenceCreationFailedError, // Inference creation failed error
    inferenceUpdateFailedError, // Inference update failed error
    userNotFoundError, // User not found error
    userAlreadyExistsError, // User already exists error
    userCreationFailedError, // User creation failed error
    userUpdateFailedError, // User update failed error
    userDeletionFailedError, // User deletion failed error
    passwordHashingFailedError, // Password hashing failed error
    insufficientTokensError, // Insufficient tokens error
    tokenReservationFailedError, // Token reservation failed error
    tokenConfirmationFailedError, // Token confirmation failed error
    tokenRefundFailedError, // Token refund failed error
    tokenRechargeFailedError, // Token recharge failed error
    adminPrivilegesRequiredError, // Admin privileges required error
    reservationNotFoundError, // Token reservation not found error
    externalServiceError, // External service error
    inferenceProcessingFailedError, // Inference processing failed error
    queueInitializationFailedError, // Queue initialization failed error
    jobAdditionFailedError, // Job addition to queue failed error
    jobStatusRetrievalFailedError, // Job status retrieval failed error
    jobNotFoundError, // Job not found error
    invalidDatasetDataError, // Invalid dataset data error
    invalidParametersError, // Invalid parameters error
    emptyDatasetError, // Dataset contains no valid pairs error
    noChangesToUpdateError, // No changes detected in update request
    defaultError // Default error message
}

// Interface for response objects
export interface Response {
    message: string; // The message to return
    status: number; // HTTP status code
    data?: string; // Optional additional data
    type: string; // Type of response
}

// Interface for message objects
export interface Message {
    getResponse(): Response; // Method to get the response object
}

// Abstract class for message factories
export abstract class MessageFactory {
    abstract getMessage(type: number): Message; // Abstract method to get a message based on the type
}
