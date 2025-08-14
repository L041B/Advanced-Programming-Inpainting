// Import necessary modules from Node.js, Express, and project files
import { Request, Response } from 'express';
import * as fs from 'fs/promises'; 
import { ExecutionRepository } from '../repository/executionRepository';
import { BlackBoxProxy } from '../proxy/blackBoxProxy';
import { loggerFactory, ExecutionRouteLogger, ApiRouteLogger, ErrorRouteLogger } from '../factory/loggerFactory';
import { FileService } from '../services/fileService';    
import { ExecutionDao } from '../dao/executionDao';              

// Define a custom Request interface for type safety with authenticated users.
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

// Define an interface for the structure of data used in execution updates.
interface ExecutionUpdateData {
    status?: 'pending' | 'processing' | 'completed' | 'failed';
    originalImage?: Buffer;
    maskImage?: Buffer;
    outputImage?: Buffer;
}

// executioncontroller is responsible for handling all incoming requests related to execution.
export class ExecutionController {
    private readonly executionRepository: ExecutionRepository;
    private readonly executionLogger: ExecutionRouteLogger;
    private readonly apiLogger: ApiRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;
    private readonly blackBoxProxy: BlackBoxProxy;

    constructor() {
        this.executionRepository = ExecutionRepository.getInstance();
        this.blackBoxProxy = BlackBoxProxy.getInstance();
        this.executionLogger = loggerFactory.createExecutionLogger();
        this.apiLogger = loggerFactory.createApiLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // performInpainting handles the inpainting process.
    public performInpainting = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            // Validate the presence of required files.
            if (!files?.originalImage?.[0] || !files?.maskImage?.[0]) {
                this.errorLogger.logValidationError('files', 'missing', 'Both original image and mask image are required');
                res.status(400).json({ success: false, message: 'Both original image and mask image are required' });
                return;
            }

            // Extract file information.
            const originalImageFile = files.originalImage[0];
            const maskImageFile = files.maskImage[0];
            let originalImageBuffer: Buffer;
            let maskImageBuffer: Buffer;

            // Read the image files into memory.
            try {
                originalImageBuffer = await fs.readFile(originalImageFile.path);
                maskImageBuffer = await fs.readFile(maskImageFile.path);
                
                // Ensure we have valid, non-empty buffers
                if (!Buffer.isBuffer(originalImageBuffer) || !Buffer.isBuffer(maskImageBuffer) || 
                    originalImageBuffer.length === 0 || maskImageBuffer.length === 0) {
                    throw new Error('Image files cannot be empty or invalid');
                }
            } catch (error) {
                this.errorLogger.logFileUploadError(undefined, undefined, `Failed to read image files: ${(error as Error).message}`);
                res.status(400).json({ success: false, message: 'Failed to read image files or files are corrupted.' });
                return;
            }

            // Create a new execution record in the database.
            const execution = await this.executionRepository.createExecution({
                originalImage: originalImageBuffer,
                maskImage: maskImageBuffer,
                outputImage: Buffer.alloc(0),
                status: 'pending'
            }, userId);

            this.executionLogger.log('Execution record created', { executionId: execution.id, userId });

            // Queue the inpainting job for processing.
            const queueResult = await this.blackBoxProxy.queueProcessingJob({
                originalImage: originalImageBuffer,
                maskImage: maskImageBuffer,
                executionId: execution.id,
                userId: userId
            });

            // Clean up temporary files.
            Promise.all([fs.unlink(originalImageFile.path), fs.unlink(maskImageFile.path)])
                .catch(cleanupError => {
                    this.errorLogger.log('Failed to cleanup temporary files', { error: (cleanupError as Error).message });
                });

            // Check if the job was queued successfully.
            if (!queueResult.success) {
                await this.executionRepository.updateExecutionStatus(execution.id, userId, 'failed');
                res.status(500).json({ success: false, message: queueResult.error || 'Failed to queue inpainting job' });
                return;
            }

            // Log the successful execution creation.
            this.executionLogger.logExecutionCreation(execution.id, userId, execution.status);
            res.status(202).json({
                success: true,
                message: 'Inpainting job queued successfully',
                data: { executionId: execution.id, jobId: queueResult.jobId, status: execution.status, createdAt: execution.createdAt }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('CREATE_EXECUTION', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(500).json({ success: false, message: err.message });
        }
    }

    // Retrieves the current status of a background job from the processing queue.
    public getJobStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            const jobStatus = await this.blackBoxProxy.getJobStatus(req.params.jobId);
            if (!jobStatus) {
                res.status(404).json({ success: false, message: 'Job not found' });
                return;
            }
            res.status(200).json({ success: true, data: jobStatus });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('GET_JOB_STATUS', 'queue', err.message);
            this.apiLogger.logError(req, err);
            res.status(500).json({ success: false, message: 'Error retrieving job status' });
        }
    }

