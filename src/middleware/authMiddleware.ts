// Import necessary modules from Express, JWT, and custom modules.
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { ExecutionDao } from "../dao/executionDao";
import { loggerFactory, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorStatus } from "../factory/status";

// Initialize loggers.
const authLogger: ApiRouteLogger = loggerFactory.createApiLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Extend the Express Request interface to include custom properties `user` and `token`.
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string; 
        email: string;
    };
    token?: string;
}

// Custom error interface
interface AuthError extends Error {
    status: number;
    errorType: ErrorStatus;
}

// Helper function to create auth errors
const createAuthError = (message: string, errorType: ErrorStatus, status: number): AuthError => {
    const error = new Error(message) as AuthError;
    error.status = status;
    error.errorType = errorType;
    return error;
};

// Check authorization header.
export const checkAuthHeader = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers["authorization"];
    
    if (!authHeader) {
        authLogger.log("Authorization check failed - missing header", { 
            reason: "Authorization header missing", 
            ip: req.ip,
            path: req.path,
            method: req.method
        });
        
        const error = createAuthError(
            "Access token required",
            ErrorStatus.jwtNotValid,
            401
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

    if (!token) {
        authLogger.log("Token extraction failed", {
            reason: "Invalid token format, expected \"Bearer <token>\"",
            ip: req.ip
        });
        
        const error = createAuthError(
            "Invalid token format",
            ErrorStatus.jwtNotValid,
            401
        );
        next(error);
        return;
    }
    
    req.token = token;
    next();
};

// Verifies the JWT signature and expiration.
export const verifyToken = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    
    // Ensure the JWT_SECRET is defined in environment variables.
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        errorLogger.log("FATAL: JWT_SECRET is not defined in environment variables.", { component: "authMiddleware" });
        const error = createAuthError(
            "Server security configuration error.",
            ErrorStatus.creationInternalServerError,
            500
        );
        next(error);
        return;
    }
    try {
        const decoded = jwt.verify(req.token!, secret) as { 
            userId: string; email: string; };
        
        req.user = decoded;
        
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

        authLogger.log("Token verification failed", { reason, ip: req.ip, path: req.path });
        
        const authError = createAuthError(
            "Invalid or expired token",
            ErrorStatus.jwtNotValid,
            403
        );
        next(authError);
        return; 
    }
};

// Verifies that the user from the token actually exists in the database.
export const verifyUserExists = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const userId = req.user && typeof req.user.userId === "string" ? req.user.userId : undefined;
        if (!userId) {
            authLogger.log("User verification failed", {
                reason: "User ID missing from token",
                ip: req.ip
            });
            const error = createAuthError(
                "Invalid token - user not found",
                ErrorStatus.jwtNotValid,
                401
            );
            next(error);
            return;
        }
        const user = await User.findByPk(userId);
        if (!user) {
            authLogger.log("User verification failed", {
                reason: "User not found in database",
                userId,
                email: req.user && typeof req.user.email === "string" ? req.user.email : undefined,
                ip: req.ip
            });
            
            const error = createAuthError(
                "Invalid token - user not found",
                ErrorStatus.jwtNotValid,
                401
            );
            next(error);
            return;
        }
        
        authLogger.log("User verification successful", {
            userId,
            email: req.user && typeof req.user.email === "string" ? req.user.email : undefined
        });
        
        next();
    } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        errorLogger.logDatabaseError("VERIFY_USER_EXISTS", "users", err.message);
        
        const authError = createAuthError(
            "User verification failed",
            ErrorStatus.readInternalServerError,
            500
        );
        next(authError);
    }
};

// Checks if the authenticated user is the same as the user being requested.
export const checkUserAuthorization = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {

    const userIdToAccess = (req.params as { userId?: string }).userId || (req.body as { userId?: string }).userId;
    
    if (!userIdToAccess) {
        errorLogger.log("Authorization logic error", { 
            reason: "checkUserAuthorization was called on a route without a userId in params or body.",
            path: req.path,
        });
        const error = createAuthError(
            "Access denied",
            ErrorStatus.userNotAuthorized,
            403
        );
        next(error);
        return;
    }

    if (!req.user || req.user.userId !== userIdToAccess) {
        authLogger.log("Authorization check failed", {
            authenticatedUserId: req.user?.userId || "none",
            requestedUserId: userIdToAccess,
            authorized: false,
            ip: req.ip
        });
        
        const error = createAuthError(
            "Access denied",
            ErrorStatus.userNotAuthorized,
            403
        );
        next(error);
        return;
    }

    authLogger.log("Authorization check successful", { authenticatedUserId: req.user.userId, authorized: true });
    next();
};

// Checks if the authenticated user is the owner of the requested execution.
export const checkExecutionOwnership = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const executionId = req.params.id; 
        const userId = req.user && typeof req.user.userId === "string" ? req.user.userId : undefined;

        if (!userId) {
            authLogger.log("Execution ownership check failed", {
                reason: "No authenticated user",
                executionId,
                ip: req.ip
            });
            
            const error = createAuthError(
                "Authentication required",
                ErrorStatus.jwtNotValid,
                401
            );
            next(error);
            return;
        }

        const executionDao = ExecutionDao.getInstance();
        const isOwner = await executionDao.isOwner(executionId, userId);
        
        if (!isOwner) {
            authLogger.log("Execution ownership check failed", {
                reason: "User is not owner",
                executionId,
                userId,
                ip: req.ip
            });
            
            const error = createAuthError(
                "Access denied - you can only access your own executions",
                ErrorStatus.userNotAuthorized,
                403
            );
            next(error);
            return;
        }

        authLogger.log("Execution ownership verified", {
            executionId,
            userId
        });

        next();
    } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        errorLogger.logDatabaseError("CHECK_EXECUTION_OWNERSHIP", "executions", err.message);
        
        const authError = createAuthError(
            "Authorization check failed",
            ErrorStatus.readInternalServerError,
            500
        );
        next(authError);
    }
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

// This chain checks if a user is authorized to access a specific execution.
export const authorizeExecutionAccess = [checkExecutionOwnership];