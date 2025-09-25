// import necessary modules and types
import { TokenService } from "./tokenService";
import { UserRepository } from "../repository/userRepository";
import { TransactionRepository, TransactionFilters } from "../repository/transactionRepository";
import { DatasetRepository, DatasetFilters } from "../repository/datasetRepository";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
 
// Define result interfaces
export interface PaginatedTransactionsResult {
    transactions: Array<{
        id: string;
        operationType: string;
        operationId: string;
        amount: number | null;
        status: string;
        description: string;
        createdAt: Date;
        user: {
            id: string;
            name: string;
            surname: string;
            email: string;
            currentTokens: number;
            role: string;
        };
    }>;
    pagination: {
        totalItems: number;
        currentPage: number;
        totalPages: number;
        itemsPerPage: number;
    };
    filters: TransactionFilters;
    summary: {
        totalTransactions: number;
        statusBreakdown: Record<string, number>;
        operationBreakdown: Record<string, number>;
    };
}
 
// Define result interfaces
export interface PaginatedDatasetsResult {
    datasets: AnalyzedDataset[];
    pagination: {
        totalItems: number;
        currentPage: number;
        totalPages: number;
        itemsPerPage: number;
    };
    filters: DatasetFilters;
    summary: {
        totalDatasets: number;
        totalDatasetItems: number;
        totalEstimatedInferenceCost: number;
        typeBreakdown: Record<string, number>;
        statusBreakdown: Record<string, number>;
        orphanedDatasets: number;
        averageItemsPerDataset: number;
        queryInfo: {
            totalFromDatabase: number;
            totalAfterFiltering: number;
            includeDeletedRequested: boolean;
        };
    };
}
 
// Define AnalyzedDataset interface
export interface AnalyzedDataset {
    id: string;
    userId: string;
    name: string;
    tags: string[];
    datasetType: string;
    itemCount: number;
    estimatedInferenceCost: number;
    nextUploadIndex: number;
    createdAt: Date;
    updatedAt: Date;
    isDeleted: boolean;
    deletedAt: Date | null; // Add deletedAt field
    status: string;
    isOrphaned: boolean;
    user: {
        id: string;
        name: string;
        surname: string;
        email: string;
        currentTokens: number;
        role: string;
    };
}

type TransactionNumeric = number | string | null | undefined;

