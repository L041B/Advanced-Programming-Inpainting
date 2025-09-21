import { Request, Response } from "express";
import { TokenService } from "../services/tokenService";
import { UserRepository } from "../repository/userRepository";
import { loggerFactory, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { Op } from "sequelize";

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
    private static validateEmail(email: unknown): string | null {
        if (!email || typeof email !== "string") {
            return "Valid email is required";
        }
        return null;
    }

    private static validateAmount(amount: unknown): { error: string | null; numericAmount: number } {
        const numericAmount = parseFloat(amount as string);
        if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
            return {
                error: "Valid positive numeric amount is required",
                numericAmount
            };
        }
        return { error: null, numericAmount };
    }

    private static handleValidationError(
        res: Response,
        logger: ErrorRouteLogger,
        field: string,
        value: unknown,
        error: string,
        extra?: object
    ): void {
        logger.logValidationError(field, value as string | number | undefined, error);
        res.status(400).json({ error, ...extra });
    }

    private static handleRechargeResponse(
        res: Response,
        email: string,
        numericAmount: number,
        rechargeResult: { success: boolean; newBalance?: number; error?: string }
    ): void {
        if (rechargeResult.success) {
            res.status(200).json({
                success: true,
                message: "Tokens recharged successfully",
                data: {
                    userEmail: email,
                    amountAdded: numericAmount,
                    newBalance: rechargeResult.newBalance
                }
            });
        } else {
            const statusCode = rechargeResult.error?.includes("not found") ? 404 : 400;
            res.status(statusCode).json({ error: rechargeResult.error });
        }
    }

    static async rechargeUserTokens(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        try {
            const adminUserId = req.user!.userId;
            const { email, amount } = req.body;

            const emailError = AdminController.validateEmail(email);
            if (emailError) {
                AdminController.handleValidationError(res, AdminController.errorLogger, "email", email, emailError);
                return;
            }

            const { error: amountError, numericAmount } = AdminController.validateAmount(amount);
            if (amountError) {
                AdminController.handleValidationError(
                    res,
                    AdminController.errorLogger,
                    "amount",
                    amount,
                    amountError,
                    {
                        received: {
                            value: amount,
                            type: typeof amount,
                            parsed: numericAmount,
                            isValid: !isNaN(numericAmount) && numericAmount > 0
                        }
                    }
                );
                return;
            }

            const rechargeRawResult = await AdminController.tokenService.rechargeUserTokens(
                adminUserId,
                email,
                numericAmount
            );

            const rechargeResult: { success: boolean; newBalance?: number; error?: string } =
                typeof rechargeRawResult === "number"
                    ? { success: true, newBalance: rechargeRawResult }
                    : rechargeRawResult;

            if (typeof rechargeResult === "object" && rechargeResult !== null && "success" in rechargeResult) {
                AdminController.handleRechargeResponse(res, email, numericAmount, rechargeResult);
            } else {
                res.status(500).json({ error: "Unexpected response from token service" });
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

            // If transactionResult is an array, treat it as success; if it's an object with error, handle error
            if (!Array.isArray(transactionResult)) {
                AdminController.errorLogger.logDatabaseError(
                    "GET_USER_TOKEN_INFO",
                    "transactions",
                    (typeof transactionResult === "object" && transactionResult !== null && "error" in transactionResult)
                        ? (transactionResult as { error: string }).error
                        : "Failed to get transactions"
                );
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
                    transactions: transactionResult
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

    // Get all transactions with user information (admin only)
    static async getAllTransactions(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        try {
            const { page = 1, limit = 50, status, operationType, userId } = req.query;
            
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const offset = (pageNum - 1) * limitNum;

            // Build filter conditions
            const whereConditions: Record<string, string> = {};
            if (status && typeof status === "string") {
                whereConditions.status = status;
            }
            if (operationType && typeof operationType === "string") {
                whereConditions.operationType = operationType;
            }
            if (userId && typeof userId === "string") {
                whereConditions.userId = userId;
            }

            // Get transactions with user information
            const { TokenTransaction } = await import("../models/TokenTransaction");
            const { User } = await import("../models/User");

            const { rows: transactions, count } = await TokenTransaction.findAndCountAll({
                where: whereConditions,
                include: [
                    {
                        model: User,
                        as: "user",
                        attributes: ["id", "name", "surname", "email", "tokens", "role"],
                        required: true
                    }
                ],
                order: [["createdAt", "DESC"]],
                limit: limitNum,
                offset: offset,
                distinct: true
            });

            // Format the response data
            const formattedTransactions = transactions.map(transaction => {
                const user = (transaction as unknown as { user: {
                    id: string;
                    name: string;
                    surname: string;
                    email: string;
                    tokens: number;
                    role: string;
                } }).user;

                return {
                    id: transaction.id,
                    operationType: transaction.operationType,
                    operationId: transaction.operationId,
                    amount: Number(transaction.amount),
                    balanceBefore: Number(transaction.balanceBefore),
                    balanceAfter: Number(transaction.balanceAfter),
                    status: transaction.status,
                    description: transaction.description,
                    createdAt: transaction.createdAt,
                    user: {
                        id: user.id,
                        name: user.name,
                        surname: user.surname,
                        email: user.email,
                        currentTokens: Number(user.tokens),
                        role: user.role
                    }
                };
            });

            res.status(200).json({
                success: true,
                message: "All transactions retrieved successfully",
                data: {
                    transactions: formattedTransactions,
                    pagination: {
                        totalItems: count,
                        currentPage: pageNum,
                        totalPages: Math.ceil(count / limitNum),
                        itemsPerPage: limitNum
                    },
                    filters: {
                        status: status || null,
                        operationType: operationType || null,
                        userId: userId || null
                    },
                    summary: {
                        totalTransactions: count,
                        statusBreakdown: {
                            pending: formattedTransactions.filter(t => t.status === "pending").length,
                            completed: formattedTransactions.filter(t => t.status === "completed").length,
                            refunded: formattedTransactions.filter(t => t.status === "refunded").length,
                            aborted: formattedTransactions.filter(t => t.status === "aborted").length // NEW: Include aborted transactions
                        },
                        operationBreakdown: {
                            dataset_upload: formattedTransactions.filter(t => t.operationType === "dataset_upload").length,
                            inference: formattedTransactions.filter(t => t.operationType === "inference").length,
                            admin_recharge: formattedTransactions.filter(t => t.operationType === "admin_recharge").length
                        }
                    }
                }
            });
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            AdminController.errorLogger.logDatabaseError("GET_ALL_TRANSACTIONS", "admin", err.message);
            AdminController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get all datasets with user information (admin only)
    static async getAllDatasets(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        AdminController.apiLogger.logRequest(req);

        try {
            const { page = 1, limit = 50, userId, name, type, includeDeleted = "false" } = req.query;
            
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const offset = (pageNum - 1) * limitNum;

            // Build filter conditions
            const whereConditions: Record<string, unknown> = {};
            
            // Includi dataset eliminati solo se richiesto esplicitamente
            if (includeDeleted !== "true") {
                whereConditions.isDeleted = false;
            }
            
            if (userId && typeof userId === "string") {
                whereConditions.userId = userId;
            }
            if (name && typeof name === "string") {
                whereConditions.name = { [Op.iLike]: `%${name}%` };
            }

            // Get datasets with user information
            const { Dataset } = await import("../models/Dataset");
            const { User } = await import("../models/User");

            const { rows: datasets, count } = await Dataset.findAndCountAll({
                where: whereConditions,
                include: [
                    {
                        model: User,
                        as: "user",
                        attributes: ["id", "name", "surname", "email", "tokens", "role"],
                        required: false // CHANGED: Permette dataset orfani (user_id = NULL)
                    }
                ],
                order: [["createdAt", "DESC"]],
                limit: limitNum,
                offset: offset,
                distinct: true
            });

            // Helper function to analyze dataset content and return formatted object

            interface DatasetWithUser {
                id: string;
                userId: string | null;
                name: string;
                tags: string[];
                data?: {
                    pairs?: Array<{
                        imagePath: string;
                        maskPath: string;
                        frameIndex?: number;
                        uploadIndex?: string | number;
                    }>;
                    type?: string;
                };
                nextUploadIndex?: number;
                createdAt: Date;
                updatedAt: Date;
                isDeleted: boolean;
                user?: {
                    id: string;
                    name: string;
                    surname: string;
                    email: string;
                    tokens: number;
                    role: string;
                } | null;
            }

            function calculateEstimatedTokenCost(pairs: Array<{ uploadIndex?: string | number }>, datasetType: string): number {
                const uploadIndexes = new Set<string>();
                let estimatedTokenCost = 0;

                pairs.forEach((pair) => {
                    if (pair.uploadIndex !== undefined && pair.uploadIndex !== null) {
                        uploadIndexes.add(pair.uploadIndex.toString());
                    }
                });

                if (uploadIndexes.size > 0) {
                    for (const uploadIndex of uploadIndexes) {
                        const indexPairs = pairs.filter((p) =>
                            p.uploadIndex !== undefined && p.uploadIndex.toString() === uploadIndex
                        );

                        if (indexPairs.length === 1) {
                            estimatedTokenCost += 2.75; // Single image
                        } else {
                            estimatedTokenCost += indexPairs.length * 1.5; // Video frames
                        }
                    }
                } else if (datasetType === "video-frames") {
                    estimatedTokenCost = pairs.length * 1.5;
                } else {
                    estimatedTokenCost = pairs.length * 2.75;
                }

                return estimatedTokenCost;
            }

            function analyzeDataset(dataset: DatasetWithUser, type: string | undefined) {
                // Ensure data is always an object, never null
                const data = (dataset.data ?? {}) as {
                    pairs?: Array<{
                        imagePath: string;
                        maskPath: string;
                        frameIndex?: number;
                        uploadIndex?: string | number;
                    }>;
                    type?: string;
                };

                const user = dataset.user as {
                    id: string;
                    name: string;
                    surname: string;
                    email: string;
                    tokens: number;
                    role: string;
                } | null; // User can be null for orphaned datasets

                const pairs = data.pairs || [];

                let datasetType = "empty";
                let itemCount = 0;
                let estimatedTokenCost = 0;

                if (pairs.length > 0) {
                    itemCount = pairs.length;
                    datasetType = data.type || "unknown";
                    estimatedTokenCost = calculateEstimatedTokenCost(pairs, datasetType);
                }

                if (type && typeof type === "string" && datasetType !== type) {
                    return null;
                }

                return {
                    id: dataset.id,
                    userId: dataset.userId,
                    name: dataset.name,
                    tags: dataset.tags,
                    datasetType,
                    itemCount,
                    estimatedInferenceCost: Math.round(estimatedTokenCost * 100) / 100,
                    nextUploadIndex: dataset.nextUploadIndex,
                    createdAt: dataset.createdAt,
                    updatedAt: dataset.updatedAt,
                    isDeleted: dataset.isDeleted,
                    status: dataset.isDeleted ? "deleted" : "active",
                    isOrphaned: !user,
                    user: user ? {
                        id: user.id,
                        name: user.name,
                        surname: user.surname,
                        email: user.email,
                        currentTokens: Number(user.tokens),
                        role: user.role
                    } : {
                        id: null,
                        name: "Deleted User",
                        surname: "",
                        email: "user-deleted@system.local",
                        currentTokens: 0,
                        role: "user"
                    }
                };
            }
            
            // Ensure 'type' is a string or undefined
            const typeString = typeof type === "string" ? type : undefined;

            // Format the response data with dataset analysis
            const formattedDatasets = datasets
                .map(dataset => {
                    // Ensure dataset.data is never null
                    const safeDataset = {
                        ...dataset,
                        data: dataset.data ?? {}
                    };
                    return analyzeDataset(safeDataset as DatasetWithUser, typeString);
                })
                .filter((dataset): dataset is NonNullable<typeof dataset> => dataset !== null);

            // Calculate summary statistics with orphaned info
            const typeBreakdown = formattedDatasets.reduce((acc: Record<string, number>, dataset) => {
                acc[dataset.datasetType] = (acc[dataset.datasetType] || 0) + 1;
                return acc;
            }, {});

            const statusBreakdown = formattedDatasets.reduce((acc: Record<string, number>, dataset) => {
                acc[dataset.status] = (acc[dataset.status] || 0) + 1;
                return acc;
            }, {});

            const orphanedCount = formattedDatasets.filter(d => d.isOrphaned).length;

            const totalItems = formattedDatasets.reduce((sum: number, dataset) => sum + dataset.itemCount, 0);
            const totalEstimatedCost = formattedDatasets.reduce((sum: number, dataset) => sum + dataset.estimatedInferenceCost, 0);

            res.status(200).json({
                success: true,
                message: "All datasets retrieved successfully",
                data: {
                    datasets: formattedDatasets,
                    pagination: {
                        totalItems: count,
                        currentPage: pageNum,
                        totalPages: Math.ceil(count / limitNum),
                        itemsPerPage: limitNum
                    },
                    filters: {
                        userId: userId || null,
                        name: name || null,
                        type: type || null,
                        includeDeleted: includeDeleted === "true"
                    },
                    summary: {
                        totalDatasets: formattedDatasets.length,
                        totalDatasetItems: totalItems,
                        totalEstimatedInferenceCost: Math.round(totalEstimatedCost * 100) / 100,
                        typeBreakdown,
                        statusBreakdown,
                        orphanedDatasets: orphanedCount, // NEW: Count of orphaned datasets
                        averageItemsPerDataset: formattedDatasets.length > 0 ? 
                            Math.round((totalItems / formattedDatasets.length) * 100) / 100 : 0,
                        queryInfo: {
                            totalFromDatabase: count,
                            totalAfterFiltering: formattedDatasets.length,
                            includeDeletedRequested: includeDeleted === "true"
                        }
                    }
                }
            });
            AdminController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            AdminController.errorLogger.logDatabaseError("GET_ALL_DATASETS", "admin", err.message);
            AdminController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

}
