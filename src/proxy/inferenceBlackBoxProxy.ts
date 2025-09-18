import { InferenceQueue } from "../queue/inferenceQueue";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

interface ProxyResponse {
    success: boolean;
    jobId?: string;
    message?: string;
    error?: string;
}

export class InferenceBlackBoxProxy {
    private static instance: InferenceBlackBoxProxy;
    private readonly inferenceQueue: InferenceQueue;

    private constructor() {
        this.inferenceQueue = InferenceQueue.getInstance();
    }

    public static getInstance(): InferenceBlackBoxProxy {
        if (!InferenceBlackBoxProxy.instance) {
            InferenceBlackBoxProxy.instance = new InferenceBlackBoxProxy();
        }
        return InferenceBlackBoxProxy.instance;
    }

    public async processDataset(
        inferenceId: string,
        userId: string,
        datasetData: Record<string, unknown>,
        parameters: Record<string, unknown>
    ): Promise<ProxyResponse> {
        try {
            inferenceLogger.log("Queuing inference job", { inferenceId, userId });

            // Validate input data before queuing
            const validation = this.validateJobData(datasetData, parameters);
            if (!validation.success) {
                errorLogger.logValidationError("jobData", inferenceId, validation.error || "Validation failed");
                return {
                    success: false,
                    error: validation.error
                };
            }

            // Add job to queue
            const job = await this.inferenceQueue.addInferenceJob({
                inferenceId,
                userId,
                datasetData,
                parameters
            });

            return {
                success: true,
                jobId: job.id?.toString(),
                message: "Inference job queued successfully"
            };

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("QUEUE_INFERENCE_JOB", "inference_queue", err.message);
            
            return {
                success: false,
                error: "Failed to queue inference job"
            };
        }
    }

    public async getJobStatus(jobId: string): Promise<{
        success: boolean;
        status?: string;
        progress?: number;
        result?: unknown;
        error?: string;
    }> {
        try {
            const jobStatus = await this.inferenceQueue.getJobStatus(jobId);
            
            if (!jobStatus) {
                errorLogger.logDatabaseError("GET_JOB_STATUS", "inference_queue", "Job not found");
                return {
                    success: false,
                    error: "Job not found"
                };
            }

            inferenceLogger.logInferenceStatusCheck(jobId);
            return {
                success: true,
                ...jobStatus
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("GET_JOB_STATUS", "inference_queue", err.message);
            
            return {
                success: false,
                error: "Failed to get job status"
            };
        }
    }

    private validateJobData(datasetData: Record<string, unknown>, parameters: Record<string, unknown>): {
        success: boolean;
        error?: string;
    } {
        // Validate dataset data structure
        if (!datasetData || typeof datasetData !== "object") {
            errorLogger.logValidationError("datasetData", "object", "Invalid dataset data");
            return {
                success: false,
                error: "Invalid dataset data"
            };
        }

        const data = datasetData as { pairs?: Array<{ imagePath: string; maskPath: string }> };
        if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
            errorLogger.logValidationError("datasetPairs", data.pairs?.length?.toString() || "0", "Dataset contains no valid pairs");
            return {
                success: false,
                error: "Dataset contains no valid pairs"
            };
        }

        // Validate parameters
        if (parameters && typeof parameters !== "object") {
            errorLogger.logValidationError("parameters", typeof parameters, "Invalid parameters format");
            return {
                success: false,
                error: "Invalid parameters format"
            };
        }

        inferenceLogger.logJobValidation(true, data.pairs.length);

        return { success: true };
    }
}