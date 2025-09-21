// import necessary modules and types
import Bull from "bull";
import { InferenceQueue } from "../queue/inferenceQueue";
import { InferenceBlackBoxAdapter } from "../services/inferenceBlackBoxAdapter";
import { InferenceRepository } from "../repository/inferenceRepository";
import { TokenService } from "../services/tokenService";
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

// InferenceWorker processes inference jobs from the InferenceQueue.
export class InferenceWorker {
    private static instance: InferenceWorker;
    private readonly inferenceQueue: InferenceQueue;
    private readonly blackBoxAdapter: InferenceBlackBoxAdapter;
    private readonly inferenceRepository: InferenceRepository;
    private readonly tokenService: TokenService;
    private isRunning: boolean = false;

    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.inferenceQueue = InferenceQueue.getInstance();
        this.blackBoxAdapter = InferenceBlackBoxAdapter.getInstance();
        this.inferenceRepository = InferenceRepository.getInstance();
        this.tokenService = TokenService.getInstance();
    }

    // Provides access to the single instance of InferenceWorker.
    public static getInstance(): InferenceWorker {
        if (!InferenceWorker.instance) {
            InferenceWorker.instance = new InferenceWorker();
        }
        return InferenceWorker.instance;
    }

    // Starts processing jobs from the inference queue.
    public start(): void {
        if (this.isRunning) {
            errorLogger.logValidationError("workerStatus", "running", "Inference worker is already running");
            return;
        }

        // Start the Bull queue
        try {
            inferenceLogger.log("Starting inference worker");

            const queue = this.inferenceQueue.getQueue();
            
            // Process inference jobs with concurrency of 2
            queue.process("process-inference", 2, async (job: Bull.Job<InferenceJobData>) => {
                return await this.processInferenceJob(job);
            });

            // Set the running flag
            this.isRunning = true;
            inferenceLogger.logWorkerStarted();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("START_WORKER", "worker", err.message);
            throw error;
        }
    }

    // Processes a single inference job.
    private async processInferenceJob(job: Bull.Job<InferenceJobData>): Promise<{
        success: boolean;
        result?: unknown;
        error?: string;
    }> {
        // Destructure job data
        const { inferenceId, userId, datasetData, parameters } = job.data;
        let tokenReservationId: string | undefined;

        // Log job start
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

            // Handle successful processing
            if (result.success) {
                // Update inference status to COMPLETED - tokens are already reserved and confirmed in controller
                await this.inferenceRepository.updateInferenceStatus(inferenceId, "COMPLETED", { ...result });
                
                // Final job progress
                await job.progress(100);

                // Log job completion
                inferenceLogger.logJobProcessingCompleted(job.id?.toString() || "unknown", inferenceId);

                return {
                    success: true,
                    result
                };
            } else {
                throw new Error(result.error || "Blackbox processing failed");
            }

        } catch (error) {
            // Log job failure
            const err = error instanceof Error ? error : new Error("Unknown error");
            inferenceLogger.logJobProcessingFailed(job.id?.toString() || "unknown", inferenceId, err.message);

            // Attempt to refund tokens if they were reserved
            await this.handleTokenRefund(tokenReservationId, inferenceId);

            // Update inference status to FAILED
            await this.inferenceRepository.updateInferenceStatus(
                inferenceId, 
                "FAILED", 
                { error: err.message, tokenRefunded: !!tokenReservationId }
            );

            // Return failure result
            errorLogger.logDatabaseError("PROCESS_JOB", "worker", err.message);
            throw error; // Re-throw to let Bull handle the failure
        }
    }

    // Handles token refund in case of job failure.
    private async handleTokenRefund(tokenReservationId?: string, inferenceId?: string): Promise<void> {
        // If no reservation ID, nothing to refund
        if (!tokenReservationId) return;
        try {
            // Attempt to refund tokens
            const refundResult = await this.tokenService.refundTokens(tokenReservationId);
            if (!refundResult.tokensRefunded || refundResult.tokensRefunded <= 0) {
                errorLogger.logDatabaseError("REFUND_TOKENS", "worker", "Failed to refund tokens");
            } else {
                // Log successful refund
                inferenceLogger.log("Tokens refunded successfully", { 
                    inferenceId, 
                    tokenReservationId,
                    tokensRefunded: refundResult.tokensRefunded,
                    restoredBalance: refundResult.restoredBalance
                });
            }
        } catch (refundError) {
            const refundErr = refundError instanceof Error ? refundError : new Error("Unknown refund error");
            errorLogger.logDatabaseError("REFUND_TOKENS", "worker", refundErr.message);
        }
    }

}