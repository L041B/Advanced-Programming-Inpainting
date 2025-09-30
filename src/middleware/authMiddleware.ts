// Import necessary modules from Express, JWT, and custom modules.
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { loggerFactory, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";

// Initialize loggers and error manager.
const authLogger: ApiRouteLogger = loggerFactory.createApiLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
const errorManager = ErrorManager.getInstance();

// Extend the Express Request interface to include custom properties `user` and `token`.
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string; 
        email: string;
    };
    token?: string;
}

// Check authorization header.
export const checkAuthHeader = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers["authorization"];
    
    // If no Authorization header is present, log and return an error.
    if (!authHeader) {
        authLogger.log("Authorization check failed - missing header", { 
            reason: "Authorization header missing", 
            ip: req.ip,
            path: req.path,
            method: req.method
        });
        
        // Create and pass a standardized error to the next middleware
        const error = errorManager.createError(
            ErrorStatus.jwtNotValid,
            "Access token required"
        );
        next(error);
        return;
    }
    next();
};

// Extracts the Bearer token from the Authorization header.
export const extractToken = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers["authorization"]!;
    const token = authHeader.split(" ")[1];

    // If token is not present or malformed, log and return an error.
    if (!token) {
        authLogger.log("Token extraction failed", {
            reason: "Invalid token format, expected \"Bearer <token>\"",
            ip: req.ip
        });
        
        const error = errorManager.createError(
            ErrorStatus.jwtNotValid,
            "Invalid token format"
        );
        next(error);
        return;
    }
    
    // Attach the token to the request object for downstream middleware
    req.token = token;
    next();
};

// Verifies the JWT signature and expiration.
export const verifyToken = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    
    // Ensure the JWT_SECRET is defined in environment variables.
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        // Log fatal error and create a standardized error response
        errorLogger.log("FATAL: JWT_SECRET is not defined in environment variables.", { component: "authMiddleware" });
        const error = errorManager.createError(
            ErrorStatus.creationInternalServerError,
            "Server security configuration error."
        );
        next(error);
        return;
    }
    // Verify the token
    try {
        // If verification is successful, attach decoded payload to request object
        const decoded = jwt.verify(req.token!, secret) as { 
            userId: string; email: string; };
        
        // Attach user info to request for downstream middleware
        req.user = decoded;
        
        // Log successful verification
        authLogger.log("Token validation successful", {
            userId: decoded.userId,
            email: decoded.email,
            valid: true
        });
        
        next();
    } catch (error) {
        let reason = "Unknown token error";
        if (error instanceof jwt.TokenExpiredError) reason = "Token expired";
        if (error instanceof jwt.JsonWebTokenError) reason = "Invalid token signature";

        // Log the specific reason for token verification failure
        authLogger.log("Token verification failed", { reason, ip: req.ip, path: req.path });
        
        const authError = errorManager.createError(
            ErrorStatus.jwtNotValid,
            "Invalid or expired token"
        );
        next(authError);
        return; 
    }
};

// Verifies that the user from the token actually exists in the database.
export const verifyUserExists = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        // Extract userId from the decoded token payload
        const userId = req.user && typeof req.user.userId === "string" ? req.user.userId : undefined;
        if (!userId) {
            authLogger.log("User verification failed", {
                reason: "User ID missing from token",
                ip: req.ip
            });
            // If userId is missing, treat as invalid token
            const error = errorManager.createError(
                ErrorStatus.jwtNotValid,
                "Invalid token - user not found"
            );
            next(error);
            return;
        }
        // Check if user exists in the database
        const user = await User.findByPk(userId);
        if (!user) {
            authLogger.log("User verification failed", {
                reason: "User not found in database",
                userId,
                email: req.user && typeof req.user.email === "string" ? req.user.email : undefined,
                ip: req.ip
            });
            
            // If user does not exist, treat as invalid token
            const error = errorManager.createError(
                ErrorStatus.jwtNotValid,
                "Invalid token - user not found"
            );
            next(error);
            return;
        }
        
        // Log successful user verification
        authLogger.log("User verification successful", {
            userId,
            email: req.user && typeof req.user.email === "string" ? req.user.email : undefined
        });
        
        next();
    } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        errorLogger.logDatabaseError("VERIFY_USER_EXISTS", "users", err.message);
        
        // Pass a standardized error to the next middleware
        const authError = errorManager.createError(
            ErrorStatus.readInternalServerError,
            "User verification failed"
        );
        next(authError);
    }
};

// Checks if the authenticated user is the same as the user being requested.
export const checkUserAuthorization = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {

    // Extract userId from request params or body
    const userIdToAccess = (req.params as { userId?: string }).userId || (req.body as { userId?: string }).userId;
    
    // If no userId is specified in params or body, log and return an error.
    if (!userIdToAccess) {
        errorLogger.log("Authorization logic error", { 
            reason: "checkUserAuthorization was called on a route without a userId in params or body.",
            path: req.path,
        });
        const error = errorManager.createError(
            ErrorStatus.userNotAuthorized,
            "Access denied"
        );
        next(error);
        return;
    }

    // Check if the authenticated user matches the userId being accessed
    if (!req.user || req.user.userId !== userIdToAccess) {
        authLogger.log("Authorization check failed", {
            authenticatedUserId: req.user?.userId || "none",
            requestedUserId: userIdToAccess,
            authorized: false,
            ip: req.ip
        });
        
        const error = errorManager.createError(
            ErrorStatus.userNotAuthorized,
            "Access denied"
        );
        next(error);
        return;
    }

    // Log successful authorization
    authLogger.log("Authorization check successful", { authenticatedUserId: req.user.userId, authorized: true });
    next();
};

// Composed middleware functions using the chain
export const authenticateToken = [
    checkAuthHeader,
    extractToken,
    verifyToken,
    verifyUserExists
];

// This chain checks if a user is authorized to access a resource related to another user's ID.
export const authorizeUser = [checkUserAuthorization];


