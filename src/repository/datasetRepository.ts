import { Dataset } from "../models/Dataset";
import { DatasetDao } from "../dao/datasetDao";
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

export interface DatasetData {
    userId: string;
    name: string;
    data?: object | null;
    tags?: string[];
    nextUploadIndex?: number;
}

export class DatasetRepository {
    private static instance: DatasetRepository;
    private readonly datasetDao: DatasetDao;
    private readonly userLogger: UserRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.datasetDao = DatasetDao.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    public static getInstance(): DatasetRepository {
        if (!DatasetRepository.instance) {
            DatasetRepository.instance = new DatasetRepository();
        }
        return DatasetRepository.instance;
    }

    public async createDataset(data: DatasetData): Promise<Dataset> {
        this.userLogger.log("Creating new dataset", {
            userId: data.userId,
            datasetName: data.name,
            operation: "CREATE_DATASET"
        });

        try {
            const newDataset = await this.datasetDao.create({
                ...data,
                data: data.data !== undefined ? data.data : null,
                tags: data.tags !== undefined ? data.tags : []
            });
            this.userLogger.log("Dataset created successfully", {
                userId: data.userId,
                datasetName: data.name,
                datasetId: `${data.userId}-${data.name}`
            });
            return newDataset;
        } catch (error) {
            this.errorLogger.logDatabaseError("CREATE_DATASET", "datasets", (error as Error).message);
            throw error;
        }
    }

    public async getDatasetByUserIdAndName(userId: string, name: string): Promise<Dataset | null> {
        this.userLogger.log("Retrieving dataset by user ID and name", {
            userId,
            datasetName: name,
            operation: "GET_DATASET"
        });

        try {
            return await this.datasetDao.findByUserIdAndName(userId, name);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_DATASET", "datasets", (error as Error).message);
            throw error;
        }
    }

    public async getUserDatasets(userId: string): Promise<Dataset[]> {
        this.userLogger.log("Retrieving all user datasets", {
            userId,
            operation: "GET_USER_DATASETS"
        });

        try {
            return await this.datasetDao.findAllByUserId(userId);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_USER_DATASETS", "datasets", (error as Error).message);
            throw error;
        }
    }

    public async getUserDatasetsWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Dataset[], count: number }> {
        this.userLogger.log("Retrieving user datasets with pagination", {
            userId,
            limit,
            offset,
            operation: "GET_USER_DATASETS_PAGINATED"
        });

        try {
            return await this.datasetDao.findByUserIdAndNameWithPagination(userId, limit, offset);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_USER_DATASETS_PAGINATED", "datasets", (error as Error).message);
            throw error;
        }
    }

    public async updateDataset(userId: string, name: string, data: Partial<DatasetData>): Promise<Dataset> {
        this.userLogger.log("Updating dataset", {
            userId,
            datasetName: name,
            operation: "UPDATE_DATASET",
            updateFields: Object.keys(data)
        });

        try {
            const dataset = await this.datasetDao.update(userId, name, data);
            this.userLogger.log("Dataset updated successfully", {
                userId,
                datasetName: name,
                updatedFields: Object.keys(data)
            });
            return dataset;
        } catch (error) {
            this.errorLogger.logDatabaseError("UPDATE_DATASET", "datasets", (error as Error).message);
            throw error;
        }
    }

    public async deleteDataset(userId: string, name: string): Promise<boolean> {
        this.userLogger.log("Deleting dataset", {
            userId,
            datasetName: name,
            operation: "DELETE_DATASET"
        });

        try {
            const success = await this.datasetDao.delete(userId, name);
            if (success) {
                this.userLogger.log("Dataset deleted successfully", {
                    userId,
                    datasetName: name
                });
            } else {
                this.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", "Dataset not found");
            }
            return success;
        } catch (error) {
            this.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", (error as Error).message);
            throw error;
        }
    }

    public async datasetExists(userId: string, name: string): Promise<boolean> {
        return await this.datasetDao.exists(userId, name);
    }
}
