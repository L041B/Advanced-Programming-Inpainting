import { Request, Response } from "express";
import { DatasetMiddleware } from "../middleware/datasetMiddleware";
import { DatasetRepository } from "../repository/datasetRepository";
import { loggerFactory, DatasetRouteLogger, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

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

interface TokenReservationDetails {
    requiredTokens: number;
    currentBalance: number;
    shortfall: number;
    operationType: string;
    actionRequired: string;
}

export class DatasetController {
    private static datasetRepository = DatasetRepository.getInstance();
    private static readonly datasetLogger: DatasetRouteLogger = loggerFactory.createDatasetLogger();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

    // Create an empty dataset
    static async createEmptyDataset(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const { name, tags } = req.body;
            const userId = req.user!.userId;

            if (!name || typeof name !== "string") {
                DatasetController.errorLogger.logValidationError("name", name, "Dataset name is required");
                res.status(400).json({ error: "Dataset name is required" });
                return;
            }

            const result = await DatasetMiddleware.createEmptyDataset(userId, name, tags);
            
            if (result.success) {
                DatasetController.datasetLogger.logDatasetCreation(userId, name);
                res.status(201).json({ 
                    message: "Empty dataset created successfully",
                    dataset: result.dataset 
                });
            } else {
                // Remove duplicate logging - middleware already logs this error
                res.status(400).json({ error: result.error });
            }
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("CREATE_DATASET", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Upload data to dataset (images, videos, zip files)
    static async uploadDataToDataset(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const { datasetName } = req.body;
            const userId = req.user!.userId;
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            if (!datasetName || typeof datasetName !== "string") {
                DatasetController.errorLogger.logValidationError("datasetName", datasetName, "Dataset name is required");
                res.status(400).json({ error: "Dataset name is required" });
                return;
            }

            if (!files || !files.image || !files.mask) {
                DatasetController.errorLogger.logFileUploadError(undefined, undefined, "Both image and mask files are required");
                res.status(400).json({ error: "Both image and mask files are required" });
                return;
            }

            const imageFile = files.image[0];
            const maskFile = files.mask[0];

            DatasetController.datasetLogger.logFileUpload(userId, datasetName, imageFile.originalname, imageFile.size);

            const result = await DatasetMiddleware.processAndAddData(
                userId, 
                datasetName, 
                imageFile, 
                maskFile
            );

            if (result.success) {
                let tokenSpent = 0;
                let userTokens = 0;

                // Se abbiamo una reservationId dal middleware, confermiamo l'uso dei token
                if (result.reservationId) {
                    const { TokenService } = await import("../services/tokenService");
                    const tokenService = TokenService.getInstance();
                    
                    const confirmResult = await tokenService.confirmTokenUsage(result.reservationId);
                    
                    if (confirmResult.success) {
                        // Usa i valori REALI dalla transazione completata
                        tokenSpent = confirmResult.tokensSpent || 0;
                        userTokens = confirmResult.remainingBalance || 0;
                    } else {
                        // Fallback: recupera l'importo dall'ultima transazione dell'utente
                        const transactionHistoryResult = await tokenService.getUserTransactionHistory(userId, 1);
                        
                        if (transactionHistoryResult.success && transactionHistoryResult.transactions && transactionHistoryResult.transactions.length > 0) {
                            const lastTransaction = transactionHistoryResult.transactions[0];
                            // Converti l'amount in valore positivo per tokenSpent
                            tokenSpent = Math.abs(Number(lastTransaction.amount));
                        }
                        
                        const balanceResult = await tokenService.getUserTokenBalance(userId);
                        userTokens = balanceResult.success ? balanceResult.balance || 0 : 0;
                    }
                    
                    req.operationResult = {
                        tokensSpent: tokenSpent,
                        remainingBalance: userTokens,
                        operationType: "dataset_upload"
                    };

                    req.tokenReservation = {
                        reservationKey: result.reservationId,
                        reservedAmount: tokenSpent
                    };
                } else {
                    // Se non c'è reservationId, cerca comunque l'ultima transazione per vedere se ci sono stati addebiti
                    const { TokenService } = await import("../services/tokenService");
                    const tokenService = TokenService.getInstance();
                    
                    const transactionHistoryResult = await tokenService.getUserTransactionHistory(userId, 1);
                    if (transactionHistoryResult.success && transactionHistoryResult.transactions && transactionHistoryResult.transactions.length > 0) {
                        const lastTransaction = transactionHistoryResult.transactions[0];
                        // Controlla se è una transazione di dataset_upload recente (ultimi 5 secondi)
                        const transactionTime = new Date(lastTransaction.createdAt).getTime();
                        const now = Date.now();
                        
                        if (lastTransaction.operationType === "dataset_upload" && (now - transactionTime) < 5000) {
                            tokenSpent = Math.abs(Number(lastTransaction.amount));
                        }
                    }
                    
                    const balanceResult = await tokenService.getUserTokenBalance(userId);
                    userTokens = balanceResult.success ? balanceResult.balance || 0 : 0;
                }

                DatasetController.datasetLogger.logDatasetUpdate(userId, datasetName, result.processedItems);
                
                // Includi sempre tokenSpent e userTokens nella risposta
                res.status(200).json({ 
                    message: "Data uploaded and processed successfully",
                    processedItems: result.processedItems,
                    tokenSpent: tokenSpent,
                    userTokens: userTokens
                });
            } else {
                // Handle detailed error responses from middleware
                if (result.details) {
                    res.status(401).json({ 
                        error: result.error,
                        message: result.message,
                        details: result.details
                    });
                } else if (result.message) {
                    res.status(400).json({ 
                        error: result.error,
                        message: result.message
                    });
                } else {
                    res.status(400).json({ error: result.error });
                }
            }
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("UPLOAD_DATASET_DATA", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get all datasets for the authenticated user
    static async getUserDatasets(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { includeDeleted = "false" } = req.query;

            // Determina se includere i dataset eliminati
            const datasets = includeDeleted === "true" 
                ? await DatasetController.datasetRepository.getAllUserDatasetsIncludingDeleted(userId)
                : await DatasetController.datasetRepository.getUserDatasets(userId);

            const datasetsWithCount = datasets.map((dataset) => {
                const data = (dataset.data ?? {}) as { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>; type?: string };
                const itemCount = data.pairs?.length || 0;
                
                return {
                    userId: dataset.userId,
                    name: dataset.name,
                    tags: dataset.tags,
                    createdAt: dataset.createdAt,
                    updatedAt: dataset.updatedAt,
                    itemCount,
                    type: data.type || "empty",
                    isDeleted: dataset.isDeleted, // Includi sempre il flag isDeleted
                    status: dataset.isDeleted ? "deleted" : "active" // Status leggibile
                };
            });

            interface DatasetWithCount {
                userId: string | null;
                name: string;
                tags: string[];
                createdAt: Date;
                updatedAt: Date;
                itemCount: number;
                type: string;
                isDeleted: boolean;
                status: string;
            }

            const activeDatasets: DatasetWithCount[] = datasetsWithCount.filter((d: DatasetWithCount) => !d.isDeleted);
            const deletedDatasets: DatasetWithCount[] = datasetsWithCount.filter((d: DatasetWithCount) => d.isDeleted);

            DatasetController.datasetLogger.logUserDatasetsRetrieval(userId, datasets.length);
            res.status(200).json({ 
                success: true,
                message: "Datasets retrieved successfully",
                data: datasetsWithCount,
                summary: {
                    total: datasetsWithCount.length,
                    active: activeDatasets.length,
                    deleted: deletedDatasets.length,
                    includeDeleted: includeDeleted === "true"
                }
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("GET_USER_DATASETS", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get a specific dataset by name
    static async getDataset(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { name } = req.params;

            const dataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, name);

            if (!dataset) {
                DatasetController.errorLogger.logDatabaseError("GET_DATASET", "datasets", "Dataset not found");
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            interface DatasetData {
                pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>;
                type?: string;
            }
            const data = dataset.data as DatasetData;
            const itemCount = data?.pairs?.length || 0;

            DatasetController.datasetLogger.logDatasetRetrieval(userId, name);
            res.status(200).json({ 
                success: true,
                message: "Dataset retrieved successfully",
                data: {
                    userId: dataset.userId,
                    name: dataset.name,
                    tags: dataset.tags,
                    createdAt: dataset.createdAt,
                    updatedAt: dataset.updatedAt,
                    itemCount,
                    type: data?.type || "empty"
                }
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("GET_DATASET", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get dataset data/contents with viewable image URLs
    static async getDatasetData(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { name } = req.params;
            const { page = 1, limit = 10 } = req.query;

            const dataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, name);

            if (!dataset) {
                DatasetController.errorLogger.logDatabaseError("GET_DATASET_DATA", "datasets", "Dataset not found");
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            interface DatasetData {
                pairs?: Array<{ 
                    imagePath: string; 
                    maskPath: string; 
                    frameIndex?: number; 
                    uploadIndex: number; 
                }>;
                type?: string;
            }
            const data = dataset.data as DatasetData;
            const pairs = data?.pairs || [];
            
            // Pagination
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const startIndex = (pageNum - 1) * limitNum;
            const endIndex = startIndex + limitNum;
            
            const paginatedPairs = pairs.slice(startIndex, endIndex);

            // Generate temporary access tokens for images (valid for 1 hour)
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            const items = await Promise.all(paginatedPairs.map(
                async (pair: { 
                    imagePath: string; 
                    maskPath: string; 
                    frameIndex?: number; 
                    uploadIndex: number;
                }, index: number) => {
                    const imageToken = await DatasetController.generateImageToken(userId, pair.imagePath);
                    const maskToken = await DatasetController.generateImageToken(userId, pair.maskPath);
                    
                    return {
                        index: startIndex + index,
                        imagePath: pair.imagePath,
                        maskPath: pair.maskPath,
                        imageUrl: `${baseUrl}/api/datasets/image/${imageToken}`,
                        maskUrl: `${baseUrl}/api/datasets/image/${maskToken}`,
                        frameIndex: pair.frameIndex || null,
                        uploadIndex: pair.uploadIndex // Include upload index in response
                    };
                }
            ));

            DatasetController.datasetLogger.logDatasetRetrieval(userId, name);
            res.status(200).json({ 
                success: true,
                message: "Dataset data retrieved successfully",
                data: {
                    name: dataset.name,
                    type: data?.type || "unknown",
                    totalItems: pairs.length,
                    currentPage: pageNum,
                    totalPages: Math.ceil(pairs.length / limitNum),
                    itemsPerPage: limitNum,
                    items
                }
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("GET_DATASET_DATA", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Generate temporary token for image access (1 hour expiry)
    private static async generateImageToken(userId: string, imagePath: string): Promise<string> {
        const jwt = await import("jsonwebtoken");
        const token = jwt.default.sign(
            { 
                userId, 
                imagePath, 
                type: "image_access" 
            },
            process.env.JWT_SECRET || "fallback_secret",
            { expiresIn: "1h" }
        );
        return encodeURIComponent(token);
    }

    // Serve individual images from dataset with temporary token
    static async serveImage(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const token = decodeURIComponent(req.params.imagePath);
            
            // Verify the temporary token
            const jwt = await import("jsonwebtoken");
            interface ImageTokenPayload {
                userId: string;
                imagePath: string;
                type: string;
                iat?: number;
                exp?: number;
            }
            let decoded: ImageTokenPayload;
            try {
                const verifyResult = jwt.default.verify(token, process.env.JWT_SECRET || "fallback_secret");
                if (typeof verifyResult === "string") {
                    DatasetController.errorLogger.logAuthenticationError(undefined, "Invalid image token format");
                    res.status(401).json({ error: "Invalid or expired image token" });
                    return;
                }
                decoded = verifyResult as ImageTokenPayload;
            } catch (error) {
                DatasetController.errorLogger.logAuthenticationError(undefined, "Image token verification failed");
                DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Token verification failed"));
                res.status(401).json({ error: "Invalid or expired image token" });
                return;
            }

            const { userId, imagePath } = decoded;

            // Security check: ensure the path belongs to the user
            if (!imagePath.startsWith(`datasets/${userId}/`)) {
                DatasetController.errorLogger.logAuthorizationError(userId, imagePath);
                res.status(403).json({ error: "Access denied" });
                return;
            }

            // Import FileStorage dynamically to avoid circular dependencies
            const { FileStorage } = await import("../utils/fileStorage");
            
            try {
                const imageBuffer = await FileStorage.readFile(imagePath);
                const ext = imagePath.toLowerCase().split(".").pop();
                
                // Set appropriate content type
                let contentType = "image/png";
                if (ext === "jpg" || ext === "jpeg") {
                    contentType = "image/jpeg";
                } else if (ext === "png") {
                    contentType = "image/png";
                }

                res.set({
                    "Content-Type": contentType,
                    "Content-Length": imageBuffer.length.toString(),
                    "Cache-Control": "public, max-age=3600" // Cache for 1 hour
                });
                
                DatasetController.datasetLogger.logImageServed(userId, imagePath);
                res.send(imageBuffer);
            } catch (fileError) {
                DatasetController.errorLogger.logDatabaseError("SERVE_IMAGE", "file_system", "Image file not found");
                res.status(404).json({ error: "Image not found" });
            }
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("SERVE_IMAGE", "file_system", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Delete a dataset
    static async deleteDataset(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { name } = req.params;

            const success = await DatasetController.datasetRepository.deleteDataset(userId, name);

            if (!success) {
                DatasetController.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", "Dataset not found");
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            DatasetController.datasetLogger.logDatasetDeletion(userId, name);
            res.status(200).json({
                success: true,
                message: "Dataset deleted successfully"
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Reserve tokens with EXACT calculated cost
    private static async reserveTokens(userId: string, tokenCost: number, operationType: "dataset_upload" | "inference", datasetName: string): Promise<{ success: boolean; error?: string; message?: string; details?: TokenReservationDetails }> {
        const { TokenService } = await import("../services/tokenService");
        const tokenService = TokenService.getInstance();

        // Effettua la prenotazione dei token necessari per l'operazione
        const reservationResult = await tokenService.reserveTokens(
            userId,
            tokenCost,
            operationType,
            `${datasetName}_${Date.now()}`
        );

        if (!reservationResult.success) {
            if (reservationResult.error?.includes("Insufficient tokens")) {
                // Parse the detailed error message from TokenService
                const errorParts = reservationResult.error.match(/Required: ([\d.]+) tokens, Current balance: ([\d.]+) tokens, Shortfall: ([\d.]+) tokens/);

                if (errorParts) {
                    const required = parseFloat(errorParts[1]);
                    const current = parseFloat(errorParts[2]);
                    const shortfall = parseFloat(errorParts[3]);

                    DatasetController.errorLogger.logAuthorizationError(userId, `Insufficient tokens for dataset upload: ${required}`);
                    return {
                        success: false,
                        error: "Insufficient tokens",
                        message: `You need ${required} tokens for this dataset upload operation, but your current balance is ${current} tokens. You are short ${shortfall} tokens. Please contact an administrator to recharge your account.`,
                        details: {
                            requiredTokens: required,
                            currentBalance: current,
                            shortfall: shortfall,
                            operationType: "dataset upload",
                            actionRequired: "Token recharge needed"
                        }
                    };
                } else {
                    // Fallback to the original detailed error message
                    DatasetController.errorLogger.logAuthorizationError(userId, `Insufficient tokens for dataset upload: ${tokenCost}`);
                    return {
                        success: false,
                        error: "Insufficient tokens",
                        message: reservationResult.error
                    };
                }
            }

            DatasetController.errorLogger.logDatabaseError("RESERVE_TOKENS", "dataset_upload", reservationResult.error || "Token reservation failed");
            return {
                success: false,
                error: "Token reservation failed",
                message: reservationResult.error || "Failed to reserve tokens for this operation. Please try again."
            };
        }

        return { success: true };
    }

    // Update dataset metadata (name, tags) with name conflict validation
    static async updateDataset(req: AuthRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const currentName = req.params.name;
            const { name: newName, tags } = req.body;

            if (!newName && !tags) {
                DatasetController.errorLogger.logValidationError("updateData", "missing", "At least one field (name or tags) must be provided");
                res.status(400).json({ error: "At least one field (name or tags) must be provided for update" });
                return;
            }

            // Get current dataset to verify it exists
            const currentDataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, currentName);
            if (!currentDataset) {
                DatasetController.errorLogger.logDatabaseError("UPDATE_DATASET", "datasets", "Dataset not found");
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            // If name is being changed, verify no conflict with existing datasets
            if (newName && newName !== currentName) {
                if (typeof newName !== "string" || newName.trim().length === 0) {
                    DatasetController.errorLogger.logValidationError("name", newName, "Dataset name must be a non-empty string");
                    res.status(400).json({ error: "Dataset name must be a non-empty string" });
                    return;
                }

                // Check for name conflicts with other user's datasets
                const nameConflict = await DatasetController.datasetRepository.datasetExists(userId, newName.trim());
                if (nameConflict) {
                    DatasetController.errorLogger.logValidationError("name", newName, "Dataset with this name already exists");
                    res.status(409).json({ 
                        error: "Dataset name conflict",
                        message: `A dataset named '${newName.trim()}' already exists in your account. Please choose a different name.`,
                        conflictingName: newName.trim(),
                        currentName: currentName
                    });
                    return;
                }
            }

            // Validate tags if provided
            if (tags !== undefined) {
                if (!Array.isArray(tags)) {
                    DatasetController.errorLogger.logValidationError("tags", typeof tags, "Tags must be an array");
                    res.status(400).json({ error: "Tags must be an array of strings" });
                    return;
                }

                // Validate each tag
                for (const tag of tags) {
                    if (typeof tag !== "string" || tag.trim().length === 0) {
                        DatasetController.errorLogger.logValidationError("tags", tag, "Each tag must be a non-empty string");
                        res.status(400).json({ 
                            error: "Invalid tag format",
                            message: "Each tag must be a non-empty string",
                            invalidTag: tag
                        });
                        return;
                    }
                }
            }

            // Prepare update data
            const updateData: { name?: string; tags?: string[] } = {};
            if (newName && newName !== currentName) {
                updateData.name = newName.trim();
            }
            if (tags !== undefined) {
                updateData.tags = tags.map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
            }

            // Perform the update
            const updatedDataset = await DatasetController.datasetRepository.updateDataset(userId, currentName, updateData);

            DatasetController.datasetLogger.logDatasetUpdate(userId, currentName, 0); // 0 items as this is metadata update
            
            // Prepare response data
            const datasetData = updatedDataset.data as { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>; type?: string } | null;
            const itemCount = datasetData?.pairs?.length || 0;

            res.status(200).json({
                success: true,
                message: "Dataset updated successfully",
                data: {
                    userId: updatedDataset.userId,
                    name: updatedDataset.name,
                    tags: updatedDataset.tags,
                    itemCount,
                    type: datasetData?.type || "empty",
                    createdAt: updatedDataset.createdAt,
                    updatedAt: updatedDataset.updatedAt,
                    changes: {
                        nameChanged: newName && newName !== currentName,
                        tagsChanged: tags !== undefined,
                        previousName: newName && newName !== currentName ? currentName : undefined
                    }
                }
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("UPDATE_DATASET", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }
}
