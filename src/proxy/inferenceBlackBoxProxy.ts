// import necessary modules and types
import { InferenceQueue } from "../queue/inferenceQueue";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

/** Proxy class to abstract and manage interactions with the InferenceQueue.
 *  Provides a clean interface for queuing inference jobs and retrieving their status,
 *  while handling validation and error management internally.
 */
export class InferenceBlackBoxProxy {
    private static instance: InferenceBlackBoxProxy;
    private readonly inferenceQueue: InferenceQueue;
    private readonly errorManager: ErrorManager;
    private readonly inferenceLogger: InferenceRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.inferenceQueue = InferenceQueue.getInstance();
        this.errorManager = ErrorManager.getInstance();
        this.inferenceLogger = loggerFactory.createInferenceLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Provides access to the single instance of InferenceBlackBoxProxy.
    public static getInstance(): InferenceBlackBoxProxy {
        if (!InferenceBlackBoxProxy.instance) {
            InferenceBlackBoxProxy.instance = new InferenceBlackBoxProxy();
        }
        return InferenceBlackBoxProxy.instance;
    }

    // Queues a new inference job and returns the job ID.
    public async processDataset(
        inferenceId: string,
        userId: string,
        datasetData: Record<string, unknown>,
        parameters: Record<string, unknown>
    ): Promise<string> { 
        try {
            this.inferenceLogger.log("Queuing inference job", { inferenceId, userId });

            // Validate input data before queuing
            this.validateJobData(datasetData, parameters);

            // Add job to queue 
            const job = await this.inferenceQueue.addInferenceJob({
                inferenceId,
                userId,
                datasetData,
                parameters
            });

            // Ensure job ID is available
            const jobId = job.id?.toString();
            if (!jobId) {
                this.errorLogger.logDatabaseError("QUEUE_INFERENCE_JOB", "inference_queue", "Failed to get job ID after queuing");
                throw this.errorManager.createError(ErrorStatus.jobAdditionFailedError, "Failed to get job ID after queuing.");
            }

            return jobId;

        } catch (error) {
            // Handle standardized errors 
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Handle any other unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("QUEUE_INFERENCE_JOB", "inference_queue", err.message);
            throw this.errorManager.createError(ErrorStatus.jobAdditionFailedError, err.message);
        }
    }

    // Retrieves the status of a queued inference job by its ID.
    public async getJobStatus(jobId: string): Promise<{
        status: string;
        progress?: number;
        result?: unknown;
        error?: string;
    }> {
        const jobStatus = await this.inferenceQueue.getJobStatus(jobId);
        
        this.inferenceLogger.logInferenceStatusCheck(jobId);
        return jobStatus;
    }

    // Validates the dataset and parameters for the inference job.
    private validateJobData(datasetData: Record<string, unknown>, parameters: Record<string, unknown>): void {
        // Validate dataset data structure
        if (!datasetData || typeof datasetData !== "object") {
            this.errorLogger.logValidationError("datasetData", "object", "Invalid dataset data");
            throw this.errorManager.createError(ErrorStatus.invalidDatasetDataError);
        }

        // Check for 'pairs' array in datasetData
        const data = datasetData as { pairs?: Array<{ imagePath: string; maskPath: string }> };
        if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
            this.errorLogger.logValidationError("datasetPairs", data.pairs?.length?.toString() || "0", "Dataset contains no valid pairs");
            throw this.errorManager.createError(ErrorStatus.emptyDatasetError);
        }

        // Validate parameters
        if (parameters && typeof parameters !== "object") {
            this.errorLogger.logValidationError("parameters", typeof parameters, "Invalid parameters format");
            throw this.errorManager.createError(ErrorStatus.invalidParametersError);
        }

        // Log successful validation
        this.inferenceLogger.logJobValidation(true, data.pairs.length);
    }
}