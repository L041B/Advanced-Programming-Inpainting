import { Request, Response } from "express";
import { InferenceRepository } from "../repository/inferenceRepository";
import { DatasetRepository } from "../repository/datasetRepository";
import { InferenceBlackBoxProxy } from "../proxy/inferenceBlackBoxProxy";
import { InferenceMiddleware } from "../middleware/inferenceMiddleware";
import logger from "../utils/logger";
import jwt from "jsonwebtoken";

interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

export class InferenceController {
    private static readonly inferenceRepository = InferenceRepository.getInstance();
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly blackBoxProxy = InferenceBlackBoxProxy.getInstance();

    // Create a new inference
    static async createInference(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { datasetName, modelId = "default_inpainting", parameters = {} } = req.body;
            const userId = req.user!.userId;

            // Use middleware to validate input
            const validation = await InferenceMiddleware.validateCreateInference(userId, {
                datasetName,
                modelId,
                parameters
            });

            if (!validation.success) {
                const statusCode = validation.error?.includes("not found") ? 404 : 400;
                res.status(statusCode).json({ error: validation.error });
                return;
            }

            // Create inference record
            const inference = await InferenceController.inferenceRepository.createInference({
                modelId,
                parameters,
                datasetName,
                userId
            });

            // Get dataset data
            const dataset = await InferenceController.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
            
            if (!dataset) {
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            // Use proxy to queue the inference job instead of direct processing
            const proxyResult = await InferenceController.blackBoxProxy.processDataset(
                inference.id,
                userId,
                (dataset.data ?? {}) as Record<string, unknown>,
                parameters
            );

            if (proxyResult.success) {
                res.status(201).json({
                    success: true,
                    message: "Inference created and queued successfully",
                    inference: {
                        id: inference.id,
                        status: inference.status,
                        modelId: inference.modelId,
                        datasetName: inference.datasetName,
                        createdAt: inference.createdAt
                    },
                    jobId: proxyResult.jobId
                });
            } else {
                // Update inference status to FAILED if queuing failed
                await InferenceController.inferenceRepository.updateInferenceStatus(
                    inference.id, 
                    "FAILED", 
                    { error: proxyResult.error }
                );
                
                res.status(500).json({ 
                    error: proxyResult.error || "Failed to queue inference job" 
                });
            }
        } catch (error) {
            logger.error("Error creating inference", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get job status by job ID
    static async getJobStatus(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { jobId } = req.params;

            const jobStatus = await InferenceController.blackBoxProxy.getJobStatus(jobId);

            if (!jobStatus.success) {
                res.status(404).json({ error: jobStatus.error || "Job not found" });
                return;
            }

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
        } catch (error) {
            logger.error("Error retrieving job status", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get all user inferences
    static async getUserInferences(req: AuthRequest, res: Response): Promise<void> {
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
        } catch (error) {
            logger.error("Error retrieving user inferences", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get specific inference
    static async getInference(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(id, userId);

            if (!inference) {
                res.status(404).json({ error: "Inference not found" });
                return;
            }

            res.status(200).json({
                success: true,
                message: "Inference retrieved successfully",
                data: inference
            });
        } catch (error) {
            logger.error("Error retrieving inference", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get inference results with download links
    static async getInferenceResults(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(id, userId);

            if (!inference) {
                res.status(404).json({ error: "Inference not found" });
                return;
            }

            if (inference.status !== "COMPLETED") {
                res.status(400).json({ 
                    error: "Inference not completed", 
                    status: inference.status 
                });
                return;
            }

            // Generate temporary access tokens for output files
            const result = inference.result as { 
                images?: Array<{ originalPath: string; outputPath: string }>;
                videos?: Array<{ originalVideoId: string; outputPath: string }>;
            };

            const baseUrl = `${req.protocol}://${req.get("host")}`;
            
            // Generate tokens for images
            const images = await Promise.all((result.images || []).map(async (img) => {
                const token = await InferenceController.generateFileToken(userId, img.outputPath);
                return {
                    originalPath: img.originalPath,
                    outputPath: img.outputPath,
                    downloadUrl: `${baseUrl}/api/inferences/output/${token}`
                };
            }));

            // Generate tokens for videos
            const videos = await Promise.all((result.videos || []).map(async (vid) => {
                const token = await InferenceController.generateFileToken(userId, vid.outputPath);
                return {
                    originalVideoId: vid.originalVideoId,
                    outputPath: vid.outputPath,
                    downloadUrl: `${baseUrl}/api/inferences/output/${token}`
                };
            }));

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
        } catch (error) {
            logger.error("Error retrieving inference results", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
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

    // Serve output files
    static async serveOutputFile(req: Request, res: Response): Promise<void> {
        try {
            const token = decodeURIComponent(req.params.token);
            
            // Use middleware to validate file token (replaces the original validation)
            const validation = await InferenceMiddleware.validateFileToken(token);
            
            if (!validation.success) {
                const statusCode = validation.error?.includes("Access denied") ? 403 : 401;
                res.status(statusCode).json({ error: validation.error });
                return;
            }

            const { filePath } = validation;

            const { FileStorage } = await import("../utils/fileStorage");
            
            try {
                const fileBuffer = await FileStorage.readFile(filePath!);
                const ext = filePath!.toLowerCase().split(".").pop();
                
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

                res.set({
                    "Content-Type": contentType,
                    "Content-Length": fileBuffer.length.toString(),
                    "Content-Disposition": `attachment; filename="${filePath!.split("/").pop()}"`
                });
                
                res.send(fileBuffer);
            } catch (fileError) {
                res.status(404).json({ error: "File not found" });
            }
        } catch (error) {
            logger.error("Error serving output file", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }
}

