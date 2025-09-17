import { InferenceQueue } from "../queue/inferenceQueue";
import logger from "../utils/logger";

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
            logger.info("Proxy: Queuing inference job", { inferenceId, userId });

            // Validate input data before queuing
            const validation = this.validateJobData(datasetData, parameters);
            if (!validation.success) {
                logger.warn("Proxy: Validation failed", { 
                    inferenceId, 
                    userId, 
                    error: validation.error 
                });
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

            logger.info("Proxy: Job queued successfully", { 
                inferenceId, 
                userId, 
                jobId: job.id 
            });

            return {
                success: true,
                jobId: job.id?.toString(),
                message: "Inference job queued successfully"
            };

        } catch (error) {
            logger.error("Proxy: Error queuing inference job", { 
                inferenceId,
                userId,
                error: error instanceof Error ? error.message : "Unknown error" 
            });
            
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
                return {
                    success: false,
                    error: "Job not found"
                };
            }

            return {
                success: true,
                ...jobStatus
            };
        } catch (error) {
            logger.error("Proxy: Error getting job status", { 
                jobId,
                error: error instanceof Error ? error.message : "Unknown error" 
            });
            
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
            return {
                success: false,
                error: "Invalid dataset data"
            };
        }

        const data = datasetData as { pairs?: Array<{ imagePath: string; maskPath: string }> };
        if (!data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
            return {
                success: false,
                error: "Dataset contains no valid pairs"
            };
        }

        // Validate parameters
        if (parameters && typeof parameters !== "object") {
            return {
                success: false,
                error: "Invalid parameters format"
            };
        }

        return { success: true };
    }
}
