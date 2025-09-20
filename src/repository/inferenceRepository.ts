import { Inference } from "../models/Inference";
import { InferenceDao } from "../dao/inferenceDao";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

export interface InferenceData {
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
    modelId: string;
    parameters?: Record<string, unknown>;
    datasetId: string; // Changed from datasetName to datasetId
    userId: string;
}

export class InferenceRepository {
    private static instance: InferenceRepository;
    private readonly inferenceDao: InferenceDao;
    private readonly inferenceLogger: InferenceRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.inferenceDao = InferenceDao.getInstance();
        this.inferenceLogger = loggerFactory.createInferenceLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    public static getInstance(): InferenceRepository {
        if (!InferenceRepository.instance) {
            InferenceRepository.instance = new InferenceRepository();
        }
        return InferenceRepository.instance;
    }

    public async createInference(data: Omit<InferenceData, "status">): Promise<Inference> {
        this.inferenceLogger.log("Creating new inference", {
            userId: data.userId,
            datasetId: data.datasetId,
            modelId: data.modelId
        });

        try {
            const newInference = await this.inferenceDao.create({
                ...data,
                status: "PENDING"
            });
            return newInference;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("CREATE_INFERENCE", "inferences", err.message);
            throw error;
        }
    }

    public async getInferenceById(id: string): Promise<Inference | null> {
        try {
            return await this.inferenceDao.findById(id);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_INFERENCE_BY_ID", "inferences", err.message);
            throw error;
        }
    }

    public async getInferenceByIdAndUserId(id: string, userId: string): Promise<Inference | null> {
        try {
            const inference = await this.inferenceDao.findByIdAndUserId(id, userId);
            return inference;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_INFERENCE_BY_ID_AND_USER", "inferences", err.message);
            throw error;
        }
    }

    public async getUserInferences(userId: string): Promise<Inference[]> {
        this.inferenceLogger.log("Retrieving all user inferences", { userId });

        try {
            const inferences = await this.inferenceDao.findAllByUserId(userId);
            return inferences;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_USER_INFERENCES", "inferences", err.message);
            throw error;
        }
    }

    public async getUserInferencesWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Inference[], count: number }> {
        try {
            const result = await this.inferenceDao.findByUserIdWithPagination(userId, limit, offset);
            return result;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_USER_INFERENCES_PAGINATED", "inferences", err.message);
            throw error;
        }
    }

    public async updateInferenceStatus(
        id: string,
        status: InferenceData["status"],
        result?: Record<string, unknown>
    ): Promise<void> {
        this.inferenceLogger.log("Updating inference status", { inferenceId: id, newStatus: status });

        try {
            await this.inferenceDao.updateStatus(id, status, result);
            this.inferenceLogger.log("Inference status updated successfully", { inferenceId: id, status });
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("UPDATE_INFERENCE_STATUS", "inferences", err.message);
            throw error;
        }
    }

    public async updateInference(id: string, data: Partial<InferenceData>): Promise<Inference> {
        this.inferenceLogger.log("Updating inference", { inferenceId: id });

        try {
            const inference = await this.inferenceDao.update(id, data);
            this.inferenceLogger.log("Inference updated successfully", { inferenceId: id });
            return inference;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("UPDATE_INFERENCE", "inferences", err.message);
            throw error;
        }
    }
}
      
