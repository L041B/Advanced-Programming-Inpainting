import { Dataset } from "../models/Dataset";
import { DatasetDao } from "../dao/datasetDao";
import { loggerFactory, DatasetRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

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
    private readonly datasetLogger: DatasetRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.datasetDao = DatasetDao.getInstance();
        this.datasetLogger = loggerFactory.createDatasetLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    public static getInstance(): DatasetRepository {
        if (!DatasetRepository.instance) {
            DatasetRepository.instance = new DatasetRepository();
        }
        return DatasetRepository.instance;
    }

    public async createDataset(data: DatasetData): Promise<Dataset> {
        this.datasetLogger.logRepositoryOperation("CREATE_DATASET", data.userId, data.name);

        try {
            const newDataset = await this.datasetDao.create({
                ...data,
                data: data.data !== undefined ? data.data : null,
                tags: data.tags !== undefined ? data.tags : []
            });
            return newDataset;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("CREATE_DATASET", "datasets", err.message);
            throw error;
        }
    }

    public async getDatasetByUserIdAndName(userId: string, name: string): Promise<Dataset | null> {
        this.datasetLogger.logRepositoryOperation("GET_DATASET", userId, name);

        try {
            const dataset = await this.datasetDao.findByUserIdAndName(userId, name);
            return dataset;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_DATASET", "datasets", err.message);
            throw error;
        }
    }

    public async getUserDatasets(userId: string): Promise<Dataset[]> {
        this.datasetLogger.logRepositoryOperation("GET_USER_DATASETS", userId);

        try {
            const datasets = await this.datasetDao.findAllByUserId(userId);
            return datasets;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_USER_DATASETS", "datasets", err.message);
            throw error;
        }
    }

    public async getUserDatasetsWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Dataset[], count: number }> {
        this.datasetLogger.logRepositoryOperation("GET_USER_DATASETS_PAGINATED", userId);

        try {
            const result = await this.datasetDao.findByUserIdAndNameWithPagination(userId, limit, offset);
            this.datasetLogger.logUserDatasetsRetrieval(userId, result.count);
            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_USER_DATASETS_PAGINATED", "datasets", err.message);
            throw error;
        }
    }

    public async updateDataset(userId: string, name: string, data: Partial<DatasetData>): Promise<Dataset> {
        this.datasetLogger.logRepositoryOperation("UPDATE_DATASET", userId, name);

        try {
            const dataset = await this.datasetDao.update(userId, name, data);
            return dataset;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("UPDATE_DATASET", "datasets", err.message);
            throw error;
        }
    }

    public async deleteDataset(userId: string, name: string): Promise<boolean> {
        this.datasetLogger.logRepositoryOperation("DELETE_DATASET", userId, name);

        try {
            const success = await this.datasetDao.delete(userId, name);
            if (success) {
                // Remove duplicate logging - controller already logs deletion
            } else {
                this.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", "Dataset not found");
            }
            return success;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", err.message);
            throw error;
        }
    }

    public async datasetExists(userId: string, name: string): Promise<boolean> {
        try {
            return await this.datasetDao.exists(userId, name);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("CHECK_DATASET_EXISTS", "datasets", err.message);
            throw error;
        }
    }

    // Soft delete tutti i dataset di un utente (per quando l'utente viene eliminato)
    public async softDeleteAllUserDatasets(userId: string): Promise<number> {
        try {
            return await this.datasetDao.softDeleteAllByUserId(userId);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            throw new Error(`Failed to soft delete user datasets: ${err.message}`);
        }
    }

    // Ottieni tutti i dataset dell'utente INCLUSI quelli eliminati (con flag isDeleted)
    public async getAllUserDatasetsIncludingDeleted(userId: string): Promise<Dataset[]> {
        try {
            return await this.datasetDao.findAllByUserIdIncludingDeleted(userId);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            throw new Error(`Failed to get all user datasets: ${err.message}`);
        }
    }

    public async getDatasetById(datasetId: string): Promise<Dataset | null> {
        this.datasetLogger.logRepositoryOperation("GET_DATASET_BY_ID", "system", datasetId);

        try {
            const dataset = await this.datasetDao.findById(datasetId);
            return dataset;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_DATASET_BY_ID", "datasets", err.message);
            throw error;
        }
    }

    public async updateDatasetById(datasetId: string, data: Partial<DatasetData>): Promise<Dataset> {
        this.datasetLogger.logRepositoryOperation("UPDATE_DATASET_BY_ID", "system", datasetId);

        try {
            const existingDataset = await this.datasetDao.findById(datasetId);
            if (!existingDataset || !existingDataset.userId || !existingDataset.name) {
                throw new Error("Dataset not found or missing userId/name");
            }
            const dataset = await this.datasetDao.update(existingDataset.userId, existingDataset.name, data);
            return dataset;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("UPDATE_DATASET_BY_ID", "datasets", err.message);
            throw error;
        }
    }

    public async deleteDatasetById(datasetId: string): Promise<boolean> {
        this.datasetLogger.logRepositoryOperation("DELETE_DATASET_BY_ID", "system", datasetId);

        try {
            const dataset = await this.datasetDao.findById(datasetId);
            if (!dataset || !dataset.userId || !dataset.name) {
                this.errorLogger.logDatabaseError("DELETE_DATASET_BY_ID", "datasets", "Dataset not found or missing userId/name");
                return false;
            }
            const success = await this.datasetDao.delete(dataset.userId, dataset.name);
            return success;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("DELETE_DATASET_BY_ID", "datasets", err.message);
            throw error;
        }
    }
}

