// Import necessary types from Express and custom factory modules.
import { Request, Response, NextFunction } from "express";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
import { validateUserIdFormat } from "./validationMiddleware";
import { validateUserFieldLengths } from "./fieldLengthMiddleware";

// Initialize error manager and logger
const errorManager: ErrorManager = ErrorManager.getInstance();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// checkRequiredFields is a middleware function that checks for the presence of required fields in the request body.
export const checkRequiredFields = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { name?: string; surname?: string; email?: string; password?: string };
    let { name, surname, email, password } = body;

    // Trim all string inputs first
    if (typeof name === "string") name = name.trim();
    if (typeof surname === "string") surname = surname.trim();
    if (typeof email === "string") email = email.trim();
    if (typeof password === "string") password = password.trim();

    // Check for missing required fields or empty strings after trimming
    if (!name || !surname || !email || !password) {
        const missingFields: string[] = [];
        if (!name) missingFields.push("name");
        if (!surname) missingFields.push("surname");
        if (!email) missingFields.push("email");
        if (!password) missingFields.push("password");
        
        errorLogger.logValidationError("requiredFields", missingFields.join(", "), "Missing or empty required fields");
        
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            `The following fields are required and cannot be empty or contain only spaces: ${missingFields.join(", ")}`
        );
        next(error);
        return;
    }

    // Update body with trimmed values
    req.body = { ...body, name, surname, email, password };
    next();
};

// validateNameFormat is a middleware function that checks the format of the name and surname fields if present
export const validateNameFormat = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { name?: string; surname?: string };
    let { name, surname } = body;
    const nameRegex = /^[a-zA-Z\s'-]+$/; 
    const hasLetterRegex = /[a-zA-Z]/; // Must contain at least one letter
    const multipleSpacesRegex = /\s{2,}/; // Check for 2 or more consecutive spaces
    const consecutiveSpecialCharsRegex = /[-']{2,}/; // Check for consecutive hyphens or apostrophes
    
    // Trim inputs if they are strings
    if (typeof name === "string") name = name.trim();
    if (typeof surname === "string") surname = surname.trim();
    
    // Validate format if fields are present and not empty after trimming
    if (name && (!nameRegex.test(name) || name.length === 0 || !hasLetterRegex.test(name))) {
        errorLogger.logValidationError("nameFormat", `name: ${name}`, "Invalid name format - must contain at least one letter");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Name must contain at least one letter and can only include letters, spaces, hyphens, or apostrophes"
        );
        next(error);
        return;
    }
    
    if (surname && (!nameRegex.test(surname) || surname.length === 0 || !hasLetterRegex.test(surname))) {
        errorLogger.logValidationError("nameFormat", `surname: ${surname}`, "Invalid surname format - must contain at least one letter");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Surname must contain at least one letter and can only include letters, spaces, hyphens, or apostrophes"
        );
        next(error);
        return;
    }

    // Check for multiple consecutive spaces
    if (name && multipleSpacesRegex.test(name)) {
        errorLogger.logValidationError("nameFormat", `name: ${name}`, "Name contains too many consecutive spaces");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Name cannot contain more than two consecutive spaces"
        );
        next(error);
        return;
    }

    if (surname && multipleSpacesRegex.test(surname)) {
        errorLogger.logValidationError("nameFormat", `surname: ${surname}`, "Surname contains too many consecutive spaces");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Surname cannot contain more than two consecutive spaces"
        );
        next(error);
        return;
    }

    // Check for consecutive hyphens or apostrophes
    if (name && consecutiveSpecialCharsRegex.test(name)) {
        errorLogger.logValidationError("nameFormat", `name: ${name}`, "Name contains consecutive hyphens or apostrophes");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Name cannot contain consecutive hyphens or apostrophes"
        );
        next(error);
        return;
    }

    if (surname && consecutiveSpecialCharsRegex.test(surname)) {
        errorLogger.logValidationError("nameFormat", `surname: ${surname}`, "Surname contains consecutive hyphens or apostrophes");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Surname cannot contain consecutive hyphens or apostrophes"
        );
        next(error);
        return;
    }

    // Update body with trimmed values
    req.body = { ...body, name, surname };
    next();
};

