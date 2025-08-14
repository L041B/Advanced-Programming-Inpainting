// Import necessary modules and services.
import { InpaintingQueue } from "../queue/inpaintingQueue";
import { BlackBoxService } from "../services/blackBox";
import { loggerFactory, ExecutionRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { v4 as uuidv4 } from "uuid";

// Define the structure for an inpainting request.
export interface InpaintingRequest {
    originalImage: Buffer;
    maskImage: Buffer;
    executionId: string;
    userId: string;
}

// Define the structure for different response types.
export interface PreviewResponse {
    success: boolean;
    outputImage?: Buffer;
    error?: string;
}

// Define the structure for a queued job response.
export interface QueuedJobResponse {
    success: boolean;
    jobId?: string;
    error?: string;
}

// Define the BlackBoxProxy class.
export class BlackBoxProxy {
    private static instance: BlackBoxProxy;
    private readonly inpaintingQueue: InpaintingQueue;
    private readonly blackBoxService: BlackBoxService;
    private readonly executionLogger: ExecutionRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.inpaintingQueue = InpaintingQueue.getInstance();
        this.blackBoxService = BlackBoxService.getInstance();
        this.executionLogger = loggerFactory.createExecutionLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    public static getInstance(): BlackBoxProxy {
        if (!BlackBoxProxy.instance) {
            BlackBoxProxy.instance = new BlackBoxProxy();
        }
        return BlackBoxProxy.instance;
    }

    // Private helper to ensure buffers are properly formatted for queue storage
    private ensureBufferFormat(buffer: Buffer): Buffer {
        if (Buffer.isBuffer(buffer)) {
            return buffer;
        }
        // Handle case where buffer was serialized/deserialized
        if (
            buffer &&
            typeof buffer === "object" &&
            buffer !== null &&
            "data" in buffer &&
            Array.isArray((buffer as { data?: unknown }).data)
        ) {
            return Buffer.from((buffer as { data: number[] }).data);
        }
        throw new Error("Invalid buffer format");
    }

    // Replace processPreview with queuePreviewJob for asynchronous processing
    public async queuePreviewJob(request: Pick<InpaintingRequest, "originalImage" | "maskImage">): Promise<QueuedJobResponse> {
        this.executionLogger.log("Queueing preview job", { component: "BlackBoxProxy" });
        try {
            // Ensure buffers are properly formatted before validation
            const originalImage = this.ensureBufferFormat(request.originalImage);
            const maskImage = this.ensureBufferFormat(request.maskImage);

            const validatedRequest = { originalImage, maskImage };
            if (!this.validateImages(validatedRequest)) {
                return { success: false, error: "Invalid image data provided for preview." };
            }

            // Generate a proper UUID for preview execution
            const previewExecutionId = uuidv4();

            // Queue the preview job without waiting
            const jobId = await this.inpaintingQueue.addJob({
                executionId: previewExecutionId,
                userId: "preview_user",
                originalImage: originalImage,
                maskImage: maskImage,
                isPreview: true
            });

            this.executionLogger.log("Preview job queued successfully", { 
                component: "BlackBoxProxy", 
                jobId,
                executionId: previewExecutionId
            });
            return { success: true, jobId: jobId };

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.log("Error queueing preview job", { component: "BlackBoxProxy", errorMessage: err.message });
            return { success: false, error: err.message };
        }
    }

    // Get preview result from completed job
    public async getPreviewResult(jobId: string): Promise<{ status: string; result: PreviewResponse | { success: false; error: string } | null }> {
        this.executionLogger.log("Getting preview result", { component: "BlackBoxProxy", jobId });
        try {
            const jobStatus = await this.inpaintingQueue.getJobStatus(jobId);
            
            if (!jobStatus) {
                return { status: "not_found", result: null };
            }

            if (jobStatus.state === "completed") {
                return { status: "completed", result: jobStatus.returnValue as PreviewResponse };
            }

            if (jobStatus.state === "failed") {
                return { status: "failed", result: { success: false, error: jobStatus.failedReason || "Job failed" } };
            }

            return { status: jobStatus.state, result: null };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.log("Error getting preview result", { component: "BlackBoxProxy", jobId, errorMessage: err.message });
            return { status: "error", result: { success: false, error: err.message } };
        }
    }

    // Keep the old processPreview method for backward compatibility if needed
    public async processPreview(request: Pick<InpaintingRequest, "originalImage" | "maskImage">): Promise<PreviewResponse> {
        // Delegate to the new async flow
        const queueResult = await this.queuePreviewJob(request);
        if (!queueResult.success) {
            return { success: false, error: queueResult.error };
        }
        
        // For immediate preview needs, we can still poll for completion
        // This is a fallback for existing code
        return new Promise((resolve) => {
            const checkResult = async (): Promise<void> => {
                const result = await this.getPreviewResult(queueResult.jobId!);
                if (result.status === "completed") {
                    resolve(result.result as PreviewResponse);
                } else if (result.status === "failed") {
                    resolve(result.result as PreviewResponse);
                } else {
                    setTimeout(() => void checkResult(), 100);
                }
            };
            setTimeout(() => void checkResult(), 100);
        });
    }

    // Queues a processing job for inpainting.
    public async queueProcessingJob(request: InpaintingRequest): Promise<QueuedJobResponse> {
        this.executionLogger.log("Adding processing request to queue", { component: "BlackBoxProxy", executionId: request.executionId });
        try {
            // Ensure buffers are properly formatted before validation
            const originalImage = this.ensureBufferFormat(request.originalImage);
            const maskImage = this.ensureBufferFormat(request.maskImage);

            const processedRequest = {
                ...request,
                originalImage,
                maskImage,
                isPreview: false
            };

            // Perform a more thorough validation for processing jobs.
            if (!this.validateProcessingRequest(processedRequest)) {
                return { success: false, error: "Invalid request data for processing job." };
            }
            
            const jobId = await this.inpaintingQueue.addJob(processedRequest);
            
            this.executionLogger.log("Job added to queue successfully", { component: "BlackBoxProxy", executionId: request.executionId, jobId });
            return { success: true, jobId: jobId };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.log("Error queueing processing job", { component: "BlackBoxProxy", executionId: request.executionId, errorMessage: err.message });
            return { success: false, error: err.message };
        }
    }

    // Retrieves the status of a job from the queue.
    public async getJobStatus(jobId: string) {
        this.executionLogger.log("Getting job status", { component: "BlackBoxProxy", jobId });
        try {
            return await this.inpaintingQueue.getJobStatus(jobId);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.log("Error getting job status from queue", { component: "BlackBoxProxy", jobId, errorMessage: err.message });
            throw err;
        }
    }

    // Private helper to validate that images are present and are valid Buffers.
    private validateImages(request: Partial<InpaintingRequest>): boolean {
        // Validate the original image.
        if (!request.originalImage || !Buffer.isBuffer(request.originalImage) || request.originalImage.length === 0) {
            this.errorLogger.logValidationError("originalImage", "invalid", "Invalid original image");
            return false;
        }

        // Validate the mask image.
        if (!request.maskImage || !Buffer.isBuffer(request.maskImage) || request.maskImage.length === 0) {
            this.errorLogger.logValidationError("maskImage", "invalid", "Invalid mask image");
            return false;
        }
        return true;
    }

    // Private helper to validate a full processing request, including IDs.
    private validateProcessingRequest(request: InpaintingRequest): boolean {
        // First, validate the images.
        if (!this.validateImages(request)) {
            return false;
        }
        
        // Then, validate the required IDs for a processing job.
        if (!request.executionId || !request.userId) {
            this.errorLogger.logValidationError("executionId/userId", "missing", "Missing executionId or userId for processing request");
            return false;
        }

        // Log the successful validation.
        this.executionLogger.log("Request validation passed", { component: "BlackBoxProxy", executionId: request.executionId });
        return true;
    }
}