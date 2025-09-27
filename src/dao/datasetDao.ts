// Import necessary modules and models
import { Dataset } from "../models/Dataset";
import { User } from "../models/User";
import { Sequelize, Op } from "sequelize";
import { DbConnection } from "../config/database";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, DatasetRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Define filters for dataset queries
export interface DatasetFilters {
    userId?: string;
    name?: string;
    includeDeleted?: boolean;
}

// Define pagination options
export interface PaginationOptions {
    limit: number;
    offset: number;
}
 
// Define an interface for dataset data used in mutations.
interface DatasetMutationData {
    userId: string;
    name: string;
    data?: object | null;
    tags?: string[];
    isDeleted?: boolean;
    nextUploadIndex?: number;
}
 
/**  A Data Access Object (DAO) for the Dataset model.
 * It abstracts all database interactions for datasets into a clean, reusable, and testable interface.
 * Implemented as a Singleton to ensure a single, shared instance throughout the application.
 */
export class DatasetDao {
    private static instance: DatasetDao;
    private readonly sequelize: Sequelize;
    private readonly errorManager: ErrorManager;
    private readonly datasetLogger: DatasetRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;
 
    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
        this.errorManager = ErrorManager.getInstance();
        this.datasetLogger = loggerFactory.createDatasetLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }
 
    // Provides access to the single instance of DatasetDao.
    public static getInstance(): DatasetDao {
        if (!DatasetDao.instance) {
            DatasetDao.instance = new DatasetDao();
        }
        return DatasetDao.instance;
    }
 
    // Creates a new dataset in the database.
    public async create(datasetData: Required<Omit<DatasetMutationData, "isDeleted" | "nextUploadIndex">>): Promise<Dataset> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Check for existing dataset only for the SAME user (not globally)
                if (datasetData.userId) {
                    const existingDataset = await Dataset.findOne({
                        where: {
                            userId: datasetData.userId,  
                            name: datasetData.name,
                            isDeleted: false
                        },
                        transaction: t
                    });
                   
                    // If a dataset with the same name exists for this user, throw an error
                    if (existingDataset) {
                        this.errorLogger.logValidationError("name", datasetData.name, "Dataset with this name already exists");
                        throw this.errorManager.createError(ErrorStatus.datasetAlreadyExistsError);
                    }
                }
 
                // Force default values for isDeleted and nextUploadIndex
                const dataset = await Dataset.create({
                    ...datasetData,
                    isDeleted: false,
                    nextUploadIndex: 1
                }, { transaction: t });
 
                this.datasetLogger.logDatasetCreation(datasetData.userId, datasetData.name);
                return dataset;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                this.errorLogger.logDatabaseError("create", "Dataset", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.datasetCreationFailedError);
            }
        });
    }
 
    // Updates an existing dataset's data.
    public async update(userId: string, name: string, datasetData: Partial<DatasetMutationData>): Promise<Dataset> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Find the dataset by userId and name to ensure correct ownership
                const dataset = await Dataset.findOne({
                    where: {
                        userId,  
                        name,
                        isDeleted: false
                    },
                    transaction: t
                });
               
                // If the dataset does not exist, throw an error
                if (!dataset) {
                    this.errorLogger.logDatabaseError("findOne", "Dataset", `Dataset not found: userId=${userId}, name=${name}`);
                    throw this.errorManager.createError(ErrorStatus.datasetNotFoundError);
                }
 
 
                // Perform the update
                const [affectedRows] = await Dataset.update(datasetData, {
                    where: {
                        id: dataset.id
                    },
                    transaction: t
                });
 
                // If no rows were affected, something went wrong
                if (affectedRows === 0) {
                    this.errorLogger.logDatabaseError("update", "Dataset", `No rows affected for dataset: ${dataset.id}`);
                    throw this.errorManager.createError(ErrorStatus.datasetUpdateFailedError);
                }
 
                // Reload the updated dataset to return fresh data
                const updatedDataset = await Dataset.findByPk(dataset.id, { transaction: t });
               
                // This should never happen, but just in case
                if (!updatedDataset) {
                    this.errorLogger.logDatabaseError("findByPk", "Dataset", `Dataset disappeared after update: ${dataset.id}`);
                    throw this.errorManager.createError(ErrorStatus.datasetUpdateFailedError);
                }
 
                return updatedDataset;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                this.errorLogger.logDatabaseError("update", "Dataset", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.datasetUpdateFailedError);
            }
        });
    }
 
    // Soft delete a dataset by setting its isDeleted flag to true.
    public async delete(userId: string, name: string): Promise<boolean> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Find the dataset by userId and name to ensure correct ownership
                const [affectedCount] = await Dataset.update(
                    { 
                        isDeleted: true,
                        deletedAt: new Date() 
                    },
                    {
                        where: {
                            userId,
                            name,
                            isDeleted: false
                        },
                        transaction: t
                    }
                );
 
                // Log the deletion attempt
                if (affectedCount > 0) {
                    this.datasetLogger.logDatasetDeletion(userId, name);
                    return true;
                } else {
                    this.datasetLogger.logRepositoryOperation("delete_not_found", userId, name);
                    return false;
                }
            } catch (error) {
                this.errorLogger.logDatabaseError("delete", "Dataset", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.datasetDeletionFailedError);
            }
        });
    }
 
    // Soft delete all datasets for a specific user
    public async softDeleteAllByUserId(userId: string): Promise<number> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Mark as deleted only those datasets that are NOT already deleted
                const [affectedCount] = await Dataset.update(
                    { 
                        isDeleted: true,
                        deletedAt: new Date() 
                    },
                    {
                        where: {
                            userId,
                            isDeleted: false
                        },
                        transaction: t
                    }
                );
               
                // Log the bulk deletion operation
                this.datasetLogger.logRepositoryOperation("soft_delete_all", userId);
                return affectedCount;
            } catch (error) {
                this.errorLogger.logDatabaseError("softDeleteAll", "Dataset", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.datasetDeletionFailedError);
            }
        });
    }
 
    // Find all datasets for a user, including deleted ones
    public async findAllByUserIdIncludingDeleted(userId: string): Promise<Dataset[]> {
        try {
            // Retrieve all datasets regardless of deletion status
            const datasets = await Dataset.findAll({
                where: { userId },
                order: [["createdAt", "DESC"]]
            });
           
            // Log the retrieval operation
            this.datasetLogger.logUserDatasetsRetrieval(userId, datasets.length);
            return datasets;
        } catch (error) {
            this.errorLogger.logDatabaseError("findAllIncludingDeleted", "Dataset", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Find all datasets for a user, including deleted ones
    public async findAllByUserId(userId: string): Promise<Dataset[]> {
        try {
            // Retrieve only non-deleted datasets
            const datasets = await Dataset.findAll({
                where: {
                    userId,
                    isDeleted: false 
                },
                order: [["createdAt", "DESC"]]
            });
           
            // Log the retrieval operation
            this.datasetLogger.logUserDatasetsRetrieval(userId, datasets.length);
            return datasets;
        } catch (error) {
            this.errorLogger.logDatabaseError("findAllByUserId", "Dataset", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Find dataset by ID, allowing null userId for orphaned datasets
    public async findById(datasetId: string): Promise<Dataset | null> {
        try {
            // Find the dataset by its primary key, ensuring it's not deleted
            const dataset = await Dataset.findOne({
                where: { id: datasetId, isDeleted: false }
            });
           
            // Log the retrieval operation
            if (dataset) {
                this.datasetLogger.logDatasetRetrieval(dataset.userId || "unknown", dataset.name);
            }
            return dataset;
        } catch (error) {
            this.errorLogger.logDatabaseError("findById", "Dataset", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Find dataset by userId and name
    public async findByUserIdAndName(userId: string, name: string): Promise<Dataset | null> {
        try {
            // Find the dataset by userId and name, ensuring it's not deleted
            const dataset = await Dataset.findOne({
                where: {
                    userId,
                    name,
                    isDeleted: false
                }
            });
           
            // Log the retrieval operation
            if (dataset) {
                this.datasetLogger.logDatasetRetrieval(userId, name);
            }
            return dataset;
        } catch (error) {
            this.errorLogger.logDatabaseError("findByUserIdAndName", "Dataset", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    // Find datasets for a user with pagination
    public async findByUserIdAndNameWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Dataset[], count: number }> {
        return await Dataset.findAndCountAll({
            where: { userId, isDeleted: false },
            order: [["createdAt", "DESC"]],
            limit,
            offset
        });
    }
 
    // Check if a dataset exists by userId and name
    public async exists(userId: string, name: string): Promise<boolean> {
        try {
            // Check for existence of a dataset by userId and name, ensuring it's not deleted
            const dataset = await Dataset.findOne({
                where: {
                    userId,
                    name,
                    isDeleted: false
                },
                attributes: ["id"]
            });
            return !!dataset;
        } catch (error) {
            this.errorLogger.logDatabaseError("exists", "Dataset", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
 
    public async findWithUsers(
        filters: DatasetFilters,
        pagination: PaginationOptions
    ): Promise<{ rows: Dataset[]; count: number }> {
        try {
            const whereConditions: Record<string, unknown> = {};
           
            if (!filters.includeDeleted) {
                whereConditions.isDeleted = false;
            }
           
            if (filters.userId) {
                whereConditions.userId = filters.userId;
            }
            if (filters.name) {
                whereConditions.name = { [Op.iLike]: `%${filters.name}%` };
            }
 
            return await Dataset.findAndCountAll({
                where: whereConditions,
                include: [
                    {
                        model: User,
                        as: "user",
                        attributes: ["id", "name", "surname", "email", "tokens", "role"],
                        required: false
                    }
                ],
                order: [["createdAt", "DESC"]],
                limit: pagination.limit,
                offset: pagination.offset,
                distinct: true
            });
        } catch (error) {
            this.errorLogger.logDatabaseError("findWithUsers", "Dataset", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
}

