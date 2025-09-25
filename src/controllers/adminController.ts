// import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { AdminService } from "../services/adminService";
import { loggerFactory, ApiRouteLogger } from "../factory/loggerFactory";
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
    private static readonly errorManager = ErrorManager.getInstance();
 
    // Method to recharge user tokens
    static async rechargeUserTokens(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        // Validate admin authentication
        try {
            const adminUserId = req.user!.userId;
            const { email, amount } = req.body;

            // Validate input parameters
            if (!email || typeof email !== "string") {
                const error = AdminController.errorManager.createError(ErrorStatus.invalidParametersError, "Valid email is required");
                next(error);
                return;
            }

            // Validate amount is a positive number
            const numericAmount = parseFloat(amount);
            if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
                const error = AdminController.errorManager.createError(ErrorStatus.invalidParametersError, "Valid positive numeric amount is required");
                next(error);
                return;
            }

            // Check for maximum allowable amount
            const MAX_AMOUNT = 1_000_000;
            if (numericAmount > MAX_AMOUNT) {
                const error = AdminController.errorManager.createError(
                    ErrorStatus.invalidParametersError,
                    `Amount too large. Maximum allowed is ${MAX_AMOUNT}.`
                );
                next(error);
                return;
            }

            // Recharge tokens using the service
            const newBalance = await AdminController.adminService.rechargeUserTokens(adminUserId, email, numericAmount);

            // Send success response
            res.status(200).json({
                success: true,
                message: "Tokens recharged successfully",
                data: {
                    userEmail: email,
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
 
            const result = await AdminController.adminService.getUserTokenInfo(email);
 
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
                status: typeof status === "string" ? status : undefined,
                operationType: typeof operationType === "string" ? operationType : undefined,
                userId: typeof userId === "string" ? userId : undefined
            };
 
            // Fetch transactions using the service
            const result = await AdminController.adminService.getAllTransactions(filters, pageNum, limitNum);
 
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
