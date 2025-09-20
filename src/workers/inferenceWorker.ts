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
                // Update inference status to COMPLETED - tokens are already reserved and confirmed in controller
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

            // Simple refund: if we have a tokenReservationId, refund the tokens
            await this.handleTokenRefund(tokenReservationId, inferenceId);

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

    private async handleTokenRefund(tokenReservationId?: string, inferenceId?: string): Promise<void> {
        if (!tokenReservationId) return;
        try {
            const refundResult = await this.tokenService.refundTokens(tokenReservationId);
            if (!refundResult.success) {
                errorLogger.logDatabaseError("REFUND_TOKENS", "worker", refundResult.error || "Failed to refund tokens");
            } else {
                inferenceLogger.log("Tokens refunded successfully", { 
                    inferenceId, 
                    tokenReservationId
                });
            }
        } catch (refundError) {
            const refundErr = refundError instanceof Error ? refundError : new Error("Unknown refund error");
            errorLogger.logDatabaseError("REFUND_TOKENS", "worker", refundErr.message);
        }
    }

}