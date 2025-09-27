// import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { InferenceRepository } from "../repository/inferenceRepository";
import { DatasetRepository } from "../repository/datasetRepository";
import { InferenceBlackBoxProxy } from "../proxy/inferenceBlackBoxProxy";
import { InferenceService } from "../services/inferenceService";
import { loggerFactory, InferenceRouteLogger, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { TokenService } from "../services/tokenService";

// Extend Request interface to include user property and other custom properties
interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
    tokenReservation?: {
        reservationKey: string;
        reservedAmount: number;
    };
    operationResult?: {
        tokensSpent?: number;
        remainingBalance?: number;
        operationType?: string;
    };
}

// InferenceController class definition
export class InferenceController {
    private static readonly inferenceRepository = InferenceRepository.getInstance();
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly blackBoxProxy = InferenceBlackBoxProxy.getInstance();
    private static readonly tokenService = TokenService.getInstance();
    private static readonly errorManager = ErrorManager.getInstance();
    private static readonly inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

    // Create a new inference with simplified parameters
    static async createInference(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        // Validate input parameters
        try {
            const { datasetName, modelId = "default_inpainting", parameters = {} } = req.body;
            const userId = req.user!.userId;

            // Basic validation
            InferenceController.inferenceLogger.logInferenceCreation("pending", userId, datasetName, modelId);

            // Use the service for business logic 
            const result = await InferenceService.createInference(userId, {
                datasetName,
                modelId,
                parameters
            });

            // Parse jobId as number to ensure it's returned as numeric in JSON
            const jobIdNumber = parseInt(result.jobId, 10);

            // Log the job queuing
            InferenceController.inferenceLogger.logJobQueued(result.inference.id, userId, result.jobId);

            res.status(201).json({
                success: true,
                message: "Inference created and queued successfully",
                inference: {
                    id: result.inference.id,
                    status: result.inference.status,
                    modelId: result.inference.modelId,
                    datasetName,
                    createdAt: result.inference.createdAt
                },
                jobId: isNaN(jobIdNumber) ? result.jobId : jobIdNumber
            });

            // Log response details
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }

    // Get job status by job ID
    static async getJobStatus(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        // Validate input parameters
        try {
            const { jobId } = req.params;

            // Log the status check attempt
            InferenceController.inferenceLogger.logInferenceStatusCheck(jobId);

            // Fetch job status from the black box proxy
            const jobStatus = await InferenceController.blackBoxProxy.getJobStatus(jobId);

            if (jobStatus.error) {
                // Throw standardized error
                throw InferenceController.errorManager.createError(
                    ErrorStatus.jobNotFoundError,
                    jobStatus.error
                );
            }

            // Parse jobId as number for response
            const jobIdNumber = parseInt(jobId, 10);

            // Log the successful retrieval
            InferenceController.inferenceLogger.logJobStatusRetrieved(jobId, jobStatus.status || "unknown");
            res.status(200).json({
                success: true,
                message: "Job status retrieved successfully",
                data: {
                    jobId: isNaN(jobIdNumber) ? jobId : jobIdNumber,
                    status: jobStatus.status,
                    progress: jobStatus.progress,
                    result: jobStatus.result,
                    error: jobStatus.error
                }
            });
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }

    // Get all user inferences
    static async getUserInferences(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { page = 1, limit = 10 } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);

            // Validate pagination parameters
            const MAX_PAGE = 1_000_000;
            const MAX_LIMIT = 100;

            if (
                isNaN(pageNum) || pageNum < 1 || pageNum > MAX_PAGE ||
                isNaN(limitNum) || limitNum < 1 || limitNum > MAX_LIMIT
            ) {
                const error = InferenceController.errorManager.createError(
                    ErrorStatus.invalidParametersError,
                    `Invalid pagination parameters: 'page' must be 1-${MAX_PAGE}.`
                );
                next(error);
                return;
            }

            const { rows: inferences, count } = await InferenceController.inferenceRepository.getUserInferencesWithPagination(
                userId,
                limitNum,
                (pageNum - 1) * limitNum
            );

            // Log the retrieval
            InferenceController.inferenceLogger.logUserInferencesRetrieval(userId, count);
            res.status(200).json({
                success: true,
                message: "Inferences retrieved successfully",
                data: {
                    inferences,
                    totalItems: count,
                    currentPage: pageNum,
                    totalPages: Math.ceil(count / limitNum),
                    itemsPerPage: limitNum
                }
            });
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }

    // Get specific inference
    static async getInference(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            // Validate input parameters
            const userId = req.user!.userId;
            const { id } = req.params;

            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(id, userId);

            // Check if inference exists
            if (!inference) {
                throw InferenceController.errorManager.createError(
                    ErrorStatus.inferenceNotFoundError,
                    "Inference not found"
                );
            }

            InferenceController.inferenceLogger.logInferenceRetrieval(id, userId);
            res.status(200).json({
                success: true,
                message: "Inference retrieved successfully",
                data: inference
            });
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }

    // Get inference results with download links
    static async getInferenceResults(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            // Validate input parameters
            const userId = req.user!.userId;
            const { id } = req.params;

            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(id, userId);

            // Check if inference exists
            if (!inference) {
                throw InferenceController.errorManager.createError(
                    ErrorStatus.inferenceNotFoundError,
                    "Inference not found"
                );
            }

            // Check if inference is completed
            if (inference.status !== "COMPLETED") {
                throw InferenceController.errorManager.createError(
                    ErrorStatus.invalidFormat,
                    `Inference is not completed. Current status: ${inference.status}`
                );
            }

            // Get result data
            const result = inference.result as { 
                images?: Array<{ originalPath: string; outputPath: string }>;
                videos?: Array<{ originalVideoId: string; outputPath: string }>;
            };

            // Base URL for constructing download links 
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            
            // Generate clean URLs for images
            const images = (result.images || []).map((img) => ({
                originalPath: img.originalPath,
                outputPath: img.outputPath,
                downloadUrl: `${baseUrl}/api/inferences/${id}/download/${encodeURIComponent(img.outputPath.split("/").pop() || "")}`
            }));

            // Generate clean URLs for videos
            const videos = (result.videos || []).map((vid) => ({
                originalVideoId: vid.originalVideoId,
                outputPath: vid.outputPath,
                downloadUrl: `${baseUrl}/api/inferences/${id}/download/${encodeURIComponent(vid.outputPath.split("/").pop() || "")}`
            }));

            // Log the retrieval
            InferenceController.inferenceLogger.logInferenceResultsDownload(id, userId);
            res.status(200).json({
                success: true,
                message: "Inference results retrieved successfully",
                data: {
                    inferenceId: inference.id,
                    status: inference.status,
                    images,
                    videos
                }
            });
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }

    // Serve output file securely using JWT authentication
    static async serveOutputFile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { id: inferenceId, filename } = req.params;

            // Verify the user owns this inference
            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(inferenceId, userId);
            
            if (!inference) {
                throw InferenceController.errorManager.createError(
                    ErrorStatus.inferenceNotFoundError,
                    "Inference not found or access denied"
                );
            }

            // Check if inference is completed
            if (inference.status !== "COMPLETED") {
                throw InferenceController.errorManager.createError(
                    ErrorStatus.invalidFormat,
                    `Inference results not available. Status: ${inference.status}`
                );
            }

            // Get the result data and find the requested file
            const result = inference.result as {
                images?: Array<{ originalPath: string; outputPath: string }>;
                videos?: Array<{ originalVideoId: string; outputPath: string }>;
            };

            const decodedFilename = decodeURIComponent(filename);
            let filePath: string | undefined;

            // Search for the file in images
            const imageFile = result.images?.find(img => img.outputPath.endsWith(decodedFilename));
            if (imageFile) {
                filePath = imageFile.outputPath;
            }

            // Search for the file in videos if not found in images
            if (!filePath) {
                const videoFile = result.videos?.find(vid => vid.outputPath.endsWith(decodedFilename));
                if (videoFile) {
                    filePath = videoFile.outputPath;
                }
            }

            if (!filePath) {
                throw InferenceController.errorManager.createError(
                    ErrorStatus.resourceNotFoundError,
                    "File not found in inference results"
                );
            }

            InferenceController.inferenceLogger.logOutputFileServed(filePath);

            const { FileStorage } = await import("../utils/fileStorage");
            
            // Read and stream the file
            try {
                const fileBuffer = await FileStorage.readFile(filePath);
                const ext = filePath.toLowerCase().split(".").pop();
                
                let contentType = "application/octet-stream";
                if (ext === "jpg" || ext === "jpeg") {
                    contentType = "image/jpeg";
                } else if (ext === "png") {
                    contentType = "image/png";
                } else if (ext === "mp4") {
                    contentType = "video/mp4";
                } else if (ext === "avi") {
                    contentType = "video/x-msvideo";
                }

                // Set headers and send the file
                res.set({
                    "Content-Type": contentType,
                    "Content-Length": fileBuffer.length.toString(),
                    "Content-Disposition": `attachment; filename="${decodedFilename}"`
                });
                
                InferenceController.inferenceLogger.logOutputFileServed(filePath);
                res.send(fileBuffer);
            } catch (fileError) {
                const errMsg = fileError instanceof Error ? fileError.message : "Output file not found";
                throw InferenceController.errorManager.createError(
                    ErrorStatus.resourceNotFoundError,
                    errMsg
                );
            }
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }
}
