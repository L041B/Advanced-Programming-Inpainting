// Import necessary modules and models
import { Inference } from "../models/Inference";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Define an interface for inference data used in mutations.
interface InferenceMutationData {
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";
    modelId: string;
    parameters?: Record<string, unknown>;
    result?: Record<string, unknown>;
    datasetId: string;  // Torna a datasetId
    userId: string;
}

/** A Data Access Object (DAO) for the Inference model.
 * It abstracts all database interactions for inferences into a clean, reusable, and testable interface.
 * Implemented as a Singleton to ensure a single, shared instance throughout the application.
 */
export class InferenceDao {
    private static instance: InferenceDao;
    private readonly sequelize: Sequelize;
    private readonly errorManager: ErrorManager;
    private readonly inferenceLogger: InferenceRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
        this.errorManager = ErrorManager.getInstance();
        this.inferenceLogger = loggerFactory.createInferenceLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Provides access to the single instance of InferenceDao.
    public static getInstance(): InferenceDao {
        if (!InferenceDao.instance) {
            InferenceDao.instance = new InferenceDao();
        }
        return InferenceDao.instance;
    }

    // Creates a new inference in the database.
    public async create(inferenceData: Omit<InferenceMutationData, "result">): Promise<Inference> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Detailed validation logging before creation
                this.inferenceLogger.log("DAO creating inference", {
                    userId: inferenceData.userId,
                    datasetId: inferenceData.datasetId,
                    modelId: inferenceData.modelId,
                    status: inferenceData.status,
                    hasUserId: !!inferenceData.userId,
                    hasDatasetId: !!inferenceData.datasetId,
                    hasModelId: !!inferenceData.modelId
                });

                // Validate required fields before creation with specific messages
                const missingFields = [];
                if (!inferenceData.userId) missingFields.push("userId");
                if (!inferenceData.datasetId) missingFields.push("datasetId");
                if (!inferenceData.modelId) missingFields.push("modelId");

                if (missingFields.length > 0) {
                    const errorMessage = `Missing required fields for inference creation: ${missingFields.join(", ")}`;
                    this.errorLogger.logValidationError(
                        "inference_data", 
                        `userId: ${inferenceData.userId}, datasetId: ${inferenceData.datasetId}, modelId: ${inferenceData.modelId}`, 
                        errorMessage
                    );
                    throw this.errorManager.createError(ErrorStatus.invalidParametersError, errorMessage);
                }

                // Create the inference with initial status and null result
                const inference = await Inference.create({
                    ...inferenceData,
                    result: null
                }, { transaction: t });

                // Log the creation event with proper dataset info
                this.inferenceLogger.logInferenceCreation(inference.id, inferenceData.userId, inferenceData.datasetId, inferenceData.modelId);
                return inference;
            } catch (error) {
                // If it's already a standardized error, re-throw it
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                
                // Log the specific database error
                const dbError = error as Error;
                this.errorLogger.logDatabaseError("create", "Inference", dbError.message);
                
                // Check for specific database constraint violations
                if (dbError.message.includes("foreign key constraint")) {
                    throw this.errorManager.createError(ErrorStatus.resourceNotFoundError, "Referenced dataset or user not found");
                }
                
                if (dbError.message.includes("unique constraint") || dbError.message.includes("duplicate")) {
                    throw this.errorManager.createError(ErrorStatus.resourceAlreadyPresent, "Inference with these parameters already exists");
                }
                
                throw this.errorManager.createError(ErrorStatus.inferenceCreationFailedError, `Database error: ${dbError.message}`);
            }
        });
    }

    // Updates an existing inference in the database.
    public async update(id: string, inferenceData: Partial<InferenceMutationData>): Promise<Inference> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Find the inference by primary key
                const inference = await Inference.findByPk(id, { transaction: t });
                if (!inference) {
                    this.errorLogger.logDatabaseError("findByPk", "Inference", `Inference not found: ${id}`);
                    throw this.errorManager.createError(ErrorStatus.inferenceNotFoundError);
                }

                // Update the inference with new data
                await inference.update(inferenceData, { transaction: t });
                this.inferenceLogger.logInferenceRetrieval(id, inference.userId);
                return inference;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                this.errorLogger.logDatabaseError("update", "Inference", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.inferenceUpdateFailedError);
            }
        });
    }

    // Updates only the status of an existing inference.
    public async updateStatus(id: string, status: InferenceMutationData["status"], result?: Record<string, unknown>): Promise<void> {
        await this.sequelize.transaction(async (t) => {
            try {
                // Update the inference status and optionally the result
                const [affectedRows] = await Inference.update(
                    { status, ...(result && { result }) },
                    { where: { id }, transaction: t }
                );

                // If no rows were affected, the inference does not exist
                if (affectedRows === 0) {
                    this.errorLogger.logDatabaseError("update", "Inference", `No rows affected for inference: ${id}`);
                    throw this.errorManager.createError(ErrorStatus.inferenceNotFoundError);
                }

                this.inferenceLogger.logJobStatusRetrieved(id, status);
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                this.errorLogger.logDatabaseError("updateStatus", "Inference", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.inferenceUpdateFailedError);
            }
        });
    }

    // Retrieves an inference by its ID.
    public async findById(id: string): Promise<Inference | null> {
        try {
            // Find the inference by primary key
            const inference = await Inference.findByPk(id);
            
            if (inference) {
                this.inferenceLogger.logInferenceRetrieval(id, inference.userId);
            }
            return inference;
        } catch (error) {
            this.errorLogger.logDatabaseError("findById", "Inference", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Retrieves an inference by its ID and associated user ID.
    public async findByIdAndUserId(id: string, userId: string): Promise<Inference | null> {
        try {
            const inference = await Inference.findOne({
                where: { id, userId }
            });
            
            if (inference) {
                this.inferenceLogger.logInferenceRetrieval(id, userId);
            }
            return inference;
        } catch (error) {
            this.errorLogger.logDatabaseError("findByIdAndUserId", "Inference", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Retrieves all inferences associated with a specific user ID.
    public async findAllByUserId(userId: string): Promise<Inference[]> {
        try {
            const inferences = await Inference.findAll({
                where: { userId },
                order: [["createdAt", "DESC"]]
            });
            
            // Log the retrieval of inferences for the user
            this.inferenceLogger.logUserInferencesRetrieval(userId, inferences.length);
            return inferences;
        } catch (error) {
            this.errorLogger.logDatabaseError("findAllByUserId", "Inference", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Retrieves inferences for a user with pagination support.
    public async findByUserIdWithPagination(
        userId: string, 
        limit: number, 
        offset: number
    ): Promise<{ rows: Inference[], count: number }> {
        try {
            const result = await Inference.findAndCountAll({
                where: { userId },
                order: [["createdAt", "DESC"]],
                limit,
                offset,
                attributes: ["id", "status", "modelId", "datasetId", "createdAt", "updatedAt"]
            });
            
            // Log the retrieval of inferences for the user with pagination
            this.inferenceLogger.logUserInferencesRetrieval(userId, result.count);
            return result;
        } catch (error) {
            this.errorLogger.logDatabaseError("findByUserIdWithPagination", "Inference", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
}
