// import necessary modules and types
import { Request, Response, NextFunction } from "express";
import { DatasetService } from "../services/datasetService";
import { DatasetRepository } from "../repository/datasetRepository";
import { loggerFactory, DatasetRouteLogger, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";

// Extend Request type to include user and token info
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

// Add this type definition and export it
export type DatasetData = {
    userId: string;
    name: string;
    tags?: string[];
    type?: string;
    data?: {
        pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number; uploadIndex: number }>,
        type?: string
    } | null;
    nextUploadIndex?: number;
};

// Controller class for dataset-related operations
export class DatasetController {
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly datasetLogger: DatasetRouteLogger = loggerFactory.createDatasetLogger();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
    private static readonly errorManager = ErrorManager.getInstance();

    // Create an empty dataset 
    static async createEmptyDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Input validation is handled by middleware
        try {
            const { name, tags } = req.body;
            const userId = req.user!.userId;
            // Create dataset
            const dataset = await DatasetService.createEmptyDataset(userId, name, tags);
            
            // Log creation
            res.status(201).json({ 
                message: "Empty dataset created successfully",
                dataset: dataset.toJSON()
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
            next(error); // Pass to error middleware
        }
    }

    // Upload data to dataset 
    static async uploadDataToDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        // Start timing and log request
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Input validation is handled by middleware
        try {
            const { datasetName } = req.body;
            const userId = req.user!.userId;
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };
            const imageFile = files.image[0];
            const maskFile = files.mask[0];

            // Process and add data to dataset
            const result = await DatasetService.processAndAddData(userId, datasetName, imageFile, maskFile);

            // Handle token transaction for successful upload
            await DatasetController.handleSuccessfulUpload(req, result, userId);
            
            // Final response with token info if applicable
            res.status(200).json({ 
                message: "Data uploaded and processed successfully",
                processedItems: result.processedItems,
                tokenSpent: req.operationResult?.tokensSpent || 0,
                userTokens: req.operationResult?.remainingBalance || 0
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
            next(error); // Pass to error middleware
        }
    }

    // Get all datasets for the authenticated user
    static async getUserDatasets(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Input validation is handled by middleware
        try {
            const userId = req.user!.userId;
            const { includeDeleted = "false" } = req.query;

            // Fetch datasets based on includeDeleted flag
            const datasets = includeDeleted === "true" 
                ? await DatasetController.datasetRepository.getAllUserDatasetsIncludingDeleted(userId)
                : await DatasetController.datasetRepository.getUserDatasets(userId);

            // Map datasets to include item counts and status
            const datasetsWithCount = datasets.map((dataset) => {
                const data = (dataset.data ?? {}) as { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>; type?: string };
                const itemCount = data.pairs?.length || 0;
                
                return {
                    userId: dataset.userId,
                    name: dataset.name,
                    tags: dataset.tags,
                    createdAt: dataset.createdAt,
                    updatedAt: dataset.updatedAt,
                    deletedAt: dataset.deletedAt, 
                    itemCount,
                    type: data.type || "empty",
                    isDeleted: dataset.isDeleted,
                    status: dataset.isDeleted ? "deleted" : "active"
                };
            });

            // Prepare summary
            const activeDatasets = datasetsWithCount.filter(d => !d.isDeleted);
            const deletedDatasets = datasetsWithCount.filter(d => d.isDeleted);

            // Final response
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
            // Log error
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("GET_USER_DATASETS", "datasets", err.message);
            
            // Create standardized error and pass to middleware
            const standardError = DatasetController.errorManager.createError(
                ErrorStatus.readInternalServerError,
                "Failed to retrieve user datasets"
            );
            // Pass to error middleware
            next(standardError);
        }
    }

    // Get a specific dataset by name 
    static async getDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        // Start timing and log request
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Input validation is handled by middleware
        try {
            const userId = req.user!.userId;
            const { name } = req.params;

            // Fetch dataset by user ID and name
            const dataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, name);

            // If not found, throw standardized error
            if (!dataset) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.datasetNotFoundError,
                    "Dataset not found"
                );
            }

            // Prepare response data
            interface DatasetData {
                pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>;
                type?: string;
            }
            // Type assertion
            const data = dataset.data as DatasetData;
            const itemCount = data?.pairs?.length || 0;

            // Final response
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
            // Log response
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
            
            // Pass standardized errors directly
            if (error instanceof Error && "errorType" in error) {
                next(error);
            } else {
                // Log error
                const err = error instanceof Error ? error : new Error("Unknown error");
                DatasetController.errorLogger.logDatabaseError("GET_DATASET", "datasets", err.message);
                
                // Create standardized error and pass to middleware
                const standardError = DatasetController.errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Failed to retrieve dataset"
                );
                next(standardError);
            }
        }
    }

    // Get dataset data/contents 
    static async getDatasetData(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            // Input validation is handled by middleware
            const userId = req.user!.userId;
            const { name } = req.params;
            const { page = 1, limit = 10 } = req.query;

            // Validate pagination parameters
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);

            const MAX_PAGE = 1_000_000;
            const MAX_LIMIT = 100;

            if (
                isNaN(pageNum) || pageNum < 1 || pageNum > MAX_PAGE ||
                isNaN(limitNum) || limitNum < 1 || limitNum > MAX_LIMIT
            ) {
                const error = DatasetController.errorManager.createError(
                    ErrorStatus.invalidParametersError,
                    `Invalid pagination parameters: 'page' must be 1-${MAX_PAGE}.`
                );
                next(error);
                return;
            }

            // Fetch dataset by user ID and name
            const dataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, name);

            // If not found, throw standardized error
            if (!dataset) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.datasetNotFoundError,
                    "Dataset not found"
                );
            }

            // Extract data pairs
            interface DatasetData {
                pairs?: Array<{ 
                    imagePath: string; 
                    maskPath: string; 
                    frameIndex?: number; 
                    uploadIndex: number; 
                }>;
                type?: string;
            }
            // Type assertion
            const data = dataset.data as DatasetData;
            const pairs = data?.pairs || [];
            
            // Pagination
            const startIndex = (pageNum - 1) * limitNum;
            const endIndex = startIndex + limitNum;
            
            // Slice the pairs array for pagination
            const paginatedPairs = pairs.slice(startIndex, endIndex);

            // Generate clean URLs without tokens 
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            const items = paginatedPairs.map((pair, index: number) => {
                // Extract just the filename from the path
                const imageFilename = pair.imagePath.split("/").pop() || "";
                const maskFilename = pair.maskPath.split("/").pop() || "";
                
                return {
                    index: startIndex + index,
                    imagePath: pair.imagePath,
                    maskPath: pair.maskPath,
                    imageUrl: `${baseUrl}/api/datasets/${encodeURIComponent(name)}/image/${encodeURIComponent(imageFilename)}`,
                    maskUrl: `${baseUrl}/api/datasets/${encodeURIComponent(name)}/mask/${encodeURIComponent(maskFilename)}`,
                    frameIndex: pair.frameIndex || null,
                    uploadIndex: pair.uploadIndex
                };
            });

            // Final response
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
            // Log response
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
            
            // Pass standardized errors directly, wrap others
            if (error instanceof Error && "errorType" in error) {
                next(error);
            } else {
                // Log error
                const err = error instanceof Error ? error : new Error("Unknown error");
                DatasetController.errorLogger.logDatabaseError("GET_DATASET_DATA", "datasets", err.message);
                
                const standardError = DatasetController.errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Failed to retrieve dataset data"
                );
                next(standardError);
            }
        }
    }

    // Serve individual images/masks with JWT authentication
    static async serveImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const userId = req.user!.userId;
            const { name: datasetName, filename, type } = req.params;

            // Validate file type
            DatasetController.validateFileType(type);
            const dataset = await DatasetController.getDatasetOrThrow(userId, datasetName);
            const filePath = DatasetController.findFilePath(dataset, type, filename);

            await DatasetController.serveFile(filePath, res);

            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));

            if (error instanceof Error && "errorType" in error) {
                next(error);
            } else {
                const err = error instanceof Error ? error : new Error("Unknown error");
                DatasetController.errorLogger.logDatabaseError("SERVE_IMAGE", "file_system", err.message);

                const standardError = DatasetController.errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Failed to serve image"
                );
                next(standardError);
            }
        }
    }

    // Helper to validate file type
    private static validateFileType(type: string): void {
        if (type !== "image" && type !== "mask") {
            throw DatasetController.errorManager.createError(
                ErrorStatus.invalidFormat,
                "Invalid file type. Must be 'image' or 'mask'"
            );
        }
    }

    // Helper to get dataset or throw error
    private static async getDatasetOrThrow(userId: string, datasetName: string) {
        const dataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
        if (!dataset) {
            throw DatasetController.errorManager.createError(
                ErrorStatus.datasetNotFoundError,
                "Dataset not found or access denied"
            );
        }
        return dataset;
    }

    // Helper to find file path in dataset
    private static findFilePath(
        dataset: {
            data?: object | null;
        },
        type: string,
        filename: string
    ): string {
        interface DatasetData {
            pairs?: Array<{
                imagePath: string;
                maskPath: string;
                frameIndex?: number;
                uploadIndex: number;
            }>;
        }
        const data = dataset.data as DatasetData | null | undefined;
        const pairs = data?.pairs || [];
        const decodedFilename = decodeURIComponent(filename);

        for (const pair of pairs) {
            if (type === "image" && pair.imagePath.endsWith(decodedFilename)) {
                return pair.imagePath;
            } else if (type === "mask" && pair.maskPath.endsWith(decodedFilename)) {
                return pair.maskPath;
            }
        }

        throw DatasetController.errorManager.createError(
            ErrorStatus.resourceNotFoundError,
            "File not found in dataset"
        );
    }

    // Helper to serve the file
    private static async serveFile(filePath: string, res: Response): Promise<void> {
        const { FileStorage } = await import("../utils/fileStorage");
        try {
            const imageBuffer = await FileStorage.readFile(filePath);
            const ext = filePath.toLowerCase().split(".").pop();

            let contentType = "image/png";
            if (ext === "jpg" || ext === "jpeg") {
                contentType = "image/jpeg";
            } else if (ext === "gif") {
                contentType = "image/gif";
            }

            res.set({
                "Content-Type": contentType,
                "Content-Length": imageBuffer.length.toString(),
                "Cache-Control": "public, max-age=3600"
            });

            res.send(imageBuffer);
        } catch (fileError) {
            DatasetController.errorLogger.logDatabaseError("SERVE_IMAGE_FILE", "file_system", fileError instanceof Error ? fileError.message : "Unknown file error");
            throw DatasetController.errorManager.createError(
                ErrorStatus.resourceNotFoundError,
                "Image file not found"
            );
        }
    }

    // Delete a dataset 
    static async deleteDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Input validation is handled by middleware
        try {
            const userId = req.user!.userId;
            const { name } = req.params;

            // Attempt to delete the dataset
            const success = await DatasetController.datasetRepository.deleteDataset(userId, name);

            // If not found, throw standardized error
            if (!success) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.datasetNotFoundError,
                    "Dataset not found"
                );
            }

            res.status(200).json({
                success: true,
                message: "Dataset deleted successfully"
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
            
            // Pass standardized errors directly, wrap others
            if (error instanceof Error && "errorType" in error) {
                next(error);
            } else {
                const err = error instanceof Error ? error : new Error("Unknown error");
                DatasetController.errorLogger.logDatabaseError("DELETE_DATASET", "datasets", err.message);
                
                const standardError = DatasetController.errorManager.createError(
                    ErrorStatus.deleteInternalServerError,
                    "Failed to delete dataset"
                );
                // Pass to error middleware
                next(standardError);
            }
        }
    }

    // Update dataset metadata
    static async updateDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            const { userId, currentName, newName, tags } = DatasetController.extractUpdateParams(req);
            const currentDataset = await DatasetController.getCurrentDatasetOrThrow(userId, currentName);

            const { hasNameChange, hasTagsChange } = DatasetController.detectChanges(newName, currentName, tags, currentDataset.tags);

            DatasetController.throwIfNoChanges(hasNameChange, hasTagsChange);

            const updateData = await DatasetController.prepareUpdateData(userId, currentName, newName, tags, hasNameChange);
            const updatedDataset = await DatasetController.datasetRepository.updateDataset(userId, currentName, updateData);

            DatasetController.throwIfUserIdNull(updatedDataset);

            const responseData = DatasetController.prepareResponseData(
                { ...updatedDataset, userId: updatedDataset.userId as string },
                hasNameChange ? newName : undefined,
                currentName,
                hasTagsChange ? tags : undefined
            );

            res.status(200).json({
                success: true,
                message: "Dataset updated successfully",
                data: responseData
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.handleUpdateDatasetError(req, error, next);
        }
    }

    // Helper to extract parameters for updateDataset
    private static extractUpdateParams(req: AuthRequest) {
        return {
            userId: req.user!.userId,
            currentName: req.params.name,
            newName: req.body.name,
            tags: req.body.tags
        };
    }

    // Helper to fetch current dataset or throw error
    private static async getCurrentDatasetOrThrow(userId: string, currentName: string) {
        const currentDataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, currentName);
        if (!currentDataset) {
            throw DatasetController.errorManager.createError(
                ErrorStatus.datasetNotFoundError,
                "Dataset not found"
            );
        }
        return currentDataset;
    }

    // Helper to detect changes
    private static detectChanges(newName: string | undefined, currentName: string, tags: string[] | undefined, currentTags: string[]) {
        const hasNameChange = newName !== undefined && newName.trim() !== currentName;
        const hasTagsChange = tags !== undefined && !DatasetController.arraysEqual(tags, currentTags);
        return { hasNameChange, hasTagsChange };
    }

    // Helper to throw if no changes
    private static throwIfNoChanges(hasNameChange: boolean, hasTagsChange: boolean) {
        if (!hasNameChange && !hasTagsChange) {
            throw DatasetController.errorManager.createError(
                ErrorStatus.noChangesToUpdateError,
                "No changes detected. Please provide a different name or modify tags to update the dataset."
            );
        }
    }

    // Helper to throw if userId is null
    private static throwIfUserIdNull(updatedDataset: { userId: string | null }) {
        if (updatedDataset.userId === null) {
            throw DatasetController.errorManager.createError(
                ErrorStatus.readInternalServerError,
                "Dataset userId is null"
            );
        }
    }

    // Error handler for updateDataset
    private static handleUpdateDatasetError(req: AuthRequest, error: unknown, next: NextFunction) {
        DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));
        if (error instanceof Error && "errorType" in error) {
            next(error);
        } else {
            const err = error instanceof Error ? error : new Error("Unknown error");
            DatasetController.errorLogger.logDatabaseError("UPDATE_DATASET", "datasets", err.message);

            const standardError = DatasetController.errorManager.createError(
                ErrorStatus.updateInternalServerError,
                "Failed to update dataset"
            );
            next(standardError);
        }
    }

    // Prepare update data, checking for name conflicts and sanitizing tags
    private static async prepareUpdateData(
        userId: string, 
        currentName: string, 
        newName?: string, 
        tags?: string[], 
        hasNameChange?: boolean
    ): Promise<{ name?: string; tags?: string[] }> {
        const updateData: { name?: string; tags?: string[] } = {};

        // Only check for name conflicts if there's actually a name change
        if (hasNameChange && newName) {
            const trimmedNewName = newName.trim();
            const nameConflict = await DatasetController.datasetRepository.datasetExists(userId, trimmedNewName);
            
            if (nameConflict) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.resourceAlreadyPresent,
                    `A dataset named '${trimmedNewName}' already exists in your account. Please choose a different name.`
                );
            }
            updateData.name = trimmedNewName;
        }

        // Sanitize and set tags if provided
        if (tags !== undefined) {
            updateData.tags = tags.map((tag: string) => tag.trim()).filter((tag: string) => tag.length > 0);
        }

        return updateData;
    }

    // Prepare response data including change flags
    private static prepareResponseData(
        // Type annotation for updatedDataset
        updatedDataset: {
            userId: string;
            name: string;
            tags: string[];
            data: { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>; type?: string } | null;
            createdAt: Date;
            updatedAt: Date;
        }, 
        newName?: string, 
        currentName?: string, 
        tags?: string[]
    ): {
        userId: string;
        name: string;
        tags: string[];
        itemCount: number;
        type: string;
        createdAt: Date;
        updatedAt: Date;
        changes: {
            nameChanged: boolean;
            tagsChanged: boolean;
            previousName: string | undefined;
        };
    } {
        // Extract item count and type from dataset data
        const datasetData = updatedDataset.data as { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>; type?: string } | null;
        const itemCount = datasetData?.pairs?.length || 0;

        return {
            userId: updatedDataset.userId,
            name: updatedDataset.name,
            tags: updatedDataset.tags,
            itemCount,
            type: datasetData?.type || "empty",
            createdAt: updatedDataset.createdAt,
            updatedAt: updatedDataset.updatedAt,
            changes: {
                nameChanged: !!(newName && newName !== currentName),
                tagsChanged: tags !== undefined,
                previousName: newName && newName !== currentName ? currentName : undefined
            }
        };
    }

    // Helper method to compare arrays for equality
    private static arraysEqual(arr1: string[], arr2: string[]): boolean {
        if (arr1.length !== arr2.length) return false;
        const sorted1 = [...arr1].sort((a, b) => a.localeCompare(b));
        const sorted2 = [...arr2].sort((a, b) => a.localeCompare(b));
        return sorted1.every((val, index) => val === sorted2[index]);
    }

    // Private helper methods remain unchanged
    private static async handleSuccessfulUpload(
        req: AuthRequest, 
        result: { processedItems: number; reservationId: string; tokenCost: number }, 
        userId: string
    ): Promise<void> {
        try {
            // Process token transaction
            const tokenInfo = await DatasetController.processTokenTransaction(result, userId);
            
            // Attach token info to request for logging
            req.operationResult = {
                tokensSpent: tokenInfo.tokenSpent,
                remainingBalance: tokenInfo.userTokens,
                operationType: "dataset_upload"
            };

            // Attach reservation info to request for potential further use
            req.tokenReservation = {
                reservationKey: result.reservationId,
                reservedAmount: tokenInfo.tokenSpent
            };
        } catch (error) {
            // Log error but do not fail the upload
            DatasetController.errorLogger.logDatabaseError("TOKEN_TRANSACTION", "tokens", 
                error instanceof Error ? error.message : "Token transaction processing failed");
        }
    }

    // Process token transaction and handle potential errors
    private static async processTokenTransaction(
        result: { processedItems: number; reservationId: string; tokenCost: number }, 
        userId: string
    ): Promise<{ tokenSpent: number; userTokens: number }> {
        const { TokenService } = await import("../services/tokenService");
        const tokenService = TokenService.getInstance();

        // Confirm token usage
        try {
            const confirmResult = await tokenService.confirmTokenUsage(result.reservationId);

            if (typeof confirmResult.tokensSpent === "number" && typeof confirmResult.remainingBalance === "number") {
                return {
                    tokenSpent: confirmResult.tokensSpent || 0,
                    userTokens: confirmResult.remainingBalance || 0
                };
            } else {
                return await DatasetController.getTokenInfoFromTransaction(tokenService, userId);
            }
        } catch (error) {
            DatasetController.errorLogger.logDatabaseError("PROCESS_TOKEN_TRANSACTION", "tokens", error instanceof Error ? error.message : "Error during token transaction");
            return await DatasetController.getTokenInfoFromTransaction(tokenService, userId);
        }
    }

    // Fallback method to get token info from recent transactions
    private static async getTokenInfoFromTransaction(tokenService: import("../services/tokenService").TokenService, userId: string): Promise<{ tokenSpent: number; userTokens: number }> {
        const transactionHistoryResult = await tokenService.getUserTransactionHistory(userId, 1);
        let tokenSpent = 0;

        // Check if the last transaction was a dataset upload within the last 5 seconds
        if (Array.isArray(transactionHistoryResult) && transactionHistoryResult.length > 0) {
            const lastTransaction = transactionHistoryResult[0];
            
            if (lastTransaction.operationType === "dataset_upload") {
                const transactionTime = new Date(lastTransaction.createdAt).getTime();
                const now = Date.now();
                
                if ((now - transactionTime) < 5000) {
                    tokenSpent = Math.abs(Number(lastTransaction.amount));
                }
            }
        }

        // Get current user token balance
        const balanceResult = await tokenService.getUserTokenBalance(userId) as { success?: boolean; balance?: number };
        const userTokens = balanceResult.success ? balanceResult.balance || 0 : 0;

        return { tokenSpent, userTokens };
    }
}