// Import the Sequelize User model and the User Data Access Object (DAO).
import { Dataset } from "../models/Dataset";
import { DatasetDao } from "../dao/datasetDao";
import { loggerFactory } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import type { DatasetData } from "../controllers/datasetController";
 
export interface DatasetFilters {
    userId?: string;
    name?: string;
    type?: string;
    includeDeleted?: boolean;
}
 
// DatasetRepository provides an abstraction layer over DatasetDao for dataset-related operations.
export class DatasetRepository {
    private static instance: DatasetRepository;
    private readonly datasetDao: DatasetDao;
    private readonly datasetLogger = loggerFactory.createDatasetLogger();
    private readonly errorManager = ErrorManager.getInstance();
 
    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.datasetDao = DatasetDao.getInstance();
    }
 
    // Get the singleton instance of DatasetRepository.
    public static getInstance(): DatasetRepository {
        if (!DatasetRepository.instance) {
            DatasetRepository.instance = new DatasetRepository();
        }
        return DatasetRepository.instance;
    }
 
    // Creates a new dataset in the database
    public async createDataset(data: DatasetData): Promise<Dataset> {
        return await this.datasetDao.create({
            ...data,
            data: data.data !== undefined ? data.data : null,
            tags: data.tags ?? []
        });
    }
 
    // Retrieves a dataset by userId and name.
    public async getDatasetByUserIdAndName(userId: string, name: string): Promise<Dataset | null> {
        // DAO handles logging and errors now, just pass through
        return await this.datasetDao.findByUserIdAndName(userId, name);
    }
 
    // Retrieves all datasets for a given user.
    public async getUserDatasets(userId: string): Promise<Dataset[]> {
        // DAO handles logging and errors now, just pass through
        return await this.datasetDao.findAllByUserId(userId);
    }
 
    // Retrieves datasets for a user with pagination support.
    public async getUserDatasetsWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Dataset[], count: number }> {
        // DAO handles logging and errors now, just pass through
        return await this.datasetDao.findByUserIdAndNameWithPagination(userId, limit, offset);
    }
 
    // Updates an existing dataset for a user by name.
    public async updateDataset(userId: string, name: string, data: Partial<DatasetData>): Promise<Dataset> {
        // Log business intent before DAO call
        this.datasetLogger.logRepositoryOperation("update_intent", userId, name);

        // DAO handles the database operation
        const updatedDataset = await this.datasetDao.update(userId, name, data);
        
        // Log successful completion
        this.datasetLogger.logDatasetUpdate(userId, updatedDataset.name);
        
        return updatedDataset;
    }
 
    // Deletes a dataset for a user by name.
    public async deleteDataset(userId: string, name: string): Promise<boolean> {
        // DAO handles logging and errors now, just pass through
        return await this.datasetDao.delete(userId, name);
    }
 
    // Checks if a dataset exists for a given user by name.
    public async datasetExists(userId: string, name: string): Promise<boolean> {
        return await this.datasetDao.exists(userId, name);
    }
 
    // Soft deletes all datasets for a given user (marks them as deleted without removing).
    public async softDeleteAllUserDatasets(userId: string): Promise<number> {
        // Log business intent - this is a cascade operation from user deletion
        this.datasetLogger.logRepositoryOperation("cascade_delete_intent", userId);
        return await this.datasetDao.softDeleteAllByUserId(userId);
    }
 
    // Retrieves all datasets for a user, including those marked as deleted.
    public async getAllUserDatasetsIncludingDeleted(userId: string): Promise<Dataset[]> {
        return await this.datasetDao.findAllByUserIdIncludingDeleted(userId);
    }
 
    // Retrieves a dataset by its ID.
    public async getDatasetById(datasetId: string): Promise<Dataset | null> {
        return await this.datasetDao.findById(datasetId);
    }
 
    // Updates a dataset by its ID. This method requires business logic to first find the dataset.
    public async updateDatasetById(datasetId: string, data: Partial<DatasetData>): Promise<Dataset> {
        // This method requires business logic 
        const existingDataset = await this.datasetDao.findById(datasetId);
        if (!existingDataset?.userId || !existingDataset?.name) {
            // Log business logic decision
            this.datasetLogger.logRepositoryOperation("update_by_id_failed", "system", datasetId);
            throw this.errorManager.createError(ErrorStatus.datasetNotFoundError, "Dataset not found or missing userId/name");
        }
 
        // Log business intent
        this.datasetLogger.logRepositoryOperation("update_by_id_intent", existingDataset.userId, existingDataset.name);
        return await this.datasetDao.update(existingDataset.userId, existingDataset.name, data);
    }
 
    // Deletes a dataset by its ID. This method requires business logic to first find the dataset.
    public async deleteDatasetById(datasetId: string): Promise<boolean> {
        // This method requires business logic - need to find dataset first
        const dataset = await this.datasetDao.findById(datasetId);
        if (!(dataset?.userId && dataset?.name)) {
            // Log business logic decision
            this.datasetLogger.logRepositoryOperation("delete_by_id_failed", "system", datasetId);
            return false;
        }
 
        // Log business intent
        this.datasetLogger.logRepositoryOperation("delete_by_id_intent", dataset.userId, dataset.name);
        return await this.datasetDao.delete(dataset.userId, dataset.name);
    }
 
    // Finds datasets with user information, applying the given filters and pagination.
    public async findDatasetsWithUsers(
        filters: DatasetFilters,
        pagination: { limit: number; offset: number }
    ): Promise<{ rows: Dataset[]; count: number }> {
        return await this.datasetDao.findWithUsers(filters, pagination);
    }
}
