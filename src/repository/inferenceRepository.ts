import { Inference } from "../models/Inference";
import { InferenceDao } from "../dao/inferenceDao";
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

export interface InferenceData {
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
    modelId: string;
    parameters?: Record<string, unknown>;
    datasetName: string;
    userId: string;
}

export class InferenceRepository {
    private static instance: InferenceRepository;
    private readonly inferenceDao: InferenceDao;
    private readonly userLogger: UserRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.inferenceDao = InferenceDao.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    public static getInstance(): InferenceRepository {
        if (!InferenceRepository.instance) {
            InferenceRepository.instance = new InferenceRepository();
        }
        return InferenceRepository.instance;
    }

    public async createInference(data: Omit<InferenceData, "status">): Promise<Inference> {
        this.userLogger.log("Creating new inference", {
            userId: data.userId,
            datasetName: data.datasetName,
            modelId: data.modelId,
            operation: "CREATE_INFERENCE"
        });

        try {
            const newInference = await this.inferenceDao.create({
                ...data,
                status: "PENDING"
            });
            this.userLogger.log("Inference created successfully", {
                userId: data.userId,
                inferenceId: newInference.id,
                datasetName: data.datasetName
            });
            return newInference;
        } catch (error) {
            this.errorLogger.logDatabaseError("CREATE_INFERENCE", "inferences", (error as Error).message);
            throw error;
        }
    }

    public async getInferenceById(id: string): Promise<Inference | null> {
        this.userLogger.log("Retrieving inference by ID", {
            inferenceId: id,
            operation: "GET_INFERENCE_BY_ID"
        });

        try {
            return await this.inferenceDao.findById(id);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_INFERENCE_BY_ID", "inferences", (error as Error).message);
            throw error;
        }
    }

    public async getInferenceByIdAndUserId(id: string, userId: string): Promise<Inference | null> {
        this.userLogger.log("Retrieving inference by ID and user ID", {
            inferenceId: id,
            userId,
            operation: "GET_INFERENCE_BY_ID_AND_USER"
        });

        try {
            return await this.inferenceDao.findByIdAndUserId(id, userId);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_INFERENCE_BY_ID_AND_USER", "inferences", (error as Error).message);
            throw error;
        }
    }

    public async getUserInferences(userId: string): Promise<Inference[]> {
        this.userLogger.log("Retrieving all user inferences", {
            userId,
            operation: "GET_USER_INFERENCES"
        });

        try {
            return await this.inferenceDao.findAllByUserId(userId);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_USER_INFERENCES", "inferences", (error as Error).message);
            throw error;
        }
    }

    public async getUserInferencesWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Inference[], count: number }> {
        this.userLogger.log("Retrieving user inferences with pagination", {
            userId,
            limit,
            offset,
            operation: "GET_USER_INFERENCES_PAGINATED"
        });

        try {
            return await this.inferenceDao.findByUserIdWithPagination(userId, limit, offset);
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_USER_INFERENCES_PAGINATED", "inferences", (error as Error).message);
            throw error;
        }
    }

    public async updateInferenceStatus(
        id: string,
        status: InferenceData["status"],
        result?: Record<string, unknown>
    ): Promise<void> {
        this.userLogger.log("Updating inference status", {
            inferenceId: id,
            newStatus: status,
            operation: "UPDATE_INFERENCE_STATUS"
        });

        try {
            await this.inferenceDao.updateStatus(id, status, result);
            this.userLogger.log("Inference status updated successfully", {
                inferenceId: id,
                status
            });
        } catch (error) {
            this.errorLogger.logDatabaseError("UPDATE_INFERENCE_STATUS", "inferences", (error as Error).message);
            throw error;
        }
    }

    public async updateInference(id: string, data: Partial<InferenceData>): Promise<Inference> {
        this.userLogger.log("Updating inference", {
            inferenceId: id,
            operation: "UPDATE_INFERENCE"
        });

        try {
            const inference = await this.inferenceDao.update(id, data);
            this.userLogger.log("Inference updated successfully", {
                inferenceId: id,
                updatedFields: Object.keys(data)
            });
            return inference;
        } catch (error) {
            this.errorLogger.logDatabaseError("UPDATE_INFERENCE", "inferences", (error as Error).message);
            throw error;
        }
    }
}
