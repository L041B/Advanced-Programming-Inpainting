// Enumeration of HTTP status codes
export enum HttpStatus {
    OK = 200, // Successful request
    CREATED = 201, // Resource created successfully
    NO_CONTENT = 204, // No content to return
    BAD_REQUEST = 400, // Client error: Bad request
    UNAUTHORIZED = 401, // Client error: Unauthorized
    FORBIDDEN = 403, // Client error: Forbidden
    NOT_FOUND = 404, // Client error: Not found
    INTERNAL_SERVER_ERROR = 500 // Server error: Internal server error
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
    defaultError // Default error message
}

// Interface for response objects
export interface Response {
    message: string; // The message to return
    status: number; // HTTP status code
    data?: string; // Optional additional data
    type: string; // The type of response (application/json)
}

// Interface for message objects
export interface Message {
    getResponse(): Response; // Method to get the response object
}

// Abstract class for message factories
export abstract class MessageFactory {
    abstract getMessage(type: number): Message; // Abstract method to get a message based on the type
}
