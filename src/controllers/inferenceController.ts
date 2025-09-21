// import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { InferenceRepository } from "../repository/inferenceRepository";
import { DatasetRepository } from "../repository/datasetRepository";
import { InferenceBlackBoxProxy } from "../proxy/inferenceBlackBoxProxy";
import { InferenceService } from "../services/inferenceService";
import { loggerFactory, InferenceRouteLogger, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import jwt from "jsonwebtoken";
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

            // Use the service for business logic (simplified)
            const result = await InferenceService.createInference(userId, {
                datasetName,
                modelId,
                parameters
            });

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
                jobId: result.jobId
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

            // Log the successful retrieval
            InferenceController.inferenceLogger.logJobStatusRetrieved(jobId, jobStatus.status || "unknown");
            res.status(200).json({
                success: true,
                message: "Job status retrieved successfully",
                data: {
                    jobId,
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

        // Validate input parameters
        try {
            const userId = req.user!.userId;
            const { page = 1, limit = 10 } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);

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
                    ErrorStatus.inferenceProcessingFailedError,
                    "Inference not completed"
                );
            }

            // Generate temporary access tokens for output files
            const result = inference.result as { 
                images?: Array<{ originalPath: string; outputPath: string }>;
                videos?: Array<{ originalVideoId: string; outputPath: string }>;
            };

            // Base URL for constructing download links
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            
            // Generate tokens for images
            const images = await Promise.all((result.images || []).map(async (img) => {
                const token = await InferenceController.generateFileToken(userId, img.outputPath);
                return {
                    originalPath: img.originalPath,
                    outputPath: img.outputPath,
                    downloadUrl: `${baseUrl}/api/inferences/download/${token}`
                };
            }));

            // Generate tokens for videos
            const videos = await Promise.all((result.videos || []).map(async (vid) => {
                const token = await InferenceController.generateFileToken(userId, vid.outputPath);
                return {
                    originalVideoId: vid.originalVideoId,
                    outputPath: vid.outputPath,
                    downloadUrl: `${baseUrl}/api/inferences/download/${token}`
                };
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
            // Log response details
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            next(error);
        }
    }

    // Generate temporary token for file access
    private static async generateFileToken(userId: string, filePath: string): Promise<string> {
        const token = jwt.sign(
            { 
                userId, 
                filePath, 
                type: "file_access" 
            },
            process.env.JWT_SECRET || "fallback_secret",
            { expiresIn: "24h" }
        );
        return encodeURIComponent(token);
    }

    // Serve output file securely
    static async serveOutputFile(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            // Validate input parameters
            const token = decodeURIComponent(req.params.token);
            
            InferenceController.inferenceLogger.logOutputFileServed(`token_access_${token.substring(0, 10)}...`);
            
            // Use the new service for file token validation
            const validation = await InferenceService.validateFileToken(token);

            const { filePath } = validation;

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
                    "Content-Disposition": `attachment; filename="${filePath.split("/").pop()}"`
                });
                
                // Log the successful serving
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
               