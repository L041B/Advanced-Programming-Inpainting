import { Request, Response } from "express";
import { TokenService } from "../services/tokenService";
import { UserRepository } from "../repository/userRepository";
import { loggerFactory, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

export class AdminController {
    private static readonly tokenService = TokenService.getInstance();
    private static readonly userRepository = UserRepository.getInstance();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

    // Recharge user tokens
    static async rechargeUserTokens(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        try {
            const adminUserId = req.user!.userId;
            const { email, amount } = req.body;

            if (!email || typeof email !== "string") {
                AdminController.errorLogger.logValidationError("email", email, "Valid email is required");
                res.status(400).json({ error: "Valid email is required" });
                return;
            }

            // Converti amount in numero e valida
            const numericAmount = parseFloat(amount);
            
            if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
                AdminController.errorLogger.logValidationError("amount", amount, "Valid positive numeric amount is required");
                res.status(400).json({ 
                    error: "Valid positive numeric amount is required",
                    received: {
                        value: amount,
                        type: typeof amount,
                        parsed: numericAmount,
                        isValid: !isNaN(numericAmount) && numericAmount > 0
                    }
                });
                return;
            }

            const result = await AdminController.tokenService.rechargeUserTokens(
                adminUserId,
                email,
                numericAmount // Usa il valore numerico convertito
            );

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: "Tokens recharged successfully",
                    data: {
                        userEmail: email,
                        amountAdded: numericAmount, // Mostra il valore numerico
                        newBalance: result.newBalance
                    }
                });
            } else {
                const statusCode = result.error?.includes("not found") ? 404 : 400;
                res.status(statusCode).json({ error: result.error });
            }
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            AdminController.errorLogger.logDatabaseError("RECHARGE_TOKENS", "admin", err.message);
            AdminController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get user token information
    static async getUserTokenInfo(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        try {
            const { email } = req.params;

            const user = await AdminController.userRepository.getUserByEmail(email);
            if (!user) {
                AdminController.errorLogger.logDatabaseError("GET_USER_TOKEN_INFO", "users", "User not found");
                res.status(404).json({ error: "User not found" });
                return;
            }

            const transactionResult = await AdminController.tokenService.getUserTransactionHistory(user.id);
            
            if (!transactionResult.success) {
                AdminController.errorLogger.logDatabaseError("GET_USER_TOKEN_INFO", "transactions", transactionResult.error || "Failed to get transactions");
                res.status(500).json({ error: "Failed to get transaction history" });
                return;
            }

            res.status(200).json({
                success: true,
                message: "User token information retrieved successfully",
                data: {
                    user: {
                        id: user.id,
                        name: user.name,
                        surname: user.surname,
                        email: user.email,
                        currentBalance: user.tokens,
                        role: user.role
                    },
                    transactions: transactionResult.transactions
                }
            });
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            AdminController.errorLogger.logDatabaseError("GET_USER_TOKEN_INFO", "admin", err.message);
            AdminController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

}
