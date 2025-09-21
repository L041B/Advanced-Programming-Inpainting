// Import necessary types from Express and custom factory modules.
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize error manager and logger
const errorManager: ErrorManager = ErrorManager.getInstance();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// checkRequiredFields is a middleware function that checks for the presence of required fields in the request body.
export const checkRequiredFields = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { name?: string; surname?: string; email?: string; password?: string };
    const { name, surname, email, password } = body;

    // Check for missing required fields
    if (!name || !surname || !email || !password) {
        const missingFields: string[] = [!name && "name", !surname && "surname", !email && "email", !password && "password"].filter((field): field is string => Boolean(field));
        errorLogger.logValidationError("requiredFields", missingFields.join(", "), "Missing required fields");
        
        // Create and pass a standardized error to the next middleware
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            `The following fields are required: ${missingFields.join(", ")}`
        );
        next(error);
        return;
    }
    next();
};

// validateNameFormat is a middleware function that checks the format of the name and surname fields if present.
export const validateNameFormat = (req: Request, res: Response, next: NextFunction): void => {
    // Extract name and surname from request body
    const body = req.body as { name?: string; surname?: string };
    const { name, surname } = body;
    const nameRegex = /^[a-zA-Z\s'-]+$/; 
    
    // Only validate format if fields are present (they might be optional in updates)
    if ((name && !nameRegex.test(name)) || (surname && !nameRegex.test(surname))) {
        errorLogger.logValidationError("nameFormat", `name: ${name}, surname: ${surname}`, "Invalid name or surname format");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Name and surname must contain only letters, spaces, hyphens, or apostrophes"
        );
        next(error);
        return;
    }
    next();
};

// validateEmailFormat is a middleware function that checks the format of the email field if present.
export const validateEmailFormat = (req: Request, res: Response, next: NextFunction): void => {
    // Extract email from request body
    const body = req.body as { email?: string };
    const { email } = body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; 
    
    // Only validate format if email is present
    if (email && !emailRegex.test(email)) {
        errorLogger.logValidationError("emailFormat", email, "Invalid email format");
        const error = errorManager.createError(ErrorStatus.emailNotValid);
        next(error);
        return;
    }
    next();
};

// validatePasswordStrength is a middleware function that checks the strength of the password if present.
export const validatePasswordStrength = (req: Request, res: Response, next: NextFunction): void => {
    // Extract password from request body
    const body = req.body as { password?: string };
    const { password } = body;

    // Only validate if password is present and is a string
    if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
        errorLogger.logValidationError("passwordStrength", "length: " + (password?.length || 0), "Password too short");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Password must be at least 8 characters long"
        );
        next(error);
        return;
    }
    next();
};

// sanitizeUserData is a middleware function that sanitizes user data before processing.
export const sanitizeUserData = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { name?: string; surname?: string; email?: string };
    
    // Sanitize user input by trimming whitespace where present
    if (typeof body.name === "string") body.name = body.name.trim();
    if (typeof body.surname === "string") body.surname = body.surname.trim();
    if (typeof body.email === "string") body.email = body.email.trim().toLowerCase();
    
    req.body = body;
    next();
};

// checkLoginFields is a middleware function that checks for the presence of email and password fields in the login request.
export const checkLoginFields = (req: Request, res: Response, next: NextFunction): void => {
    // Extract email and password from request body
    const body = req.body as { email?: string; password?: string };
    const { email, password } = body;
    // Check for missing email or password
    if (!email || !password) {
        errorLogger.logValidationError("loginFields", "email and password", "Missing login fields");
        const error = errorManager.createError(
            ErrorStatus.loginBadRequest,
            "Email and password are required"
        );
        next(error);
        return;
    }
    next();
};

// sanitizeLoginData is a middleware function that sanitizes login data before processing.
export const sanitizeLoginData = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { email?: string };
    // Sanitize email by trimming whitespace and converting to lowercase
    if (typeof body.email === "string") {
        (req.body as { email?: string }).email = body.email.trim().toLowerCase();
    }
    next();
};

// validateUUIDFormat is a middleware function that validates the format of a UUID.
export const validateUUIDFormat = (req: Request, res: Response, next: NextFunction): void => {
    const { userId } = req.params;
    if (userId) {
        const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
        if (!uuidRegex.test(userId)) {
            errorLogger.logValidationError("uuidFormat", userId, "Invalid UUID format");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Invalid user ID format"
            );
            next(error);
            return;
        }
    }
    next();
};

// Middleware for validating user creation requests - all fields required
export const validateUserCreation = [
    checkRequiredFields,
    sanitizeUserData,
    validateNameFormat,
    validateEmailFormat,
    validatePasswordStrength,
];

// Middleware for validating user update requests - fields are optional, but validated if present
export const validateUserUpdate = [
    validateUUIDFormat,
    sanitizeUserData,
    validateNameFormat,
    validateEmailFormat,
    validatePasswordStrength,
];

// Middleware for validating login requests
export const validateLogin = [
    checkLoginFields,
    validateEmailFormat,
    sanitizeLoginData
];