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

// Controller class for dataset-related operations
export class DatasetController {
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly datasetLogger: DatasetRouteLogger = loggerFactory.createDatasetLogger();
    private static readonly apiLogger: ApiRouteLogger = loggerFactory.createApiLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
    private static readonly errorManager = ErrorManager.getInstance();

    // Create an empty dataset - uses unified error handling
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

    // Upload data to dataset - uses unified error handling
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

            // Log file upload
            DatasetController.datasetLogger.logFileUpload(userId, datasetName, imageFile.originalname, imageFile.size);

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

    // Get all datasets for the authenticated user - now uses unified error handling
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

    // Get a specific dataset by name - now uses unified error handling
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
            
            // Pass standardized errors directly, wrap others
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

    // Get dataset data/contents - now uses unified error handling
    static async getDatasetData(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        try {
            // Input validation is handled by middleware
            const userId = req.user!.userId;
            const { name } = req.params;
            const { page = 1, limit = 10 } = req.query;

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
            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const startIndex = (pageNum - 1) * limitNum;
            const endIndex = startIndex + limitNum;
            
            // Slice the pairs array for pagination
            const paginatedPairs = pairs.slice(startIndex, endIndex);

            // Generate temporary access tokens for images
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            const items = await Promise.all(paginatedPairs.map(
                async (pair, index: number) => {
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

    // Serve individual images - now uses unified error handling
    static async serveImage(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        // No authentication middleware, uses temporary token in URL
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Validate request parameters
        try {
            const token = decodeURIComponent(req.params.imagePath);
            const decoded = await DatasetController.verifyImageToken(token);

            // Security check: ensure the path belongs to the user
            if (!decoded.imagePath.startsWith(`datasets/${decoded.userId}/`)) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.userNotAuthorized,
                    "Access denied to this image"
                );
            }

            // Serve the image file
            await DatasetController.serveImageFile(decoded.imagePath, res);

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
                DatasetController.errorLogger.logDatabaseError("SERVE_IMAGE", "file_system", err.message);

                // Create standardized error and pass to middleware
                const standardError = DatasetController.errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Failed to serve image"
                );
                next(standardError);
            }
        }
    }

    // Verify and decode the temporary image access token
    private static async verifyImageToken(token: string): Promise<{ userId: string; imagePath: string; type: string }> {
        const jwt = await import("jsonwebtoken");
        interface ImageTokenPayload {
            userId: string;
            imagePath: string;
            type: string;
            iat?: number;
            exp?: number;
        }

        // Verify and decode the JWT token
        try {
            const verifyResult = jwt.default.verify(token, process.env.JWT_SECRET || "fallback_secret");
            if (typeof verifyResult === "string") {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.jwtNotValid,
                    "Invalid image token format"
                );
            }
            return verifyResult as ImageTokenPayload;
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            throw DatasetController.errorManager.createError(
                ErrorStatus.jwtNotValid,
                "Invalid or expired image token"
            );
        }
    }

    // Serve the image file from storage
    private static async serveImageFile(imagePath: string, res: Response): Promise<void> {
        const { FileStorage } = await import("../utils/fileStorage");
        try {
            const imageBuffer = await FileStorage.readFile(imagePath);
            const ext = imagePath.toLowerCase().split(".").pop();

            let contentType = "image/png";
            if (ext === "jpg" || ext === "jpeg") {
                contentType = "image/jpeg";
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

            // Log deletion
            DatasetController.datasetLogger.logDatasetDeletion(userId, name);
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

    // Update dataset metadata - now uses unified error handling
    static async updateDataset(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        DatasetController.apiLogger.logRequest(req);

        // Input validation is handled by middleware
        try {
            // Extract parameters
            const userId = req.user!.userId;
            const currentName = req.params.name;
            const { name: newName, tags } = req.body;

            // Fetch current dataset
            const currentDataset = await DatasetController.datasetRepository.getDatasetByUserIdAndName(userId, currentName);
            if (!currentDataset) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.datasetNotFoundError,
                    "Dataset not found"
                );
            }

            // Prepare update data
            const updateData = await DatasetController.prepareUpdateData(userId, currentName, newName, tags);
            const updatedDataset = await DatasetController.datasetRepository.updateDataset(userId, currentName, updateData);
            if (updatedDataset.userId === null) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.readInternalServerError,
                    "Dataset userId is null"
                );
            }
            // Prepare response data
            const responseData = DatasetController.prepareResponseData(
                { 
                    ...updatedDataset, 
                    userId: updatedDataset.userId 
                }, 
                newName, 
                currentName, 
                tags
            );

            // Final response
            res.status(200).json({
                success: true,
                message: "Dataset updated successfully",
                data: responseData
            });
            DatasetController.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            DatasetController.apiLogger.logError(req, error instanceof Error ? error : new Error("Unknown error"));

            // Pass standardized errors directly, wrap others
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
    }

    // Prepare update data, checking for name conflicts and sanitizing tags
    private static async prepareUpdateData(userId: string, currentName: string, newName?: string, tags?: string[]): Promise<{ name?: string; tags?: string[] }> {
        const updateData: { name?: string; tags?: string[] } = {};

        // Check for name change and conflicts
        if (newName && newName !== currentName) {
            const nameConflict = await DatasetController.datasetRepository.datasetExists(userId, newName.trim());
            // If a conflict is found, throw an error
            if (nameConflict) {
                throw DatasetController.errorManager.createError(
                    ErrorStatus.resourceAlreadyPresent,
                    `A dataset named '${newName.trim()}' already exists in your account. Please choose a different name.`
                );
            }
            // Sanitize and set new name
            updateData.name = newName.trim();
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

    // Generate a temporary JWT token for image access
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