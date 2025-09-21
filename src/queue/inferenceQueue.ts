// import all necessary modules and types
import Bull from "bull";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Define the structure of job data
interface InferenceJobData {
    inferenceId: string;
    userId: string;
    datasetData: Record<string, unknown>;
    parameters: Record<string, unknown>;
}

// InferenceQueue manages the Bull queue for processing inference jobs.
export class InferenceQueue {
    private static instance: InferenceQueue;
    private readonly queue: Bull.Queue<InferenceJobData>;
    private readonly errorManager: ErrorManager;
    private readonly inferenceLogger: InferenceRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.errorManager = ErrorManager.getInstance();
        this.inferenceLogger = loggerFactory.createInferenceLogger();
        this.errorLogger = loggerFactory.createErrorLogger();

        // Configure Redis connection using environment variables with defaults
        const redisConfig = {
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            password: process.env.REDIS_PASSWORD,
            db: parseInt(process.env.REDIS_DB || "0")
        };

        // Initialize the Bull queue with Redis configuration and default job options
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

            // Setup event listeners for logging and error handling
            this.setupEventListeners();
            this.inferenceLogger.logQueueConnected();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("QUEUE_INITIALIZATION", "redis", err.message);
            throw this.errorManager.createError(ErrorStatus.queueInitializationFailedError, err.message);
        }
    }

    // Provides access to the single instance of InferenceQueue.
    public static getInstance(): InferenceQueue {
        if (!InferenceQueue.instance) {
            InferenceQueue.instance = new InferenceQueue();
        }
        return InferenceQueue.instance;
    }

    // Returns the Bull queue instance for job processing.
    public getQueue(): Bull.Queue<InferenceJobData> {
        return this.queue;
    }

    // Adds a new inference job to the queue.
    public async addInferenceJob(jobData: InferenceJobData): Promise<Bull.Job<InferenceJobData>> {
        try {
            const job = await this.queue.add("process-inference", jobData, {
                priority: 1,
                delay: 0
            });

            // Log job addition
            this.inferenceLogger.logJobAdded(jobData.inferenceId, jobData.userId, job.id?.toString());
            return job;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("ADD_JOB_TO_QUEUE", "redis", err.message);
            throw this.errorManager.createError(ErrorStatus.jobAdditionFailedError, err.message);
        }
    }

    // Retrieves the status of a job by its ID.
    public async getJobStatus(jobId: string): Promise<{
        status: string;
        progress?: number;
        result?: unknown;
        error?: string;
    }> {
        try {
            const job = await this.queue.getJob(jobId);
            if (!job) {
                // Job not found - this is a 404 case, not a server error
                throw this.errorManager.createError(ErrorStatus.jobNotFoundError);
            }

            // Get the current state of the job
            const state = await job.getState();
            this.inferenceLogger.logJobStatusRetrieved(jobId, state);
            
            return {
                status: state,
                progress: job.progress(),
                result: job.returnvalue,
                error: job.failedReason
            };
        } catch (error) {
            // Handle standardized errors 
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Handle any other unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("GET_JOB_STATUS", "redis", err.message);
            throw this.errorManager.createError(ErrorStatus.jobStatusRetrievalFailedError, err.message);
        }
    }

    // Sets up event listeners for the Bull queue to handle logging and errors.
    private setupEventListeners(): void {
        this.queue.on("active", () => {
        });

        // Log job completion
        this.queue.on("completed", () => {
           
        });

        // Log job failure
        this.queue.on("failed", (job, error) => {
          
            inferenceLogger.logJobProcessingFailed(
                job.id?.toString() || "unknown", 
                job.data.inferenceId, 
                error.message
            );
        });

        // Log stalled jobs
        this.queue.on("stalled", (job) => {
            errorLogger.logDatabaseError("JOB_STALLED", "redis", `Job ${job.id} stalled`);
        });

        // Log queue errors
        this.queue.on("error", (error) => {
            errorLogger.logDatabaseError("QUEUE_ERROR", "redis", error.message);
        });
    }

    // Closes the Bull queue connection gracefully.
    public async close(): Promise<void> {
        try {
            await this.queue.close();
            this.inferenceLogger.logQueueClosed();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.logDatabaseError("CLOSE_QUEUE", "redis", err.message);
        }
    }
}
