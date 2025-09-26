// import necessary modules and types
import { TokenTransaction } from "../models/TokenTransaction";
import { User } from "../models/User";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
 
// Define filter and pagination interfaces
export interface TransactionFilters {
    status?: string;
    operationType?: string;
    userId?: string;
}
 
// Pagination options interface
export interface PaginationOptions {
    limit: number;
    offset: number;
}
 
// TransactionDao class definition
export class TransactionDao {
    private static instance: TransactionDao;
    private readonly sequelize: Sequelize;
    private readonly errorManager: ErrorManager;
    private readonly errorLogger: ErrorRouteLogger;
 
    // Private constructor for singleton pattern
    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
        this.errorManager = ErrorManager.getInstance();
        this.errorLogger = loggerFactory.createErrorLogger();
    }
 
    // Method to get the singleton instance
    public static getInstance(): TransactionDao {
        if (!TransactionDao.instance) {
            TransactionDao.instance = new TransactionDao();
        }
        return TransactionDao.instance;
    }
 
    // Method to find transactions with user details based on filters and pagination
    public async findWithUsers(
        filters: TransactionFilters,
        pagination: PaginationOptions
    ): Promise<{ rows: TokenTransaction[]; count: number }> {
        try {
            const whereConditions: Record<string, string> = {};
           
            // Apply filters if provided
            if (filters.status) {
                whereConditions.status = filters.status;
            }
            // Filter by operation type
            if (filters.operationType) {
                whereConditions.operationType = filters.operationType;
            }
            // Filter by user ID
            if (filters.userId) {
                whereConditions.userId = filters.userId;
            }
 
            return await TokenTransaction.findAndCountAll({
                where: whereConditions,
                include: [
                    {
                        model: User,
                        as: "user",
                        attributes: ["id", "name", "surname", "email", "tokens", "role"],
                        required: true
                    }
                ],
                attributes: ["id", "operationType", "operationId", "amount", "balanceBefore", "balanceAfter", "description", "createdAt"],
                order: [["createdAt", "DESC"]],
                limit: pagination.limit,
                offset: pagination.offset,
                distinct: true
            });
        } catch (error) {
            this.errorLogger.logDatabaseError("findWithUsers", "TokenTransaction", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
}

