import { Request, Response, NextFunction } from "express";
import { TokenService } from "../services/tokenService";
import { UserRepository } from "../repository/userRepository";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

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

export class TokenMiddleware {
    private static tokenManagementService = TokenService.getInstance();
    private static userManagementRepository = UserRepository.getInstance();

    // Verify user has available tokens (return 401 if zero balance)
    static async validateTokenBalance(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ 
                    error: "Authentication required", 
                    message: "You must be logged in to perform token-based operations."
                });
                return;
            }

            // Get fresh balance data
            const balanceCheck = await TokenMiddleware.tokenManagementService.getUserTokenBalance(userId);
            
            if (!balanceCheck.success) {
                errorLogger.logDatabaseError("VALIDATE_TOKEN_BALANCE", "users", balanceCheck.error || "Failed to retrieve balance");
                res.status(500).json({ 
                    error: "Token balance verification failed",
                    message: "Unable to verify your current token balance. Please try again or contact support."
                });
                return;
            }

            // Return 401 if user has zero or negative token balance
            if (balanceCheck.balance! <= 0) {
                errorLogger.logAuthorizationError(userId, `Insufficient token balance: ${balanceCheck.balance}`);
                res.status(401).json({ 
                    error: "Insufficient token balance", 
                    message: `Your current token balance is ${balanceCheck.balance} tokens. You need tokens to perform this operation. Please contact an administrator to recharge your account.`,
                    currentBalance: balanceCheck.balance,
                    actionRequired: "Token recharge needed"
                });
                return;
            }

            next();

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VALIDATE_TOKEN_BALANCE", "middleware", err.message);
            res.status(500).json({ 
                error: "Token balance validation failed",
                message: "An unexpected error occurred while checking your token balance. Please try again."
            });
        }
    }

    // Validate admin privileges
    static async validateAdminRole(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ error: "Authentication required for admin verification" });
                return;
            }

            const adminCheck = await TokenMiddleware.userManagementRepository.isAdmin(userId);
            if (!adminCheck) {
                errorLogger.logAuthorizationError(userId, "Admin privileges required but not granted");
                res.status(403).json({ error: "Administrator privileges required for this operation" });
                return;
            }

            next();

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VALIDATE_ADMIN_ROLE", "users", err.message);
            res.status(500).json({ error: "Admin role validation failed" });
        }
    }

    // Reserve tokens before operation starts
    static async reserveTokensForOperation(
        operationType: "dataset_upload" | "inference",
        costCalculator: (operationData: Record<string, unknown>) => number
    ) {
        return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
            try {
                const userId = req.user?.userId;
                if (!userId) {
                    res.status(401).json({ 
                        error: "Authentication required",
                        message: "You must be logged in to perform token-based operations."
                    });
                    return;
                }

                // Calculate token cost based on operation data
                const tokenCost = costCalculator(req.body);
                
                if (tokenCost <= 0) {
                    res.status(400).json({ 
                        error: "Invalid operation data",
                        message: "Unable to calculate token cost for this operation. Please check your request data."
                    });
                    return;
                }

                // Check current balance before attempting reservation
                const balanceCheck = await TokenMiddleware.tokenManagementService.getUserTokenBalance(userId);
                if (!balanceCheck.success || balanceCheck.balance! < tokenCost) {
                    const currentBalance = balanceCheck.balance || 0;
                    const shortfall = tokenCost - currentBalance;
                    const operationName = operationType === "dataset_upload" ? "dataset upload" : "inference processing";
                    
                    res.status(400).json({ 
                        error: "Insufficient tokens", 
                        message: `You need ${tokenCost} tokens for this ${operationName} operation, but your current balance is ${currentBalance} tokens. You are short ${shortfall} tokens. Please contact an administrator to recharge your account.`,
                        details: {
                            requiredTokens: tokenCost,
                            currentBalance: currentBalance,
                            shortfall: shortfall,
                            operationType: operationName,
                            actionRequired: "Token recharge needed"
                        }
                    });
                    return;
                }

                // Reserve tokens
                const reservationResult = await TokenMiddleware.tokenManagementService.reserveTokens(
                    userId,
                    tokenCost,
                    operationType,
                    `${operationType}_${Date.now()}`
                );

                if (!reservationResult.success) {
                    // The TokenService now provides detailed error messages
                    res.status(400).json({ 
                        error: "Token reservation failed", 
                        message: reservationResult.error || "Failed to reserve tokens for this operation. Please try again.",
                        details: {
                            operationType: operationType === "dataset_upload" ? "dataset upload" : "inference processing",
                            requestedAmount: tokenCost,
                            actionRequired: "Please try again or contact support"
                        }
                    });
                    return;
                }

                // Store reservation info in request
                req.tokenReservation = {
                    reservationKey: reservationResult.reservationId!,
                    reservedAmount: tokenCost
                };

                next();

            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logDatabaseError("RESERVE_TOKENS", "middleware", err.message);
                res.status(500).json({ 
                    error: "Token reservation failed",
                    message: "An unexpected error occurred while reserving tokens. Please try again or contact support.",
                    details: {
                        operationType: operationType === "dataset_upload" ? "dataset upload" : "inference processing",
                        errorType: "System error"
                    }
                });
            }
        };
    }

    // Middleware to inject token cost into JSON responses
    static injectTokenCostInResponse(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
        const originalJson = res.json;
        
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
        
        next();
    }

    // Finalize token usage after successful operation
    static async finalizeTokenUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            // Check if we already have operation result from controller
            if (req.operationResult) {
                // Token usage already handled by controller
                next();
                return;
            }

            // Fallback: if we have a reservation but no operation result
            if (!req.tokenReservation) {
                next();
                return;
            }

            const finalizeResult = await TokenMiddleware.tokenManagementService.confirmTokenUsage(
                req.tokenReservation.reservationKey
            );

            if (finalizeResult.success && finalizeResult.tokensSpent !== undefined) {
                req.operationResult = {
                    tokensSpent: finalizeResult.tokensSpent,
                    remainingBalance: finalizeResult.remainingBalance,
                    operationType: "operation_completed"
                };
            } else {
                // If finalization fails, still store the reserved amount as spent
                req.operationResult = {
                    tokensSpent: req.tokenReservation.reservedAmount,
                    remainingBalance: 0,
                    operationType: "operation_completed"
                };

                // Try to get current balance anyway
                const userId = req.user?.userId;
                if (userId) {
                    const balanceResult = await TokenMiddleware.tokenManagementService.getUserTokenBalance(userId);
                    if (balanceResult.success) {
                        req.operationResult.remainingBalance = balanceResult.balance || 0;
                    }
                }
            }

            next();

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("FINALIZE_TOKEN_USAGE", "middleware", err.message);
            
            // Even on error, try to provide some token info
            if (req.tokenReservation) {
                req.operationResult = {
                    tokensSpent: req.tokenReservation.reservedAmount,
                    remainingBalance: 0,
                    operationType: "operation_completed"
                };
            }
            
            next(); // Continue even if token finalization fails
        }
    }

    // Refund tokens if operation fails
    static async refundTokensOnError(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.tokenReservation) {
                next();
                return;
            }

            await TokenMiddleware.tokenManagementService.refundTokens(
                req.tokenReservation.reservationKey
            );

            next();

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("REFUND_TOKENS", "middleware", err.message);
            next();
        }
    }

    // Error handler that ensures token refund on operation failure
    static handleTokenOperationError(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        return async (error: unknown) => {
            if (req.tokenReservation) {
                try {
                    await TokenMiddleware.tokenManagementService.refundTokens(
                        req.tokenReservation.reservationKey
                    );
                } catch (refundError) {
                    errorLogger.logDatabaseError("ERROR_REFUND", "middleware", 
                        `Failed to refund tokens: ${refundError}`);
                }
            }
            next(error);
        };
    }
}