// validateEmailFormat is a middleware function that checks the format of the email field if present
export const validateEmailFormat = (req: Request, res: Response, next: NextFunction): void => {
    try {
        const body = req.body as { email?: string };
        let { email } = body;
        // Basic regex for email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/; 
        
        // Trim email input if it's a string
        if (typeof email === "string") email = email.trim();
        
        // Skip validation if email is not present
        if (!email) {
            req.body = { ...body, email };
            next();
            return;
        }

        // Validate email format
        if (!emailRegex.test(email)) {
            errorLogger.logValidationError("emailFormat", email, "Invalid email format");
            const error = errorManager.createError(
                ErrorStatus.emailNotValid,
                "Email format is invalid. Please provide a valid email address with a proper domain"
            );
            next(error);
            return;
        }

        // Additional validation for email length
        if (email.length < 5 || email.length > 254) {
            errorLogger.logValidationError("emailFormat", email, "Email length out of bounds");
            const error = errorManager.createError(
                ErrorStatus.emailNotValid,
                "Email address must be between 5 and 254 characters long."
            );
            next(error);
            return;
        }

        // Additional validation for email structure
        const parts = email.split("@");
        if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
            errorLogger.logValidationError("emailFormat", email, "Invalid email structure");
            const error = errorManager.createError(
                ErrorStatus.emailNotValid,
                "Email format is invalid. Please provide a valid email address."
            );
            next(error);
            return;
        }

        const domainParts = parts[1].split(".");
        if (domainParts.length < 2 || domainParts.some(part => part.length === 0)) {
            errorLogger.logValidationError("emailFormat", email, "Invalid domain structure");
            const error = errorManager.createError(
                ErrorStatus.emailNotValid,
                "Email domain is invalid. Please provide a valid domain."
            );
            next(error);
            return;
        }

        // Update body with trimmed and lowercased email
        req.body = { ...body, email: email.toLowerCase() };
        next();
    } catch (error) {
        // Catch any unexpected errors and convert them to 400 errors
        errorLogger.logValidationError("emailFormat", "validation_error", "Email validation failed unexpectedly");
        const managedError = errorManager.createError(
            ErrorStatus.emailNotValid,
            "Email validation failed. Please provide a valid email address."
        );
        next(managedError);
    }
};

// validatePasswordStrength is a middleware function that checks the strength of the password if present.
export const validatePasswordStrength = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { password?: string };
    let { password } = body;

    // Trim password if it's a string
    if (typeof password === "string") password = password.trim();

    // Validate if password is present and check length after trimming
    if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
        errorLogger.logValidationError("passwordStrength", "length: " + (password?.length || 0), "Password too short or empty");
        const error = errorManager.createError(
            ErrorStatus.invalidFormat,
            "Password must be at least 8 characters long and cannot be empty or contain only spaces"
        );
        next(error);
        return;
    }

    // Update body with trimmed password
    req.body = { ...body, password };
    next();
};

// sanitizeUserData is a middleware function that sanitizes user data before processing.
export const sanitizeUserData = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { name?: string; surname?: string; email?: string; password?: string };
    
    // Sanitize user input by trimming whitespace where present
    if (typeof body.name === "string") {
        body.name = body.name.trim();
        if (body.name.length === 0) body.name = undefined;
    }
    if (typeof body.surname === "string") {
        body.surname = body.surname.trim();
        if (body.surname.length === 0) body.surname = undefined;
    }
    if (typeof body.email === "string") {
        body.email = body.email.trim().toLowerCase();
        if (body.email.length === 0) body.email = undefined;
    }
    if (typeof body.password === "string") {
        body.password = body.password.trim();
        if (body.password.length === 0) body.password = undefined;
    }
    
    req.body = body;
    next();
};

// checkLoginFields is a middleware function that checks for the presence of email and password fields in the login request.
export const checkLoginFields = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { email?: string; password?: string };
    let { email, password } = body;
    
    // Trim inputs if they are strings
    if (typeof email === "string") email = email.trim();
    if (typeof password === "string") password = password.trim();
    
    // Check for missing email or password or empty strings after trimming
    if (!email || !password || email.length === 0 || password.length === 0) {
        errorLogger.logValidationError("loginFields", "email and password", "Missing or empty login fields");
        const error = errorManager.createError(
            ErrorStatus.loginBadRequest,
            "Email and password are required and cannot be empty or contain only spaces"
        );
        next(error);
        return;
    }

    // Update body with trimmed values
    req.body = { ...body, email, password };
    next();
};

// sanitizeLoginData is a middleware function that sanitizes login data before processing.
export const sanitizeLoginData = (req: Request, res: Response, next: NextFunction): void => {
    const body = req.body as { email?: string; password?: string };
    
    // Sanitize email by trimming whitespace and converting to lowercase
    if (typeof body.email === "string") {
        body.email = body.email.trim().toLowerCase();
        if (body.email.length === 0) body.email = undefined;
    }
    if (typeof body.password === "string") {
        body.password = body.password.trim();
        if (body.password.length === 0) body.password = undefined;
    }
    
    req.body = body;
    next();
};

// Middleware for validating user creation requests 
export const validateUserCreation = [
    checkRequiredFields,
    sanitizeUserData,
    validateUserFieldLengths,
    validateNameFormat,
    validateEmailFormat,
    validatePasswordStrength,
];

// Middleware for validating user update requests - fields are optional, but validated if present
export const validateUserUpdate = [
    validateUserIdFormat,
    sanitizeUserData,
    validateUserFieldLengths,
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