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

interface UploadResult {
    success: boolean;
    processedItems: number;
    reservationId?: string;
    error?: string;
    message?: string;
    details?: TokenReservationDetails;
}

export class DatasetController {
    private static readonly datasetRepository = DatasetRepository.getInstance();
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
                // Remove duplicate log - middleware already logs dataset creation
                res.status(201).json({ 
                    message: "Empty dataset created successfully",
                    dataset: result.dataset 
                });
            } else {
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
            const validationResult = DatasetController.validateUploadRequest(req);
            if (!validationResult.valid) {
                res.status(400).json({ error: validationResult.error });
                return;
            }

            const { datasetName, userId, imageFile, maskFile } = validationResult.data!;
            DatasetController.datasetLogger.logFileUpload(userId, datasetName, imageFile.originalname, imageFile.size);

            const result = await DatasetMiddleware.processAndAddData(userId, datasetName, imageFile, maskFile);

            // Ensure processedItems is always a number
            if (result.success) {
                // If processedItems is undefined, default to 0
                if (typeof result.processedItems !== "number") {
                    result.processedItems = 0;
                }
                await DatasetController.handleSuccessfulUpload(req, result as UploadResult, userId);
                res.status(200).json({ 
                    message: "Data uploaded and processed successfully",
                    processedItems: result.processedItems,
                    tokenSpent: req.operationResult?.tokensSpent || 0,
                    userTokens: req.operationResult?.remainingBalance || 0
                });
            } else {
                // If processedItems is undefined, default to 0 for error case as well
                if (typeof result.processedItems !== "number") {
                    // Type assertion to satisfy UploadResult interface
                    (result as UploadResult).processedItems = 0;
                }
                DatasetController.handleUploadError(result as UploadResult, res);
            }
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("UPLOAD_DATASET_DATA", "datasets", err.message);
            DatasetController.apiLogger.logError(req, err);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    private static validateUploadRequest(req: AuthRequest): { valid: boolean; error?: string; data?: { datasetName: string; userId: string; imageFile: Express.Multer.File; maskFile: Express.Multer.File } } {
        const { datasetName } = req.body;
        const userId = req.user!.userId;
        const files = req.files as { [fieldname: string]: Express.Multer.File[] };

        if (!datasetName || typeof datasetName !== "string") {
            DatasetController.errorLogger.logValidationError("datasetName", datasetName, "Dataset name is required");
            return { valid: false, error: "Dataset name is required" };
        }

        if (!files?.image || !files?.mask) {
            DatasetController.errorLogger.logFileUploadError(undefined, undefined, "Both image and mask files are required");
            return { valid: false, error: "Both image and mask files are required" };
        }

        return {
            valid: true,
            data: {
                datasetName,
                userId,
                imageFile: files.image[0],
                maskFile: files.mask[0]
            }
        };
    }

    private static async handleSuccessfulUpload(req: AuthRequest, result: UploadResult, userId: string): Promise<void> {
        const tokenInfo = await DatasetController.processTokenTransaction(result, userId);
        
        req.operationResult = {
            tokensSpent: tokenInfo.tokenSpent,
            remainingBalance: tokenInfo.userTokens,
            operationType: "dataset_upload"
        };

        if (result.reservationId) {
            req.tokenReservation = {
                reservationKey: result.reservationId,
                reservedAmount: tokenInfo.tokenSpent
            };
        }

        // Remove duplicate log - middleware already logs dataset update
    }

    private static async processTokenTransaction(result: UploadResult, userId: string): Promise<{ tokenSpent: number; userTokens: number }> {
        const { TokenService } = await import("../services/tokenService");
        const tokenService = TokenService.getInstance();

        if (result.reservationId) {
            return await DatasetController.handleTokenReservation(tokenService, result.reservationId, userId);
        } else {
            return await DatasetController.handleTokenFallback(tokenService, userId);
        }
    }

    private static async handleTokenReservation(tokenService: import("../services/tokenService").TokenService, reservationId: string, userId: string): Promise<{ tokenSpent: number; userTokens: number }> {
        const confirmResult = await tokenService.confirmTokenUsage(reservationId);
        
        if (confirmResult.success) {
            return {
                tokenSpent: confirmResult.tokensSpent || 0,
                userTokens: confirmResult.remainingBalance || 0
            };
        } else {
            return await DatasetController.getTokenInfoFromTransaction(tokenService, userId);
        }
    }

    private static async handleTokenFallback(tokenService: import("../services/tokenService").TokenService, userId: string): Promise<{ tokenSpent: number; userTokens: number }> {
        const transactionResult = await DatasetController.getTokenInfoFromTransaction(tokenService, userId);
        const balanceResult = await tokenService.getUserTokenBalance(userId);
        
        return {
            tokenSpent: transactionResult.tokenSpent,
            userTokens: balanceResult.success ? balanceResult.balance || 0 : 0
        };
    }

    private static async getTokenInfoFromTransaction(tokenService: import("../services/tokenService").TokenService, userId: string): Promise<{ tokenSpent: number; userTokens: number }> {
        const transactionHistoryResult = await tokenService.getUserTransactionHistory(userId, 1);
        let tokenSpent = 0;

        if (transactionHistoryResult.success && transactionHistoryResult.transactions && transactionHistoryResult.transactions.length > 0) {
            const lastTransaction = transactionHistoryResult.transactions[0];
            
            if (lastTransaction.operationType === "dataset_upload") {
                const transactionTime = new Date(lastTransaction.createdAt).getTime();
                const now = Date.now();
                
                if ((now - transactionTime) < 5000) {
                    tokenSpent = Math.abs(Number(lastTransaction.amount));
                }
            }
        }

        const balanceResult = await tokenService.getUserTokenBalance(userId);
        const userTokens = balanceResult.success ? balanceResult.balance || 0 : 0;

        return { tokenSpent, userTokens };
    }

    private static handleUploadError(result: UploadResult, res: Response): void {
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
                    isDeleted: dataset.isDeleted,
                    status: dataset.isDeleted ? "deleted" : "active"
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

            // Remove duplicate log - repository already logs this
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

            // Remove duplicate log - repository already logs this
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
                        uploadIndex: pair.uploadIndex
                    };
                }
            ));

            // Remove duplicate log - repository already logs this
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
                }

                res.set({
                    "Content-Type": contentType,
                    "Content-Length": imageBuffer.length.toString(),
                    "Cache-Control": "public, max-age=3600"
                });
                
                // Remove duplicate log - this is too granular for main logs
                res.send(imageBuffer);
            } catch (fileError) {
                DatasetController.errorLogger.logDatabaseError("SERVE_IMAGE", "file_system", fileError instanceof Error ? fileError.message : "Image file not found");
                DatasetController.apiLogger.logError(req, fileError instanceof Error ? fileError : new Error("Image file not found"));
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
                const regex = /Required: ([\d.]+) tokens, Current balance: ([\d.]+) tokens, Shortfall: ([\d.]+) tokens/;
                const errorParts = regex.exec(reservationResult.error);

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

            // Validate input
            const validationError = DatasetController.validateUpdateInput(newName, tags);
            if (validationError) {
                DatasetController.errorLogger.logValidationError("updateData", "invalid", validationError);
                res.status(400).json({ error: validationError });
                return;
            }

            // Get current dataset to verify it exists
            const currentDataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, currentName);
            if (!currentDataset) {
                DatasetController.errorLogger.logDatabaseError("UPDATE_DATASET", "datasets", "Dataset not found");
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            // Validate name change
            const nameConflictError = await DatasetController.validateNameChange(userId, currentName, newName);
            if (nameConflictError) {
                res.status(nameConflictError.status).json(nameConflictError.body);
                return;
            }

            // Validate tags
            const tagsError = DatasetController.validateTags(tags);
            if (tagsError) {
                res.status(tagsError.status).json(tagsError.body);
                return;
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

            // Remove duplicate log - repository already logs this
            
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

    private static validateUpdateInput(newName: string | undefined, tags: string[] | undefined): string | null {
        if (!newName && !tags) {
            return "At least one field (name or tags) must be provided for update";
        }
        return null;
    }

    private static async validateNameChange(
        userId: string,
        currentName: string,
        newName: string | undefined
    ): Promise<{ status: number; body: { error: string; message?: string; conflictingName?: string; currentName?: string } } | null> {
        if (newName && newName !== currentName) {
            if (typeof newName !== "string" || newName.trim().length === 0) {
                DatasetController.errorLogger.logValidationError("name", newName, "Dataset name must be a non-empty string");
                return {
                    status: 400,
                    body: { error: "Dataset name must be a non-empty string" }
                };
            }
            const nameConflict = await DatasetController.datasetRepository.datasetExists(userId, newName.trim());
            if (nameConflict) {
                DatasetController.errorLogger.logValidationError("name", newName, "Dataset with this name already exists");
                return {
                    status: 409,
                    body: {
                        error: "Dataset name conflict",
                        message: `A dataset named '${newName.trim()}' already exists in your account. Please choose a different name.`,
                        conflictingName: newName.trim(),
                        currentName: currentName
                    }
                };
            }
        }
        return null;
    }

    private static validateTags(tags: unknown): { status: number, body: unknown } | null {
        if (tags !== undefined) {
            if (!Array.isArray(tags)) {
                DatasetController.errorLogger.logValidationError("tags", typeof tags, "Tags must be an array");
                return {
                    status: 400,
                    body: { error: "Tags must be an array of strings" }
                };
            }
            for (const tag of tags as unknown[]) {
                if (typeof tag !== "string" || tag.trim().length === 0) {
                    DatasetController.errorLogger.logValidationError("tags", String(tag), "Each tag must be a non-empty string");
                    return {
                        status: 400,
                        body: {
                            error: "Invalid tag format",
                            message: "Each tag must be a non-empty string",
                            invalidTag: tag
                        }
                    };
                }
            }
        }
        return null;
    }
}

