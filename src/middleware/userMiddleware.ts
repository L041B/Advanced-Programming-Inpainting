// Import necessary types from Express and custom factory modules.
import { Request, Response, NextFunction } from 'express';
import { loggerFactory, ApiRouteLogger, ErrorRouteLogger } from '../factory/loggerFactory';
import { ErrorStatus } from '../factory/status';

// Initialize loggers
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
const apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();

// Custom error interface
interface ValidationError extends Error {
    status: number;
    errorType: ErrorStatus;
}

// Helper function to create validation errors
const createValidationError = (message: string, errorType: ErrorStatus, status: number = 400): ValidationError => {
    const error = new Error(message) as ValidationError;
    error.status = status;
    error.errorType = errorType;
    return error;
};

// checkRequiredFields is a middleware function that checks for the presence of required fields in the request body.
export const checkRequiredFields = (req: Request, res: Response, next: NextFunction): void => {
    const { name, surname, email, password } = req.body;
    if (!name || !surname || !email || !password) {
        const missingFields: string[] = [!name && 'name', !surname && 'surname', !email && 'email', !password && 'password'].filter((field): field is string => Boolean(field));
        errorLogger.log('User creation validation failed', {
            reason: 'Missing required fields',
            missingFields,
            ip: req.ip
        });
        
        const error = createValidationError(
            `The following fields are required: ${missingFields.join(', ')}`,
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next(); // // Proceed to the next step.
};

//checkUpdateFields is a middleware function that checks for the presence of required fields in the request body.
export const checkUpdateFields = (req: Request, res: Response, next: NextFunction): void => {
    const { name, surname, email } = req.body;
    if (!name || !surname || !email) {
        const missingFields: string[] = [!name && 'name', !surname && 'surname', !email && 'email'].filter((field): field is string => Boolean(field));
        errorLogger.log('User update validation failed', { 
            reason: 'Missing required fields', 
            missingFields,
            userId: req.params.userId,
            ip: req.ip 
        });
        
        const error = createValidationError(
            'Name, surname, and email are required',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// validateNameFormat is a middleware function that checks the format of the name and surname fields.
export const validateNameFormat = (req: Request, res: Response, next: NextFunction): void => {
    const { name, surname } = req.body;
    const nameRegex = /^[a-zA-Z\s'-]+$/; 
    
    if (!nameRegex.test(name) || !nameRegex.test(surname)) {
        errorLogger.log('Name format validation failed', { name, surname, ip: req.ip });
        const error = createValidationError(
            'Name and surname must contain only letters, spaces, hyphens, or apostrophes',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// validateEmailFormat is a middleware function that checks the format of the email field.
export const validateEmailFormat = (req: Request, res: Response, next: NextFunction): void => {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; 
    
    if (!emailRegex.test(email)) {
        errorLogger.log('Email format validation failed', { email, ip: req.ip });
        const error = createValidationError('Invalid email format', ErrorStatus.emailNotValid);
        next(error);
        return;
    }
    next();
};

// validatePasswordStrength is a middleware function that checks the strength of the password.
export const validatePasswordStrength = (req: Request, res: Response, next: NextFunction): void => {
    const { password } = req.body;

    // If the password field exists, validate its length.
    if (password && password.length < 8) {
        errorLogger.log('Password strength validation failed', { passwordLength: password.length, ip: req.ip });
        const error = createValidationError(
            'Password must be at least 8 characters long',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// sanitizeUserData is a middleware function that sanitizes user data before processing.
export const sanitizeUserData = (req: Request, res: Response, next: NextFunction): void => {
    // apiLogger is used to log the sanitization process.
    apiLogger.log('User data sanitized', {
        originalEmail: req.body.email,
        sanitizedEmail: req.body.email.trim().toLowerCase(),
        ip: req.ip
    });

    // Sanitize user input by trimming whitespace.
    req.body.name = req.body.name.trim();
    req.body.surname = req.body.surname.trim();
    req.body.email = req.body.email.trim().toLowerCase();
    
    next();
};

// checkLoginFields is a middleware function that checks for the presence of email and password fields in the login request.
export const checkLoginFields = (req: Request, res: Response, next: NextFunction): void => {
    const { email, password } = req.body;
    if (!email || !password) {
        errorLogger.log('Login validation failed', { reason: 'Missing fields', ip: req.ip });
        const error = createValidationError(
            'Email and password are required',
            ErrorStatus.loginBadRequest
        );
        next(error);
        return;
    }
    next();
};

// sanitizeLoginData is a middleware function that sanitizes login data before processing.
export const sanitizeLoginData = (req: Request, res: Response, next: NextFunction): void => {
    // apiLogger is used to log the sanitization process.
    apiLogger.log('Login data sanitized', { email: req.body.email, ip: req.ip });
    req.body.email = req.body.email.trim().toLowerCase();
    next();
};

// validateUUIDFormat is a middleware function that validates the format of a UUID.
export const validateUUIDFormat = (req: Request, res: Response, next: NextFunction): void => {
    const { userId } = req.params;
    if (userId) {
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRegex.test(userId)) {
            errorLogger.log('UUID validation failed', { providedUserId: userId, ip: req.ip });
            const error = createValidationError(
                'Invalid user ID format',
                ErrorStatus.invalidFormat
            );
            next(error);
            return;
        }
    }
    next();
};


// validateUserCreation is a middleware function that validates user creation requests.
export const validateUserCreation = [
    checkRequiredFields,
    sanitizeUserData,
    validateNameFormat,
    validateEmailFormat,
    validatePasswordStrength,
];

// validateUserUpdate is a middleware function that validates user update requests.
export const validateUserUpdate = [
    validateUUIDFormat,
    checkUpdateFields,
    sanitizeUserData,
    validateNameFormat,
    validateEmailFormat,
    validatePasswordStrength,
];

// validateLogin is a middleware function that validates login requests.
export const validateLogin = [
    checkLoginFields,
    validateEmailFormat,
    sanitizeLoginData
];