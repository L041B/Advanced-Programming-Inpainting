// Import the Sequelize User model and the User Data Access Object (DAO).
import { Inference } from "../models/Inference";
import { InferenceDao } from "../dao/inferenceDao";
import { loggerFactory, InferenceRouteLogger } from "../factory/loggerFactory";

// Define a simple interface for inference data.
export interface InferenceData {
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
    modelId: string;
    parameters?: Record<string, unknown>;
    datasetId: string; 
    userId: string;
}

// InferenceRepository provides an abstraction layer over InferenceDao for inference-related operations.
export class InferenceRepository {
    private static instance: InferenceRepository;
    private readonly inferenceDao: InferenceDao;
    private readonly inferenceLogger: InferenceRouteLogger;

    private constructor() {
        this.inferenceDao = InferenceDao.getInstance();
        this.inferenceLogger = loggerFactory.createInferenceLogger();
    }

    public static getInstance(): InferenceRepository {
        if (!InferenceRepository.instance) {
            InferenceRepository.instance = new InferenceRepository();
        }
        return InferenceRepository.instance;
    }

    // Creates a new inference in the database.
    public async createInference(data: Omit<InferenceData, "status">): Promise<Inference> {
        try {
            this.inferenceLogger.log("Repository creating inference", { 
                userId: data.userId, 
                datasetId: data.datasetId, 
                modelId: data.modelId,
                hasDatasetId: !!data.datasetId,
                hasUserId: !!data.userId,
                hasModelId: !!data.modelId
            });
            
            // Validate required fields before passing to DAO
            if (!data.userId || !data.datasetId || !data.modelId) {
                this.inferenceLogger.log("Repository validation failed", { 
                    userId: data.userId, 
                    datasetId: data.datasetId, 
                    modelId: data.modelId,
                    error: "Missing required fields in repository" 
                });
                throw new Error(`Repository validation failed: Missing userId (${!!data.userId}), datasetId (${!!data.datasetId}), or modelId (${!!data.modelId})`);
            }
            
            const inference = await this.inferenceDao.create({
                ...data,
                status: "PENDING"
            });
            
            this.inferenceLogger.log("Repository inference created successfully", { 
                inferenceId: inference.id, 
                userId: data.userId 
            });
            
            return inference;
        } catch (error) {
            // Let DAO errors bubble up with proper logging
            const err = error as Error & { errorType?: string };
            this.inferenceLogger.log("Repository inference creation failed", { 
                userId: data.userId, 
                datasetId: data.datasetId,
                error: err.message, 
                errorType: err.errorType 
            });
            throw error;
        }
    }

    // Retrieves an inference by its ID
    public async getInferenceById(id: string): Promise<Inference | null> {
        return await this.inferenceDao.findById(id);
    }

    // Retrieves an inference by its ID and associated user ID
    public async getInferenceByIdAndUserId(id: string, userId: string): Promise<Inference | null> {
        return await this.inferenceDao.findByIdAndUserId(id, userId);
    }

    // Retrieves all inferences for a given user
    public async getUserInferences(userId: string): Promise<Inference[]> {
        return await this.inferenceDao.findAllByUserId(userId);
    }

    // Retrieves inferences for a user with pagination support
    public async getUserInferencesWithPagination(
        userId: string,
        limit: number,
        offset: number
    ): Promise<{ rows: Inference[], count: number }> {
        return await this.inferenceDao.findByUserIdWithPagination(userId, limit, offset);
    }

    // Updates the status of an inference
    public async updateInferenceStatus(
        id: string,
        status: InferenceData["status"],
        result?: Record<string, unknown>
    ): Promise<void> {
        // DAO handles logging and errors now, just pass through
        return await this.inferenceDao.updateStatus(id, status, result);
    }

    // Updates an existing inference in the database.
    public async updateInference(id: string, data: Partial<InferenceData>): Promise<Inference> {
        // DAO handles logging and errors now, just pass through
        return await this.inferenceDao.update(id, data);
    }
}

