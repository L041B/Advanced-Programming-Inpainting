// Import the necessary model and DAO.
import { Execution } from '../models/Execution';
import { ExecutionDao } from '../dao/executionDao';
// Import custom logger utilities.
import { loggerFactory, ExecutionRouteLogger, ErrorRouteLogger } from '../factory/loggerFactory';

// Define interfaces for data structures. This is great for type safety.
export interface ExecutionData {
    userId: string;
    originalImage: Buffer;
    maskImage: Buffer;
    outputImage?: Buffer;
    status?: 'pending' | 'processing' | 'completed' | 'failed';
}

// Define a type for updating execution data.
type ExecutionUpdateData = Partial<Omit<ExecutionData, 'userId'>>;

// ExecutionRepository provides an abstraction layer over ExecutionDao for execution-related operations.
export class ExecutionRepository {
    private static instance: ExecutionRepository;
    private readonly executionDao: ExecutionDao;
    private readonly executionLogger: ExecutionRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.executionDao = ExecutionDao.getInstance();
        this.executionLogger = loggerFactory.createExecutionLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Get the singleton instance of ExecutionRepository.
    public static getInstance(): ExecutionRepository {
        if (!ExecutionRepository.instance) {
            ExecutionRepository.instance = new ExecutionRepository();
        }
        return ExecutionRepository.instance;
    }

    // Creates a new execution record.
    public async createExecution(data: Omit<ExecutionData, 'userId'>, userId: string): Promise<Execution> {
        this.executionLogger.log('Creating new execution', { userId, operation: 'CREATE_EXECUTION' });

        const execution = await this.executionDao.create({ ...data, userId });
        this.executionLogger.logExecutionCreation(execution.id, userId, execution.status);
        return execution;
    }

    // Retrieves an execution and its associated user data.
    public async getExecutionWithUser(id: string): Promise<Execution | null> {
        this.executionLogger.log('Retrieving execution with user data', { executionId: id });

        return await this.executionDao.findByIdWithUser(id);
    }

    // Retrieves basic info for an execution, including its user ID.
    public async getExecutionBasicInfoWithUserId(id: string): Promise<Execution | null> {
        return await this.executionDao.findByIdBasicInfo(id);
    }

    // Retrieves all executions belonging to a specific user.
    public async getUserExecutions(userId: string): Promise<Execution[]> {
        return await this.executionDao.findByUserId(userId);
    }
    
    // Updates an existing execution.
    public async updateExecution(id: string, userId: string, data: ExecutionUpdateData): Promise<Execution> {
        this.executionLogger.log('Updating execution', { executionId: id, userId });
        try {
            // The DAO correctly handles the transaction and ownership check.
            const execution = await this.executionDao.update(id, userId, data);
            this.executionLogger.logExecutionUpdate(id, userId, Object.keys(data));
            // This also returns a Sequelize model instance.
            return execution;
        } catch (error) {
            this.errorLogger.logDatabaseError('UPDATE_EXECUTION_REPO', 'executions', (error as Error).message);
            throw error;
        }
    }

    // Updates only the status of an execution.
    public async updateExecutionStatus(
        id: string,
        userId: string,
        status: 'pending' | 'processing' | 'completed' | 'failed'
    ): Promise<void> {
        this.executionLogger.log('Updating execution status', { executionId: id, userId, status });
        await this.executionDao.updateStatus(id, userId, status);
    }

    // Deletes an execution after verifying ownership.
    public async deleteExecution(id: string, userId: string): Promise<boolean> {
        this.executionLogger.log('Deleting execution', { executionId: id, userId });

        const deletedCount = await this.executionDao.deleteByIdAndUserId(id, userId);

        if (deletedCount > 0) {
            this.executionLogger.logExecutionDeletion(id, userId);
            return true;
        } else {
            throw new Error('Execution not found or user is not the owner.');
        }
    }

    // Retrieves all images associated with an execution.
    public async getExecutionImages(id: string): Promise<Execution | null> {
        return await this.executionDao.findByIdWithImages(id);
    }

    // Retrieves basic info for an execution.
    public async getExecutionBasicInfo(id: string): Promise<Execution | null> {
        return await this.executionDao.findByIdBasicInfo(id);
    }
}