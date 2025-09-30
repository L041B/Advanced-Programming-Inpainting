// import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { AdminService } from "../services/adminService";
import { loggerFactory, ApiRouteLogger, UserRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
 
// Extend Request interface to include user property
interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}
 
// AdminController class definition
export class AdminController {
    private static readonly adminService = AdminService.getInstance();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly userLogger: UserRouteLogger = loggerFactory.createUserLogger();
    private static readonly errorManager = ErrorManager.getInstance();
 
    // Method to recharge user tokens
    static async rechargeUserTokens(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        try {
            const adminUserId = req.user!.userId;
            const { email, amount } = req.body;

            // Validate email parameter
            if (!email || typeof email !== "string" || email.trim().length === 0) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError, 
                    "Valid email is required and cannot be empty"
                );
                next(error);
                return;
            }

            // Validate amount is provided
            if (amount === undefined || amount === null || amount === "") {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError, 
                    "Amount is required"
                );
                next(error);
                return;
            }

            // Convert amount to string for validation
            const amountStr = String(amount).trim();

            // Check if amount contains invalid characters (letters, commas, multiple dots, etc.)
            const invalidCharRegex = /[^0-9.]/;
            if (invalidCharRegex.test(amountStr)) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError, 
                    "Amount can only contain numbers and a single decimal point. Letters, commas, and other characters are not allowed"
                );
                next(error);
                return;
            }

            // Check for multiple decimal points
            const decimalPoints = amountStr.split(".").length - 1;
            if (decimalPoints > 1) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError, 
                    "Amount cannot contain multiple decimal points"
                );
                next(error);
                return;
            }

            // Check decimal places (max 2)
            if (decimalPoints === 1) {
                const decimalPart = amountStr.split(".")[1];
                if (decimalPart && decimalPart.length > 2) {
                    const error = AdminController.errorManager.createError(
                        ErrorStatus.invalidParametersError, 
                        "Amount cannot have more than 2 decimal places"
                    );
                    next(error);
                    return;
                }
            }

            // Convert to number and validate
            const numericAmount = parseFloat(amountStr);
            if (isNaN(numericAmount)) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError, 
                    "Amount must be a valid number"
                );
                next(error);
                return;
            }

            // Check if amount is positive
            if (numericAmount <= 0) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError, 
                    "Amount must be greater than 0"
                );
                next(error);
                return;
            }

            // Check for maximum allowable amount
            const MAX_AMOUNT = 1_000_000;
            if (numericAmount > MAX_AMOUNT) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError,
                    `Amount too large. Maximum allowed is ${MAX_AMOUNT} tokens`
                );
                next(error);
                return;
            }

            // Check for minimum allowable amount (0.01)
            if (numericAmount < 0.01) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError,
                    "Amount must be at least 0.01 tokens"
                );
                next(error);
                return;
            }

            // Recharge tokens using the service
            const newBalance = await AdminController.adminService.rechargeUserTokens(adminUserId, email.trim(), numericAmount);

            // Send success response
            res.status(200).json({
                success: true,
                message: "Tokens recharged successfully",
                data: {
                    userEmail: email.trim(),
                    amountAdded: numericAmount,
                    newBalance: newBalance
                }
            });

            // Log response details
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            AdminController.apiLogger.logError(req, error as Error);
            next(error);
        }
    }
 
    // Method to get user token information
    static async getUserTokenInfo(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        // Validate input parameters
        try {
            const { email } = req.params;
            const adminUserId = req.user!.userId;
 
            const result = await AdminController.adminService.getUserTokenInfo(email);
            
            // Log the admin token balance check
            AdminController.userLogger.logTokenBalanceCheck(result.user.id, result.user.currentBalance);
            AdminController.userLogger.log("ADMIN_TOKEN_BALANCE_INQUIRY", {
                adminUserId,
                targetUserEmail: email,
                targetUserId: result.user.id,
                currentBalance: result.user.currentBalance
            });
 
            // Send success response
            res.status(200).json({
                success: true,
                message: "User token information retrieved successfully",
                data: result
            });
            
            // Log response details
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            AdminController.apiLogger.logError(req, error as Error);
            next(error);
        }
    }
 
    // Method to get all transactions with pagination and filtering
    static async getAllTransactions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);
 
        // Validate input parameters
        try {
            const { page = 1, limit = 50, status, operationType, userId } = req.query;
            const adminUserId = req.user!.userId;
           
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
 
            // Validate pagination parameters
            const MAX_PAGE = 1_000_000;
            const MAX_LIMIT = 100;
            if (isNaN(pageNum) || pageNum < 1 || pageNum > MAX_PAGE || isNaN(limitNum) || limitNum < 1 || limitNum > MAX_LIMIT) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError,
                    `Invalid pagination parameters: 'page' must be 1-${MAX_PAGE}.`
                );
                next(error);
                return;
            }
 
            // Prepare filters
            const filters = {
                status: typeof status === "string" ? status : undefined,
                operationType: typeof operationType === "string" ? operationType : undefined,
                userId: typeof userId === "string" ? userId : undefined
            };
 
            // Fetch transactions using the service
            const result = await AdminController.adminService.getAllTransactions(filters, pageNum, limitNum);

            // Log the admin transaction retrieval
            AdminController.userLogger.log("ADMIN_TRANSACTIONS_RETRIEVAL", {
                adminUserId,
                filters,
                page: pageNum,
            });
 
            res.status(200).json({
                success: true,
                message: "All transactions retrieved successfully",
                data: result
            });
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            AdminController.apiLogger.logError(req, error as Error);
            next(error);
        }
    }
 
    // Method to get all datasets with pagination and filtering
    static async getAllDatasets(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);
 
        // Validate input parameters
        try {
            const { page = 1, limit = 50, userId, name, type, includeDeleted = "false" } = req.query;
            const adminUserId = req.user!.userId;
           
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
 
            // Validate pagination parameters
            if (isNaN(pageNum) || pageNum < 1 || isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
                const error = AdminController.errorManager.createError(ErrorStatus.invalidParametersError, "Invalid pagination parameters");
                next(error);
                return;
            }
 
            // Prepare filters
            const filters = {
                userId: typeof userId === "string" ? userId : undefined,
                name: typeof name === "string" ? name : undefined,
                type: typeof type === "string" ? type : undefined,
                includeDeleted: includeDeleted === "true"
            };
 
            // Fetch datasets using the service
            const result = await AdminController.adminService.getAllDatasets(filters, pageNum, limitNum);

            // Log the admin dataset retrieval
            AdminController.userLogger.log("ADMIN_DATASETS_RETRIEVAL", {
                adminUserId,
                filters,
                page: pageNum,
            });
 
            res.status(200).json({
                success: true,
                message: "All datasets retrieved successfully",
                data: result
            });
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            AdminController.apiLogger.logError(req, error as Error);
            next(error);
        }
    }
}
