import Bull from "bull";
import logger from "../utils/logger";

interface InferenceJobData {
    inferenceId: string;
    userId: string;
    datasetData: Record<string, unknown>;
    parameters: Record<string, unknown>;
}

export class InferenceQueue {
    private static instance: InferenceQueue;
    private readonly queue: Bull.Queue<InferenceJobData>;

    private constructor() {
        const redisConfig = {
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB || "0")
        };

        this.queue = new Bull<InferenceJobData>("inference-processing", {
            redis: redisConfig,
            defaultJobOptions: {
                removeOnComplete: 10, // Keep 10 completed jobs
                removeOnFail: 25,     // Keep 25 failed jobs
                attempts: 3,          // Retry failed jobs 3 times
                backoff: {
                    type: "exponential",
                    delay: 2000
                }
            }
        });

        this.setupEventListeners();
    }

    public static getInstance(): InferenceQueue {
        if (!InferenceQueue.instance) {
            InferenceQueue.instance = new InferenceQueue();
        }
        return InferenceQueue.instance;
    }

    public getQueue(): Bull.Queue<InferenceJobData> {
        return this.queue;
    }

    public async addInferenceJob(jobData: InferenceJobData): Promise<Bull.Job<InferenceJobData>> {
        logger.info("Adding inference job to queue", { 
            inferenceId: jobData.inferenceId,
            userId: jobData.userId 
        });

        return await this.queue.add("process-inference", jobData, {
            priority: 1,
            delay: 0
        });
    }

    public async getJobStatus(jobId: string): Promise<{
        status: string;
        progress?: number;
        result?: unknown;
        error?: string;
    } | null> {
        try {
            const job = await this.queue.getJob(jobId);
            if (!job) {
                return null;
            }

            const state = await job.getState();
            return {
                status: state,
                progress: job.progress(),
                result: job.returnvalue,
                error: job.failedReason
            };
        } catch (error) {
            logger.error("Error getting job status", { 
                jobId, 
                error: error instanceof Error ? error.message : "Unknown error" 
            });
            return null;
        }
    }

    private setupEventListeners(): void {
        this.queue.on("active", (job) => {
            logger.info("Inference job started", { 
                jobId: job.id,
                inferenceId: job.data.inferenceId 
            });
        });

        this.queue.on("completed", (job, result) => {
            logger.info("Inference job completed", { 
                jobId: job.id,
                inferenceId: job.data.inferenceId,
                success: result.success 
            });
        });

        this.queue.on("failed", (job, error) => {
            logger.error("Inference job failed", { 
                jobId: job.id,
                inferenceId: job.data.inferenceId,
                error: error.message,
                attempts: job.attemptsMade 
            });
        });

        this.queue.on("stalled", (job) => {
            logger.warn("Inference job stalled", { 
                jobId: job.id,
                inferenceId: job.data.inferenceId 
            });
        });
    }

    public async close(): Promise<void> {
        await this.queue.close();
        logger.info("Inference queue closed");
    }
}