    // Retrieves a single, complete execution record from the database.
    public getExecution = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            // Retrieve the execution record from the database.
            const execution = await this.executionRepository.getExecutionWithUser(req.params.id);
            if (!execution) {
                res.status(404).json({ success: false, message: 'Execution not found' });
                return;
            }
            this.executionLogger.logExecutionRetrieval(req.params.id);
            res.status(200).json({ success: true, data: execution });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('GET_EXECUTION', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(500).json({ success: false, message: 'Error retrieving execution' });
        }
    }

    // Retrieves all executions belonging to the authenticated user.
    public getUserExecutions = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            const userId = req.user!.userId;
            const executions = await this.executionRepository.getUserExecutions(userId);
            this.executionLogger.logUserExecutionsRetrieval(userId, executions.length);
            res.status(200).json({ success: true, data: executions });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('GET_USER_EXECUTIONS', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(400).json({ success: false, message: err.message });
        }
    }

    // Updates an execution, potentially with new images, and requeues it for processing.
    public updateExecution = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            // Validate the request data.
            const executionId = req.params.id;
            const userId = req.user!.userId;
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            // Prepare the update data.
            const updateData: ExecutionUpdateData = {};
            let needsReprocessing = false;

            // Check if new images were uploaded.
            if (files?.originalImage?.[0]) {
                updateData.originalImage = await fs.readFile(files.originalImage[0].path);
                await fs.unlink(files.originalImage[0].path);
                needsReprocessing = true;
            }

            // Check if new mask images were uploaded.
            if (files?.maskImage?.[0]) {
                updateData.maskImage = await fs.readFile(files.maskImage[0].path);
                await fs.unlink(files.maskImage[0].path);
                needsReprocessing = true;
            }

            // Check if new mask images were uploaded.
            if (needsReprocessing) {
                const currentExecution = await this.executionRepository.getExecutionImages(executionId);
                if (!currentExecution) {
                    res.status(404).json({ success: false, message: 'Execution not found' });
                    return;
                }

                // Prepare the update data.
                updateData.status = 'pending';
                updateData.outputImage = Buffer.alloc(0);

                // Update the execution in the database.
                const updatedExecution = await this.executionRepository.updateExecution(executionId, userId, updateData);
                const queueResult = await this.blackBoxProxy.queueProcessingJob({
                    originalImage: updateData.originalImage || currentExecution.originalImage,
                    maskImage: updateData.maskImage || currentExecution.maskImage,
                    executionId: executionId,
                    userId: userId
                });

                // Check if the job was queued successfully.
                if (!queueResult.success) {
                    await this.executionRepository.updateExecutionStatus(executionId, userId, 'failed');
                    throw new Error(queueResult.error || 'Failed to queue reprocessing job');
                }

                res.status(200).json({
                    success: true,
                    message: 'Execution updated and queued for reprocessing',
                    data: { id: updatedExecution.id, status: updatedExecution.status, jobId: queueResult.jobId }
                });

            } else {
                res.status(200).json({ success: true, message: 'No image files provided for update. No changes made.' });
            }
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('UPDATE_EXECUTION', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(500).json({ success: false, message: err.message });
        }
    }

    // Deletes an execution record from the database.
    public deleteExecution = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            const deleted = await this.executionRepository.deleteExecution(req.params.id, req.user!.userId);
            if (!deleted) {
                res.status(404).json({ success: false, message: 'Execution not found or access denied' });
                return;
            }
            this.executionLogger.logExecutionDeletion(req.params.id, req.user!.userId);
            res.status(200).json({ success: true, message: 'Execution deleted successfully' });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('DELETE_EXECUTION', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(400).json({ success: false, message: err.message });
        }
    }

    // Retrieves the status of an execution record from the database.
    public getExecutionStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            const execution = await this.executionRepository.getExecutionBasicInfo(req.params.id);
            if (!execution) {
                res.status(404).json({ success: false, message: 'Execution not found' });
                return;
            }
            res.status(200).json({ success: true, data: { id: execution.id, status: execution.status } });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('GET_EXECUTION_STATUS', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(500).json({ success: false, message: 'Error retrieving execution status' });
        }
    }

    // Generates a temporary, publicly accessible URL for downloading a result image.
    public downloadResult = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            // Validate the request data.
            const executionId = req.params.id;
            const userId = req.user!.userId;

            // Check if the user is authorized to download the result.
            const executionDao = ExecutionDao.getInstance();
            const execution = await executionDao.findByIdForDownload(executionId);
            
            if (!execution) {
                res.status(404).json({ success: false, message: 'Execution not found' });
                return;
            }

            if (execution.status !== 'completed') {
                const message = `Execution is ${execution.status}. Result is not available.`;
                res.status(202).json({ success: false, message, data: { status: execution.status } });
                return;
            }

            if (!execution.outputImage || execution.outputImage.length === 0) {
                res.status(404).json({ success: false, message: 'Result image not found or is corrupted.' });
                return;
            }

            // Generate a temporary URL for the result image.
            const fileService = await FileService.getInstance();
            const imageUrl = await fileService.saveImageToStatic(execution.outputImage, executionId, userId);

            res.status(200).json({
                success: true,
                message: 'Download URL generated successfully',
                data: { executionId, imageUrl, imageSize: execution.outputImage.length, status: execution.status }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.errorLogger.logDatabaseError('DOWNLOAD_RESULT', 'executions', err.message);
            this.apiLogger.logError(req, err);
            res.status(500).json({ success: false, message: 'Error generating download URL' });
        }
    }

    // Modified generateInpainting method for asynchronous preview processing
    public generateInpainting = async (req: Request, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            if (!files?.originalImage?.[0] || !files?.maskImage?.[0]) {
                res.status(400).json({ success: false, message: 'Both original and mask images are required' });
                return;
            }

            // Read the original and mask images
            const originalImageFile = files.originalImage[0];
            const maskImageFile = files.maskImage[0];
            
            const [originalImageBuffer, maskImageBuffer] = await Promise.all([
                fs.readFile(originalImageFile.path),
                fs.readFile(maskImageFile.path)
            ]);

            // Validate buffers before queueing
            if (!Buffer.isBuffer(originalImageBuffer) || !Buffer.isBuffer(maskImageBuffer) || 
                originalImageBuffer.length === 0 || maskImageBuffer.length === 0) {
                res.status(400).json({ success: false, message: 'Invalid or empty image files' });
                return;
            }

            // Queue the preview job asynchronously
            const result = await this.blackBoxProxy.queuePreviewJob({
                originalImage: originalImageBuffer,
                maskImage: maskImageBuffer
            });

            // Cleanup temporary files
            Promise.all([fs.unlink(originalImageFile.path), fs.unlink(maskImageFile.path)])
                .catch(cleanupError => {
                    this.errorLogger.log('Failed to cleanup temporary preview files', { error: (cleanupError as Error).message });
                });

            // Check if the job was queued successfully
            if (!result.success || !result.jobId) {
                res.status(500).json({ success: false, message: result.error || 'Error queueing preview job' });
                return;
            }

            // Respond immediately with the job ID
            res.status(202).json({
                success: true,
                message: 'Preview job queued successfully',
                data: {
                    jobId: result.jobId
                }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error as Error;
            this.apiLogger.logError(req, err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Error queueing preview job' });
            }
        }
    }

    // New method: Get preview status and result (Refactored)
    public getPreviewStatus = async (req: Request, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
        try {
            const { jobId } = req.params;
            const previewResult = await this.blackBoxProxy.getPreviewResult(jobId);

            // The switch statement is now simple and delegates to helper methods.
            // This significantly reduces the cognitive complexity.
            switch (previewResult.status) {
                case 'completed':
                    this.handleCompletedPreview(res, previewResult.result);
                    break;
                case 'failed':
                    this.handleFailedPreview(res, previewResult.result);
                    break;
                case 'not_found':
                    this.handleNotFoundPreview(res);
                    break;
                default:
                    // Handles 'pending', 'processing', etc.
                    this.handlePendingPreview(res, previewResult.status);
                    break;
            }
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.errorLogger.log('Error getting preview status', { jobId: req.params.jobId, errorMessage: err.message });
            this.apiLogger.logError(req, err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: 'Error retrieving preview status' });
            }
        }
    }

    // --- Private Helper Methods for getPreviewStatus ---

    /**
     * Handles the 'completed' state for a preview job.
     */
    private handleCompletedPreview(res: Response, result: unknown): void {
        if (
            typeof result !== 'object' || result === null ||
            !('success' in result) || !(result as { success: boolean }).success
        ) {
            const errorMessage = (result as { error?: string })?.error || 'Preview generation failed';
            res.status(200).json({ status: 'failed', message: errorMessage });
            return;
        }

        const outputImage = this.extractImageBuffer(result as { outputImage?: unknown });

        if (outputImage && outputImage.length > 0) {
            res.set({
                'Content-Type': 'image/png',
                'Content-Disposition': 'inline; filename="preview.png"',
                'Content-Length': outputImage.length.toString()
            });
            res.send(outputImage);
        } else {
            res.status(200).json({
                status: 'failed',
                message: 'Preview output image is empty or invalid'
            });
        }
    }

    /**
     * Handles the 'failed' state for a preview job.
     */
    private handleFailedPreview(res: Response, result: unknown): void {
        const errorMessage = (result as { error?: string })?.error || 'Preview job failed';
        res.status(200).json({ status: 'failed', message: errorMessage });
    }

    /**
     * Handles the 'not_found' state for a preview job.
     */
    private handleNotFoundPreview(res: Response): void {
        res.status(404).json({ status: 'not_found', message: 'Preview job not found' });
    }

    /**
     * Handles any pending or processing states for a preview job.
     */
    private handlePendingPreview(res: Response, status: string): void {
        res.status(200).json({ status: status, message: 'Preview processing...' });
    }

    /**
     * Extracts a Buffer from a potentially complex result object.
     * This isolates the complex buffer reconstruction logic.
     * @returns A Buffer or undefined if extraction fails.
     */
    private extractImageBuffer(resultObj: { outputImage?: unknown }): Buffer | undefined {
        const { outputImage } = resultObj;

        if (!outputImage) {
            return undefined;
        }

        // Case 1: Already a Buffer
        if (Buffer.isBuffer(outputImage)) {
            return outputImage;
        }

        // Case 2: An object like { type: 'Buffer', data: [...] }
        if (
            typeof outputImage === 'object' &&
            outputImage !== null &&
            'data' in outputImage &&
            Array.isArray((outputImage as { data: unknown }).data)
        ) {
            return Buffer.from((outputImage as { data: number[] }).data);
        }

        return undefined;
    }
}