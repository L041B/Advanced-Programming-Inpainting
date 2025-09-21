// import necessary modules and types
import { TransactionDao } from "../dao/transactionDao";
import { TokenTransaction } from "../models/TokenTransaction";
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
 
// TransactionRepository class definition
export class TransactionRepository {
    private static instance: TransactionRepository;
    private readonly transactionDao: TransactionDao;
    private readonly errorManager: ErrorManager;
    private readonly errorLogger: ErrorRouteLogger;
 
    // Private constructor for singleton pattern
    private constructor() {
        this.transactionDao = TransactionDao.getInstance();
        this.errorManager = ErrorManager.getInstance();
        this.errorLogger = loggerFactory.createErrorLogger();
    }
 
    // Method to get the singleton instance
    public static getInstance(): TransactionRepository {
        if (!TransactionRepository.instance) {
            TransactionRepository.instance = new TransactionRepository();
        }
        return TransactionRepository.instance;
    }
 
    // Method to find transactions with user details based on filters and pagination
    public async findTransactionsWithUsers(
        filters: TransactionFilters,
        pagination: PaginationOptions
    ): Promise<{ rows: TokenTransaction[]; count: number }> {
        try {
            return await this.transactionDao.findWithUsers(filters, pagination);
        } catch (error) {
            this.errorLogger.logDatabaseError("findTransactionsWithUsers", "TokenTransaction", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
}
          