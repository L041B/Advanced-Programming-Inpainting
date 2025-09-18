import Bull from "bull";
import { InferenceQueue } from "../queue/inferenceQueue";
import { InferenceBlackBoxAdapter } from "../services/inferenceBlackBoxAdapter";
import { InferenceRepository } from "../repository/inferenceRepository";
import { TokenService } from "../services/tokenService";
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

export class InferenceWorker {
    private static instance: InferenceWorker;
    private readonly inferenceQueue: InferenceQueue;
    private readonly blackBoxAdapter: InferenceBlackBoxAdapter;
    private readonly inferenceRepository: InferenceRepository;
    private readonly tokenService: TokenService;
    private isRunning: boolean = false;

    private constructor() {
        this.inferenceQueue = InferenceQueue.getInstance();
        this.blackBoxAdapter = new InferenceBlackBoxAdapter();
        this.inferenceRepository = InferenceRepository.getInstance();
        this.tokenService = TokenService.getInstance();
    }

    public static getInstance(): InferenceWorker {
        if (!InferenceWorker.instance) {
            InferenceWorker.instance = new InferenceWorker();
        }
        return InferenceWorker.instance;
    }

    public start(): void {
        if (this.isRunning) {
            errorLogger.logValidationError("workerStatus", "running", "Inference worker is already running");
            return;
        }

        try {
            inferenceLogger.log("Starting inference worker");

            const queue = this.inferenceQueue.getQueue();
            
            // Process inference jobs with concurrency of 2
            queue.process("process-inference", 2, async (job: Bull.Job<InferenceJobData>) => {
                return await this.processInferenceJob(job);
            });

            this.isRunning = true;
            inferenceLogger.logWorkerStarted();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("START_WORKER", "worker", err.message);
            throw error;
        }
    }

    private async processInferenceJob(job: Bull.Job<InferenceJobData>): Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
    }> {
        const { inferenceId, userId, datasetData, parameters } = job.data;
        let tokenReservationId: string | undefined;

        try {
            inferenceLogger.logJobProcessingStarted(job.id?.toString() || "unknown", inferenceId);

            // Extract token reservation info from parameters
            const jobParams = parameters as { tokenReservationId?: string; tokenCost?: number };
            tokenReservationId = jobParams.tokenReservationId;

            // Update inference status to RUNNING
            await this.inferenceRepository.updateInferenceStatus(inferenceId, "RUNNING");
            
            // Update job progress
            await job.progress(10);

            // Process the dataset using the blackbox
            inferenceLogger.log("Calling blackbox service", { inferenceId });
            const result = await this.blackBoxAdapter.processDataset(userId, datasetData, parameters);

            // Update job progress
            await job.progress(90);

            if (result.success) {
                // Confirm token usage on successful completion
                if (tokenReservationId) {
                    const confirmResult = await this.tokenService.confirmTokenUsage(tokenReservationId);
                    if (!confirmResult.success) {
                        inferenceLogger.log("Warning: Failed to confirm token usage", { 
                            inferenceId, 
                            tokenReservationId,
                            error: confirmResult.error 
                        });
                    }
                }

                // Update inference status to COMPLETED
                await this.inferenceRepository.updateInferenceStatus(inferenceId, "COMPLETED", { ...result });
                
                await job.progress(100);

                inferenceLogger.logJobProcessingCompleted(job.id?.toString() || "unknown", inferenceId);

                return {
                    success: true,
                    result
                };
            } else {
                throw new Error(result.error || "Blackbox processing failed");
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            inferenceLogger.logJobProcessingFailed(job.id?.toString() || "unknown", inferenceId, err.message);

            // Refund tokens on processing failure
            if (tokenReservationId) {
                const refundResult = await this.tokenService.refundTokens(tokenReservationId);
                if (!refundResult.success) {
                    errorLogger.logDatabaseError("REFUND_TOKENS", "worker", refundResult.error || "Failed to refund tokens");
                }
            }

            // Update inference status to FAILED
            await this.inferenceRepository.updateInferenceStatus(
                inferenceId, 
                "FAILED", 
                { error: err.message, tokenRefunded: !!tokenReservationId }
            );

            errorLogger.logDatabaseError("PROCESS_JOB", "worker", err.message);
            throw error; // Re-throw to let Bull handle the failure
        }
    }

    public async stop(): Promise<void> {
        if (!this.isRunning) {
            errorLogger.logValidationError("workerStatus", "stopped", "Inference worker is not running");
            return;
        }

        try {
            inferenceLogger.log("Stopping inference worker");
            
            // Close the queue connection
            await this.inferenceQueue.close();
            this.isRunning = false;
            inferenceLogger.logWorkerStopped();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("STOP_WORKER", "worker", err.message);
            throw error;
        }
    }

    public getStatus(): { isRunning: boolean } {
        return { isRunning: this.isRunning };
    }
}
