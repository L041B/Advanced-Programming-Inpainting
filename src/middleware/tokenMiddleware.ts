// import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { TokenService } from "../services/tokenService";
import { UserRepository } from "../repository/userRepository";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";

// Initialize loggers and error manager
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
const errorManager = ErrorManager.getInstance();

// Extend Request type to include user and token info
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
    tokenReservation?: {
        reservationKey: string;
        reservedAmount: number;
    };
    operationResult?: {
        tokensSpent?: number;
        remainingBalance?: number;
        operationType?: string;
    };
}

// TokenMiddleware class with static methods for token validation and management
export class TokenMiddleware {
    private static readonly tokenService = TokenService.getInstance();
    private static readonly userRepository = UserRepository.getInstance();

    // Simple validation middleware - just checks if user has ANY tokens
    static async validateTokenBalance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                throw errorManager.createError(
                    ErrorStatus.jwtNotValid,
                    "Authentication required for token-based operations"
                );
            }

            // Check user token balance
            const balance = await TokenMiddleware.tokenService.getUserTokenBalance(userId);

            // Defensive check - should always be a number
            if (typeof balance !== "number") {
                errorLogger.logDatabaseError("VALIDATE_TOKEN_BALANCE", "users", "Failed to retrieve balance");
                throw errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Unable to verify your current token balance"
                );
            }

            // If balance is zero or negative, block the operation
            if (balance <= 0) {
                errorLogger.logAuthorizationError(userId, `Zero token balance: ${balance}`);
                throw errorManager.createError(
                    ErrorStatus.insufficientTokensError,
                    `Your current token balance is ${balance} tokens. You need tokens to perform this operation. Please contact an administrator to recharge your account.`
                );
            }

            next();

        } catch (error) {
            // Pass standardized errors to error middleware
            if (error instanceof Error && "errorType" in error) {
                next(error);
            } else {
                // Log unexpected errors
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logDatabaseError("VALIDATE_TOKEN_BALANCE", "middleware", err.message);
                const standardError = errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Token balance validation failed"
                );
                // Pass to error middleware
                next(standardError);
            }
        }
    }

    // Simple admin validation middleware
    static async validateAdminRole(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                throw errorManager.createError(
                    ErrorStatus.jwtNotValid,
                    "Authentication required for admin verification"
                );
            }

            // Check if user is admin
            const isAdmin = await TokenMiddleware.userRepository.isAdmin(userId);
            if (!isAdmin) {
                // Log and throw error if not admin
                errorLogger.logAuthorizationError(userId, "Admin privileges required but not granted");
                throw errorManager.createError(
                    ErrorStatus.adminPrivilegesRequiredError,
                    "Administrator privileges required for this operation"
                );
            }

            next();

        } catch (error) {
            // Pass standardized errors to error middleware
            if (error instanceof Error && "errorType" in error) {
                next(error);
            } else {
                // Log unexpected errors
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logDatabaseError("VALIDATE_ADMIN_ROLE", "users", err.message);
                const standardError = errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Admin role validation failed"
                );
                next(standardError);
            }
        }
    }

    // Simple response enhancement middleware - just injects token info if available
    static injectTokenCostInResponse(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
        const originalJson = res.json;
        // Override res.json to inject token usage info
        res.json = function(body: object) {
            // Inject token usage info if available
            if (req.operationResult && body && typeof body === "object" && !Array.isArray(body)) {
                (body as Record<string, unknown>).tokenUsage = {
                    tokensSpent: req.operationResult.tokensSpent || 0,
                    remainingBalance: req.operationResult.remainingBalance || 0,
                    operationType: req.operationResult.operationType || "operation"
                };
            }
            return originalJson.call(this, body);
        };
        // Call next middleware
        next();
    }

    // Simple cleanup middleware - attempts to finalize token usage but doesn't fail if it can't
    static async finalizeTokenUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            // Only attempt finalization if we have reservation info but no operation result yet
            if (req.operationResult || !req.tokenReservation) {
                next();
                return;
            }

            // Attempt to finalize token usage
            try {
                const finalizeResult = await TokenMiddleware.tokenService.confirmTokenUsage(
                    req.tokenReservation.reservationKey
                );

                // Store the result for response enhancement
                req.operationResult = {
                    tokensSpent: finalizeResult.tokensSpent || req.tokenReservation.reservedAmount,
                    remainingBalance: finalizeResult.remainingBalance || 0,
                    operationType: "operation_completed"
                };
            } catch (confirmError) {
                // Log but don't fail - this is supplementary information
                errorLogger.logDatabaseError("FINALIZE_TOKEN_USAGE", "middleware", 
                    confirmError instanceof Error ? confirmError.message : "Token confirmation failed");
                
                // Provide fallback operation result
                req.operationResult = {
                    tokensSpent: req.tokenReservation.reservedAmount,
                    remainingBalance: 0,
                    operationType: "operation_completed"
                };
            }

            // Proceed to next middleware
            next();
        } catch (error) {
            // Log but don't fail the request - this is cleanup logic
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("FINALIZE_TOKEN_USAGE", "middleware", err.message);
            next();
        }
    }
}
          