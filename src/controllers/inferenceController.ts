import { Request, Response } from "express";
import { InferenceRepository } from "../repository/inferenceRepository";
import { DatasetRepository } from "../repository/datasetRepository";
import { InferenceBlackBoxProxy } from "../proxy/inferenceBlackBoxProxy";
import { InferenceMiddleware } from "../middleware/inferenceMiddleware";
import { loggerFactory, InferenceRouteLogger, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import jwt from "jsonwebtoken";
import { TokenService } from "../services/tokenService";

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

export class InferenceController {
    private static readonly inferenceRepository = InferenceRepository.getInstance();
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly blackBoxProxy = InferenceBlackBoxProxy.getInstance();
    private static readonly tokenService = TokenService.getInstance();
    private static readonly inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

    // Create a new inference with token management
    static async createInference(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        let tokenReservationId: string | undefined;

        try {
            const { datasetName, modelId = "default_inpainting", parameters = {} } = req.body;
            const userId = req.user!.userId;

            // Validate input and dataset
            const validationResult = await InferenceController.validateInferenceInput(userId, datasetName, modelId, parameters, res);
            if (!validationResult) return;

            const { dataset, datasetData, costCalc } = validationResult;

            // Reserve tokens
            const reservationResult = await InferenceController.handleTokenReservation(userId, costCalc, datasetName, res);
            if (!reservationResult.success) return;
            tokenReservationId = reservationResult.reservationId!;

            // Create inference record
            const inference = await InferenceController.inferenceRepository.createInference({
                modelId,
                parameters: { ...parameters, tokenReservationId, tokenCost: costCalc.totalCost },
                datasetId: dataset.id,
                userId
            });

            InferenceController.inferenceLogger.logInferenceCreation(inference.id, userId, datasetName, modelId);

            // Queue the inference job
            const proxyResult = await InferenceController.blackBoxProxy.processDataset(
                inference.id,
                userId,
                datasetData as Record<string, unknown>,
                { ...parameters, tokenReservationId, tokenCost: costCalc.totalCost }
            );

            if (proxyResult.success) {
                await InferenceController.handleProxySuccess(
                    req,
                    res,
                    userId,
                    costCalc,
                    { ...inference, parameters: inference.parameters ?? {} },
                    dataset,
                    proxyResult
                );
            } else {
                await InferenceController.handleProxyFailure(tokenReservationId, inference.id, proxyResult, res);
            }
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            await InferenceController.handleCreateInferenceError(tokenReservationId, error, req, res);
        }
    }

    private static async validateInferenceInput(
        userId: string,
        datasetName: string,
        modelId: string,
        parameters: Record<string, unknown>,
        res: Response
    ): Promise<null | { dataset: { id: string; name: string; data?: unknown }; datasetData: { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number; uploadIndex?: string | number }>; type?: string }; costCalc: { totalCost: number; breakdown: unknown } }> {
        const validation = await InferenceMiddleware.validateCreateInference(userId, {
            datasetName,
            modelId,
            parameters
        });

        if (!validation.success) {
            const statusCode = validation.error?.includes("not found") ? 404 : 400;
            InferenceController.errorLogger.logValidationError("inference", datasetName, validation.error || "Validation failed");
            res.status(statusCode).json({ error: validation.error });
            return null;
        }

        const dataset = await InferenceController.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

        if (!dataset) {
            InferenceController.errorLogger.logDatabaseError("CREATE_INFERENCE", "datasets", "Dataset not found");
            res.status(404).json({ error: "Dataset not found" });
            return null;
        }

        const datasetData = (dataset.data ?? {}) as {
            pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number; uploadIndex?: string | number }>;
            type?: string;
        };

        const costCalc = InferenceController.tokenService.calculateInferenceCost(datasetData);

        if (costCalc.totalCost === 0) {
            InferenceController.errorLogger.logValidationError("dataset", datasetName, "Dataset is empty or invalid");
            res.status(400).json({ error: "Dataset is empty or invalid for inference" });
            return null;
        }

        return { dataset, datasetData, costCalc };
    }

    private static async handleTokenReservation(
        userId: string,
        costCalc: { totalCost: number; breakdown: unknown },
        datasetName: string,
        res: Response
    ): Promise<{ success: boolean; reservationId?: string }> {
        const reservationResult = await InferenceController.tokenService.reserveTokens(
            userId,
            costCalc.totalCost,
            "inference",
            `${datasetName}_inference_${Date.now()}`
        );

        if (!reservationResult.success) {
            if (reservationResult.error?.includes("Insufficient tokens")) {
                const errorParts = /Required: ([\d.]+) tokens, Current balance: ([\d.]+) tokens, Shortfall: ([\d.]+) tokens/.exec(reservationResult.error);

                if (errorParts) {
                    const required = parseFloat(errorParts[1]);
                    const current = parseFloat(errorParts[2]);
                    const shortfall = parseFloat(errorParts[3]);
                    InferenceController.errorLogger.logAuthorizationError(userId, `Insufficient tokens for inference: ${required}`);
                    res.status(401).json({
                        error: "Insufficient tokens",
                        message: `You need ${required} tokens for this inference processing operation, but your current balance is ${current} tokens. You are short ${shortfall} tokens. Please contact an administrator to recharge your account.`,
                        details: {
                            requiredTokens: required,
                            currentBalance: current,
                            shortfall: shortfall,
                            operationType: "inference processing",
                            actionRequired: "Token recharge needed"
                        }
                    });
                } else {
                    InferenceController.errorLogger.logAuthorizationError(userId, `Insufficient tokens for inference: ${costCalc.totalCost}`);
                    res.status(401).json({
                        error: "Insufficient tokens",
                        message: reservationResult.error,
                        required: costCalc.totalCost,
                        breakdown: costCalc.breakdown
                    });
                }
            } else {
                InferenceController.errorLogger.logDatabaseError("RESERVE_TOKENS", "inference", reservationResult.error || "Token reservation failed");
                res.status(500).json({
                    error: "Token reservation failed",
                    message: reservationResult.error || "Failed to reserve tokens for this operation. Please try again."
                });
            }
            return { success: false };
        }
        return { success: true, reservationId: reservationResult.reservationId! };
    }

    private static async handleProxySuccess(
        req: AuthRequest,
        res: Response,
        userId: string,
        costCalc: { totalCost: number; breakdown: unknown },
        inference: {
            id: string;
            status: string;
            modelId: string;
            parameters: Record<string, unknown>;
            datasetId: string;
            userId: string;
            createdAt: string | Date;
            result?: unknown;
        },
        dataset: { id: string; name: string; data?: unknown },
        proxyResult: { success: boolean; jobId?: string; error?: string; status?: string; progress?: number; result?: unknown }
    ) {
        const balanceResult = await InferenceController.tokenService.getUserTokenBalance(userId);
        const userTokens = balanceResult.success ? balanceResult.balance || 0 : 0;

        req.operationResult = {
            tokensSpent: costCalc.totalCost,
            remainingBalance: userTokens,
            operationType: "inference"
        };

        req.tokenReservation = {
            reservationKey: inference.parameters.tokenReservationId as string,
            reservedAmount: costCalc.totalCost
        };

        res.status(201).json({
            success: true,
            message: "Inference created and queued successfully",
            inference: {
                id: inference.id,
                status: inference.status,
                modelId: inference.modelId,
                datasetName: dataset.name,
                createdAt: inference.createdAt,
                tokenCost: costCalc.totalCost,
                costBreakdown: costCalc.breakdown
            },
            jobId: proxyResult.jobId,
            tokenSpent: costCalc.totalCost,
            userTokens: userTokens
        });
    }

    private static async handleProxyFailure(
        tokenReservationId: string | undefined,
        inferenceId: string,
        proxyResult: { success: boolean; jobId?: string; error?: string; status?: string; progress?: number; result?: unknown },
        res: Response
    ) {
        try {
            if (tokenReservationId) {
                const refundResult = await InferenceController.tokenService.refundTokens(tokenReservationId);
                if (!refundResult.success) {
                    InferenceController.errorLogger.logDatabaseError("REFUND_TOKENS", "controller", refundResult.error || "Failed to refund tokens");
                }
            }
        } catch (refundError) {
            const refundErr = refundError instanceof Error ? refundError : new Error("Unknown refund error");
            InferenceController.errorLogger.logDatabaseError("REFUND_TOKENS", "controller", refundErr.message);
        }

        await InferenceController.inferenceRepository.updateInferenceStatus(
            inferenceId,
            "ABORTED",
            { error: proxyResult.error, reason: "queue_failed" }
        );

        InferenceController.errorLogger.logDatabaseError("CREATE_INFERENCE", "inference_queue", proxyResult.error || "Failed to queue job");
        res.status(500).json({
            error: proxyResult.error || "Failed to queue inference job"
        });
    }

    private static async handleCreateInferenceError(
        tokenReservationId: string | undefined,
        error: unknown,
        req: AuthRequest,
        res: Response
    ) {
        if (tokenReservationId) {
            try {
                const refundResult = await InferenceController.tokenService.refundTokens(tokenReservationId);
                if (!refundResult.success) {
                    InferenceController.errorLogger.logDatabaseError("REFUND_TOKENS", "controller", refundResult.error || "Failed to refund tokens");
                }
            } catch (refundError) {
                const refundErr = refundError instanceof Error ? refundError : new Error("Unknown refund error");
                InferenceController.errorLogger.logDatabaseError("REFUND_TOKENS", "controller", refundErr.message);
            }
        }

        const err = error instanceof Error ? error : new Error("Unknown error");
        InferenceController.errorLogger.logDatabaseError("CREATE_INFERENCE", "inferences", err.message);
        InferenceController.apiLogger.logError(req, err);
        res.status(500).json({ error: "Internal server error" });
    }

    // Get job status by job ID
    static async getJobStatus(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            const { jobId } = req.params;

            const jobStatus = await InferenceController.blackBoxProxy.getJobStatus(jobId);

            if (!jobStatus.success) {
                InferenceController.errorLogger.logDatabaseError("GET_JOB_STATUS", "inference_jobs", jobStatus.error || "Job not found");
                res.status(404).json({ error: jobStatus.error || "Job not found" });
                return;
            }

            InferenceController.inferenceLogger.logInferenceStatusCheck(jobId);
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
            const err = error instanceof Error ? error : new Error("Unknown error");
            InferenceController.errorLogger.logDatabaseError("GET_JOB_STATUS", "inference_jobs", err.message);
            InferenceController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get all user inferences
    static async getUserInferences(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

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
            const err = error instanceof Error ? error : new Error("Unknown error");
            InferenceController.errorLogger.logDatabaseError("GET_USER_INFERENCES", "inferences", err.message);
            InferenceController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get specific inference
    static async getInference(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(id, userId);

            if (!inference) {
                InferenceController.errorLogger.logDatabaseError("GET_INFERENCE", "inferences", "Inference not found");
                res.status(404).json({ error: "Inference not found" });
                return;
            }

            InferenceController.inferenceLogger.logInferenceRetrieval(id, userId);
            res.status(200).json({
                success: true,
                message: "Inference retrieved successfully",
                data: inference
            });
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            InferenceController.errorLogger.logDatabaseError("GET_INFERENCE", "inferences", err.message);
            InferenceController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get inference results with download links
    static async getInferenceResults(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { id } = req.params;

            const inference = await InferenceController.inferenceRepository.getInferenceByIdAndUserId(id, userId);

            if (!inference) {
                InferenceController.errorLogger.logDatabaseError("GET_INFERENCE_RESULTS", "inferences", "Inference not found");
                res.status(404).json({ error: "Inference not found" });
                return;
            }

            if (inference.status !== "COMPLETED") {
                InferenceController.errorLogger.logValidationError("inference_status", inference.status, "Inference not completed");
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
            const err = error instanceof Error ? error : new Error("Unknown error");
            InferenceController.errorLogger.logDatabaseError("GET_INFERENCE_RESULTS", "inferences", err.message);
            InferenceController.apiLogger.logError(req, err);
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

    static async serveOutputFile(req: Request, res: Response): Promise<void> {
        const startTime = Date.now();
        InferenceController.apiLogger.logRequest(req);

        try {
            const token = decodeURIComponent(req.params.token);
            
            // Use middleware to validate file token (replaces the original validation)
            const validation = await InferenceMiddleware.validateFileToken(token);
            
            if (!validation.success) {
                const statusCode = validation.error?.includes("Access denied") ? 403 : 401;
                InferenceController.errorLogger.logAuthenticationError(undefined, validation.error || "Token validation failed");
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
                
                InferenceController.inferenceLogger.logOutputFileServed(filePath!);
                res.send(fileBuffer);
            // Catching file read errors to log and return a 404 response to the client
            } catch (fileError) {
                const errMsg = fileError instanceof Error ? fileError.message : "Output file not found";
                InferenceController.errorLogger.logDatabaseError("SERVE_OUTPUT_FILE", "file_system", errMsg);
                res.status(404).json({ error: "File not found", details: errMsg });
            }
            InferenceController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            InferenceController.errorLogger.logDatabaseError("SERVE_OUTPUT_FILE", "file_system", err.message);
            InferenceController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
        