// AdminService class definition
export class AdminService {
    private static instance: AdminService;
    private readonly tokenService: TokenService;
    private readonly userRepository: UserRepository;
    private readonly transactionRepository: TransactionRepository;
    private readonly datasetRepository: DatasetRepository;
    private readonly errorManager: ErrorManager;
 
    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.tokenService = TokenService.getInstance();
        this.userRepository = UserRepository.getInstance();
        this.transactionRepository = TransactionRepository.getInstance();
        this.datasetRepository = DatasetRepository.getInstance();
        this.errorManager = ErrorManager.getInstance();
    }
 
    // Get the singleton instance of AdminService.
    public static getInstance(): AdminService {
        if (!AdminService.instance) {
            AdminService.instance = new AdminService();
        }
        return AdminService.instance;
    }
 
    // Method to recharge user tokens
    public async rechargeUserTokens(adminUserId: string, email: string, amount: number): Promise<number> {
        try {
            const newBalance = await this.tokenService.rechargeUserTokens(adminUserId, email, amount);
           
            // TokenService should now return a number (new balance) or throw an exception
            if (typeof newBalance !== "number") {
                throw this.errorManager.createError(ErrorStatus.tokenRechargeFailedError, "Invalid response from token service");
            }
           
            return newBalance;
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            throw this.errorManager.createError(ErrorStatus.tokenRechargeFailedError);
        }
    }

    // Method to get user token information
    public async getUserTokenInfo(email: string): Promise<{ user: { id: string; name: string; surname: string; email: string; currentBalance: number; role: string }; transactions: Array<{ id: string; operationType: string; operationId: string; amount: number; status: string; description: string; createdAt: Date ; balanceBefore: number; balanceAfter: number }> }> {
        try {
            const user = await this.userRepository.getUserByEmail(email);
            if (!user) {
                throw this.errorManager.createError(ErrorStatus.userNotFoundError);
            }
 
            const transactionResult = await this.tokenService.getUserTransactionHistory(user.id);
 
            if (!Array.isArray(transactionResult)) {
                throw this.errorManager.createError(ErrorStatus.readInternalServerError, "Failed to get transaction history");
            }
 
            return {
                user: {
                    id: user.id,
                    name: user.name,
                    surname: user.surname,
                    email: user.email,
                    currentBalance: user.tokens,
                    role: user.role
                },
                transactions: transactionResult.map(t => ({
                    id: t.id,
                    operationType: t.operationType,
                    operationId: t.operationId ?? "",
                    amount: Number(t.amount),
                    status: t.status,
                    description: t.description ?? "",
                    createdAt: t.createdAt,
                    balanceBefore: typeof t.balanceBefore === "number" ? t.balanceBefore : 0,
                    balanceAfter: typeof t.balanceAfter === "number" ? t.balanceAfter : 0
                }))
            };
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Method to get all transactions with filters and pagination
    public async getAllTransactions(
        filters: TransactionFilters,
        page: number,
        limit: number
    ): Promise<PaginatedTransactionsResult> {
        try {
            const offset = (page - 1) * limit;
            const { rows: transactions, count } = await this.transactionRepository.findTransactionsWithUsers(
                filters,
                { limit, offset }
            );


            // Fetch user info for each transaction (assuming transactions have userId)
            const transactionsWithUser = await Promise.all(transactions.map(async (t) => {
                let userInfo;
                if (t.userId) {
                    const user = await this.userRepository.getUserById(t.userId);
                    userInfo = user ? {
                        id: user.id,
                        name: user.name,
                        surname: user.surname,
                        email: user.email,
                        tokens: user.tokens,
                        role: user.role
                    } : {
                        id: "",
                        name: "Deleted User",
                        surname: "",
                        email: "user-deleted@system.local",
                        tokens: 0,
                        role: "user"
                    };
                } else {
                    userInfo = {
                        id: "",
                        name: "Deleted User",
                        surname: "",
                        email: "user-deleted@system.local",
                        tokens: 0,
                        role: "user"
                    };
                }
                return {
                    id: t.id,
                    operationType: t.operationType,
                    operationId: t.operationId ?? "",
                    amount: t.amount ?? null,
                    status: t.status,
                    description: t.description ?? "",
                    createdAt: t.createdAt,
                    user: userInfo
                };
            }));
            // Format transactions and calculate summary
            const formattedTransactions = this.formatTransactions(transactionsWithUser);
            const summary = this.calculateTransactionSummary(formattedTransactions);
 
            return {
                transactions: formattedTransactions,
                pagination: {
                    totalItems: count,
                    currentPage: page,
                    totalPages: Math.ceil(count / limit),
                    itemsPerPage: limit
                },
                filters,
                summary
            };
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Method to get all datasets with filters and pagination
    public async getAllDatasets(
        filters: DatasetFilters,
        page: number,
        limit: number
    ): Promise<PaginatedDatasetsResult> {
        try {
            const offset = (page - 1) * limit;
            const { rows: datasets, count } = await this.datasetRepository.findDatasetsWithUsers(
                filters,
                { limit, offset }
            );
 
            // Format datasets and calculate summary
            const formattedDatasets = this.formatAndAnalyzeDatasets(datasets, filters.type);
            const summary = this.calculateDatasetSummary(formattedDatasets, count, filters.includeDeleted || false);
 
            return {
                datasets: formattedDatasets,
                pagination: {
                    totalItems: count,
                    currentPage: page,
                    totalPages: Math.ceil(count / limit),
                    itemsPerPage: limit
                },
                filters,
                summary
            };
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Helper methods for formatting and analysis
    private formatTransactions(transactions: Array<{
        id: string;
        operationType: string;
        operationId: string;
        amount: TransactionNumeric;
        status: string;
        description: string;
        createdAt: Date;
        user?: {
            id: string;
            name: string;
            surname: string;
            email: string;
            tokens: number | string;
            role: string;
        } | null;
    }>): Array<{
        id: string;
        operationType: string;
        operationId: string;
        amount: number | null;
        status: string;
        description: string;
        createdAt: Date;
        user: {
            id: string;
            name: string;
            surname: string;
            email: string;
            currentTokens: number;
            role: string;
        };
    }> {
        return transactions.map(transaction => {
            const user = transaction.user ?? {
                id: "",
                name: "Deleted User",
                surname: "",
                email: "user-deleted@system.local",
                tokens: 0,
                role: "user"
            };
            return {
                id: transaction.id,
                operationType: transaction.operationType,
                operationId: transaction.operationId,
                amount: transaction.amount !== null && transaction.amount !== undefined ? Number(transaction.amount) : null,
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
    }
    // Helper method to calculate transaction summary
    private calculateTransactionSummary(
        transactions: Array<{
            id: string;
            operationType: string;
            operationId: string;
            amount: number | null;
            status: string;
            description: string;
            createdAt: Date;
            user: {
                id: string;
                name: string;
                surname: string;
                email: string;
                currentTokens: number;
                role: string;
            };
        }>
    ): PaginatedTransactionsResult["summary"] {
        return {
            totalTransactions: transactions.length,
            statusBreakdown: {
                pending: transactions.filter(t => t.status === "pending").length,
                completed: transactions.filter(t => t.status === "completed").length,
                refunded: transactions.filter(t => t.status === "refunded").length,
                aborted: transactions.filter(t => t.status === "aborted").length
            },
            operationBreakdown: {
                dataset_upload: transactions.filter(t => t.operationType === "dataset_upload").length,
                inference: transactions.filter(t => t.operationType === "inference").length,
                admin_recharge: transactions.filter(t => t.operationType === "admin_recharge").length
            }
        };
    }
 
    // Helper method to format and analyze datasets
    private formatAndAnalyzeDatasets(datasets: unknown[], typeFilter?: string): AnalyzedDataset[] {
        return datasets
            .map(dataset => this.analyzeDataset(dataset as {
                id: string;
                userId: string;
                name: string;
                tags: string[];
                data?: {
                    pairs?: Array<{ uploadIndex?: string | number }>;
                    type?: string;
                };
                nextUploadIndex: number;
                createdAt: Date;
                updatedAt: Date;
                isDeleted: boolean;
                deletedAt?: Date | null; // Add deletedAt field to input type
                user?: {
                    id: string;
                    name: string;
                    surname: string;
                    email: string;
                    tokens: number;
                    role: string;
                };
            }, typeFilter))
            .filter((dataset): dataset is AnalyzedDataset => dataset !== null);
    }
 
    // Helper method to analyze a single dataset
    private analyzeDataset(
        dataset: {
            id: string;
            userId: string;
            name: string;
            tags: string[];
            data?: {
                pairs?: Array<{ uploadIndex?: string | number }>;
                type?: string;
            };
            nextUploadIndex: number;
            createdAt: Date;
            updatedAt: Date;
            isDeleted: boolean;
            deletedAt?: Date | null; // Add deletedAt field to input type
            user?: {
                id: string;
                name: string;
                surname: string;
                email: string;
                tokens: number;
                role: string;
            };
        },
        typeFilter?: string
    ): AnalyzedDataset | null {
        const data = dataset.data ?? {};
        const user = dataset.user;
        const pairs = data.pairs || [];
 
        let datasetType = "empty";
        let itemCount = 0;
        let estimatedTokenCost = 0;
 
        if (pairs.length > 0) {
            itemCount = pairs.length;
            datasetType = data.type || "unknown";
            estimatedTokenCost = this.calculateEstimatedTokenCost(pairs, datasetType);
        }
 
        if (typeFilter && datasetType !== typeFilter) {
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
            deletedAt: dataset.deletedAt || null, // Include deletedAt in response
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
                id: "",
                name: "Deleted User",
                surname: "",
                email: "user-deleted@system.local",
                currentTokens: 0,
                role: "user"
            }
        };
    }
 
    // Helper method to calculate estimated token cost based on upload indexes and dataset type
    private calculateEstimatedTokenCost(pairs: Array<{ uploadIndex?: string | number }>, datasetType: string): number {
        const uploadIndexes = new Set<string>();
        let estimatedTokenCost = 0;
 
        pairs.forEach((pair) => {
            if (pair.uploadIndex !== undefined && pair.uploadIndex !== null) {
                uploadIndexes.add(pair.uploadIndex.toString());
            }
        });
 
        // Calculate cost based on dataset type and upload indexes
        if (uploadIndexes.size > 0) {
            for (const uploadIndex of uploadIndexes) {
                const indexPairs = pairs.filter((p) =>
                    p.uploadIndex !== undefined && p.uploadIndex.toString() === uploadIndex
                );
 
                if (indexPairs.length === 1) {
                    estimatedTokenCost += 2.75;
                } else {
                    estimatedTokenCost += indexPairs.length * 1.5;
                }
            }
        } else if (datasetType === "video-frames") {
            estimatedTokenCost = pairs.length * 1.5;
        } else {
            estimatedTokenCost = pairs.length * 2.75;
        }
 
        return estimatedTokenCost;
    }
 
    // Helper method to calculate dataset summary
    private calculateDatasetSummary(
        datasets: Array<{
            id: string;
            userId: string;
            name: string;
            tags: string[];
            datasetType: string;
            itemCount: number;
            estimatedInferenceCost: number;
            nextUploadIndex: number;
            createdAt: Date;
            updatedAt: Date;
            isDeleted: boolean;
            status: string;
            isOrphaned: boolean;
            user: {
                id: string | null;
                name: string;
                surname: string;
                email: string;
                currentTokens: number;
                role: string;
            };
        }>,
        totalFromDb: number,
        includeDeleted: boolean
    ): PaginatedDatasetsResult["summary"] {
        const totalItems = datasets.reduce((sum: number, dataset) => sum + dataset.itemCount, 0);
        const totalEstimatedCost = datasets.reduce((sum: number, dataset) => sum + dataset.estimatedInferenceCost, 0);
        const orphanedCount = datasets.filter(d => d.isOrphaned).length;
 
        const typeBreakdown = datasets.reduce((acc: Record<string, number>, dataset) => {
            acc[dataset.datasetType] = (acc[dataset.datasetType] || 0) + 1;
            return acc;
        }, {});
 
        const statusBreakdown = datasets.reduce((acc: Record<string, number>, dataset) => {
            acc[dataset.status] = (acc[dataset.status] || 0) + 1;
            return acc;
        }, {});
 
        return {
            totalDatasets: datasets.length,
            totalDatasetItems: totalItems,
            totalEstimatedInferenceCost: Math.round(totalEstimatedCost * 100) / 100,
            typeBreakdown,
            statusBreakdown,
            orphanedDatasets: orphanedCount,
            averageItemsPerDataset: datasets.length > 0 ?
                Math.round((totalItems / datasets.length) * 100) / 100 : 0,
            queryInfo: {
                totalFromDatabase: totalFromDb,
                totalAfterFiltering: datasets.length,
                includeDeletedRequested: includeDeleted
            }
        };
    }
}
