import Bull from "bull";
import { InferenceQueue } from "../queue/inferenceQueue";
import { InferenceBlackBoxAdapter } from "../services/inferenceBlackBoxAdapter";
import { InferenceRepository } from "../repository/inferenceRepository";
import logger from "../utils/logger";

interface InferenceJobData {
    inferenceId: string;
    userId: string;
    datasetData: Record<string, unknown>;
    parameters: Record<string, unknown>;
}

export class InferenceWorker {
    private static instance: InferenceWorker;
    private readonly inferenceQueue: InferenceQueue;
    private readonly blackBoxAdapter: InferenceBlackBoxAdapter;
    private readonly inferenceRepository: InferenceRepository;
    private isRunning: boolean = false;

    private constructor() {
        this.inferenceQueue = InferenceQueue.getInstance();
        this.blackBoxAdapter = new InferenceBlackBoxAdapter();
        this.inferenceRepository = InferenceRepository.getInstance();
    }

    public static getInstance(): InferenceWorker {
        if (!InferenceWorker.instance) {
            InferenceWorker.instance = new InferenceWorker();
        }
        return InferenceWorker.instance;
    }

    public start(): void {
        if (this.isRunning) {
            logger.warn("Inference worker is already running");
            return;
        }

        logger.info("Starting inference worker...");

        const queue = this.inferenceQueue.getQueue();
        
        // Process inference jobs with concurrency of 2
        queue.process("process-inference", 2, async (job: Bull.Job<InferenceJobData>) => {
            return await this.processInferenceJob(job);
        });

        this.isRunning = true;
        logger.info("Inference worker started successfully");
    }

    private async processInferenceJob(job: Bull.Job<InferenceJobData>): Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
    }> {
        const { inferenceId, userId, datasetData, parameters } = job.data;

        try {
            logger.info("Worker: Processing inference job", { 
                jobId: job.id,
                inferenceId, 
                userId 
            });

            // Update inference status to RUNNING
            await this.inferenceRepository.updateInferenceStatus(inferenceId, "RUNNING");
            
            // Update job progress
            await job.progress(10);

            // Process the dataset using the blackbox
            logger.info("Worker: Calling blackbox service", { inferenceId });
            const result = await this.blackBoxAdapter.processDataset(userId, datasetData, parameters);

            // Update job progress
            await job.progress(90);

            if (result.success) {
                // Update inference status to COMPLETED
                await this.inferenceRepository.updateInferenceStatus(inferenceId, "COMPLETED", { ...result });
                
                await job.progress(100);

                logger.info("Worker: Inference job completed successfully", { 
                    jobId: job.id,
                    inferenceId, 
                    userId 
                });

                return {
                    success: true,
                    result
                };
            } else {
                throw new Error(result.error || "Blackbox processing failed");
            }

        } catch (error) {
            logger.error("Worker: Inference job failed", { 
                jobId: job.id,
                inferenceId, 
                userId, 
                error: error instanceof Error ? error.message : "Unknown error" 
            });

            // Update inference status to FAILED
            await this.inferenceRepository.updateInferenceStatus(
                inferenceId, 
                "FAILED", 
                { error: error instanceof Error ? error.message : "Unknown error" }
            );

            throw error; // Re-throw to let Bull handle the failure
        }
    }

    public async stop(): Promise<void> {
        if (!this.isRunning) {
            logger.warn("Inference worker is not running");
            return;
        }

        logger.info("Stopping inference worker...");
        
        // Close the queue connection
        await this.inferenceQueue.close();
        this.isRunning = false;
        logger.info("Inference worker stopped");
    }

    public getStatus(): { isRunning: boolean } {
        return { isRunning: this.isRunning };
    }
}
