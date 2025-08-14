// Import necessary modules from bullmq, ioredis, and project files.
import { Queue } from "bullmq";
import Redis from "ioredis";
import { loggerFactory, ExecutionRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import dotenv from "dotenv";

dotenv.config();

// Defines the structure of the data that each job in the queue will contain.
export interface InpaintingJobData {
    executionId: string;
    userId: string;
    originalImage: Buffer;
    maskImage: Buffer;
    isPreview?: boolean;
}

// Defines the structure of the response for a job status check.
export interface JobStatusResponse {
    id: string | undefined;
    progress: number | object;
    returnValue: unknown;
    failedReason: string | null;
    processedOn: number | null;
    finishedOn: number | null;
    state: string;
}

// Manages the inpainting job queue using BullMQ and Redis.
export class InpaintingQueue {
    private static instance: InpaintingQueue;
    private readonly queue: Queue;
    private readonly redis: Redis;
    private readonly executionLogger: ExecutionRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.executionLogger = loggerFactory.createExecutionLogger();
        this.errorLogger = loggerFactory.createErrorLogger();

        // Connect to Redis. 
        this.redis = new Redis({
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            maxRetriesPerRequest: null, // Retry indefinitely
        });

        // Initialize the BullMQ queue.
        this.queue = new Queue("inpainting-queue", {
            connection: this.redis,
            defaultJobOptions: {
                attempts: 3, // Retry failed jobs up to 3 times.
                backoff: {   // Use exponential backoff between retries.
                    type: "exponential",
                    delay: 2000,
                },
                removeOnComplete: 1000, // Keep the last 1000 completed jobs.
                removeOnFail: 5000,     // Keep the last 5000 failed jobs for inspection.
            },
        });
    }

    // getInstance method to access the singleton instance.
    public static getInstance(): InpaintingQueue {
        if (!InpaintingQueue.instance) {
            InpaintingQueue.instance = new InpaintingQueue();
        }
        return InpaintingQueue.instance;
    }

    // Adds a new inpainting job to the queue.
    public async addJob(jobData: InpaintingJobData): Promise<string> {
        this.executionLogger.log("Adding job to inpainting queue", {
            component: "InpaintingQueue",
            executionId: jobData.executionId,
        });

        // Add the job to the queue.
        const job = await this.queue.add("inpainting-task", jobData, {
        });

        // Log the successful addition of the job.
        this.executionLogger.log("Job added successfully to queue", {
            component: "InpaintingQueue",
            jobId: job.id,
            executionId: jobData.executionId,
        });

        return job.id!; // The job ID is guaranteed to exist after a successful add.
    }

    // Retrieves the current status of a job from the queue.
    public async getJobStatus(jobId: string): Promise<JobStatusResponse | null> {
        this.executionLogger.log("Retrieving job status", { component: "InpaintingQueue", jobId });

        // Get the job from the queue.
        const job = await this.queue.getJob(jobId);
        if (!job) {
            this.errorLogger.log("Job not found in queue", { component: "InpaintingQueue", jobId });
            return null;
        }

        return {
            id: job.id,
            progress: job.progress,
            returnValue: job.returnvalue as unknown,
            failedReason: job.failedReason || null,
            processedOn: job.processedOn || null,
            finishedOn: job.finishedOn || null,
            state: await job.getState(),
        };
    }

    // Provides direct access to the BullMQ queue instance, for use by workers or for advanced operations.
    public getQueue(): Queue {
        return this.queue;
    }

    // Gracefully closes the queue and the underlying Redis connection.
    public async close(): Promise<void> {
        await this.queue.close();
        await this.redis.quit();
    }
}