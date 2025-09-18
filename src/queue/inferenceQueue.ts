import Bull from "bull";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

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

        try {
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
            inferenceLogger.logQueueConnected();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("QUEUE_INITIALIZATION", "redis", err.message);
            throw error;
        }
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
        try {
            const job = await this.queue.add("process-inference", jobData, {
                priority: 1,
                delay: 0
            });

            inferenceLogger.logJobAdded(jobData.inferenceId, jobData.userId, job.id?.toString());
            return job;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("ADD_JOB_TO_QUEUE", "redis", err.message);
            throw error;
        }
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
                errorLogger.logDatabaseError("GET_JOB_STATUS", "redis", "Job not found");
                return null;
            }

            const state = await job.getState();
            inferenceLogger.logJobStatusRetrieved(jobId, state);
            
            return {
                status: state,
                progress: job.progress(),
                result: job.returnvalue,
                error: job.failedReason
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("GET_JOB_STATUS", "redis", err.message);
            return null;
        }
    }

    private setupEventListeners(): void {
        this.queue.on("active", () => {
            // Remove duplicate - worker already logs when processing starts
            // inferenceLogger.logJobProcessingStarted(job.id?.toString() || "unknown", job.data.inferenceId);
        });

        this.queue.on("completed", () => {
            // Remove duplicate - worker already logs when processing completes
            // inferenceLogger.logJobProcessingCompleted(job.id?.toString() || "unknown", job.data.inferenceId);
        });

        this.queue.on("failed", (job, error) => {
            // Keep this one as it's different from worker logging - this is queue-level failure
            inferenceLogger.logJobProcessingFailed(
                job.id?.toString() || "unknown", 
                job.data.inferenceId, 
                error.message
            );
        });

        this.queue.on("stalled", (job) => {
            errorLogger.logDatabaseError("JOB_STALLED", "redis", `Job ${job.id} stalled`);
        });

        this.queue.on("error", (error) => {
            errorLogger.logDatabaseError("QUEUE_ERROR", "redis", error.message);
        });
    }

    public async close(): Promise<void> {
        try {
            await this.queue.close();
            inferenceLogger.logQueueClosed();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("CLOSE_QUEUE", "redis", err.message);
        }
    }
}
