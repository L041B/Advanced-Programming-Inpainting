import { Request, Response } from "express";
import { DatasetMiddleware } from "../middleware/datasetMiddleware";
import { Dataset } from "../models/Dataset";
import logger from "../utils/logger";

interface AuthRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

export class DatasetController {
    // Create an empty dataset
    static async createEmptyDataset(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { name, tags } = req.body;
            const userId = req.user!.userId;

            if (!name || typeof name !== "string") {
                res.status(400).json({ error: "Dataset name is required" });
                return;
            }

            const result = await DatasetMiddleware.createEmptyDataset(userId, name, tags);
            
            if (result.success) {
                res.status(201).json({ 
                    message: "Empty dataset created successfully",
                    dataset: result.dataset 
                });
            } else {
                res.status(400).json({ error: result.error });
            }
        } catch (error) {
            logger.error("Error creating empty dataset", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Upload data to dataset (images, videos, zip files)
    static async uploadDataToDataset(req: AuthRequest, res: Response): Promise<void> {
        try {
            const { datasetName } = req.body;
            const userId = req.user!.userId;
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            if (!datasetName || typeof datasetName !== "string") {
                res.status(400).json({ error: "Dataset name is required" });
                return;
            }

            if (!files || !files.image || !files.mask) {
                res.status(400).json({ error: "Both image and mask files are required" });
                return;
            }

            const imageFile = files.image[0];
            const maskFile = files.mask[0];

            const result = await DatasetMiddleware.processAndAddData(
                userId, 
                datasetName, 
                imageFile, 
                maskFile
            );

            if (result.success) {
                res.status(200).json({ 
                    message: "Data uploaded and processed successfully",
                    processedItems: result.processedItems
                });
            } else {
                res.status(400).json({ error: result.error });
            }
        } catch (error) {
            logger.error("Error uploading data to dataset", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get all datasets for the authenticated user
    static async getUserDatasets(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;

            const datasets = await Dataset.findAll({
                where: { userId, isDeleted: false },
                attributes: ["userId", "name", "tags", "createdAt", "updatedAt", "data"],
                order: [["createdAt", "DESC"]]
            });

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
                    type: data.type || "empty"
                };
            });

            res.status(200).json({ 
                success: true,
                message: "Datasets retrieved successfully",
                data: datasetsWithCount
            });
        } catch (error) {
            logger.error("Error retrieving user datasets", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get a specific dataset by name
    static async getDataset(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { name } = req.params;

            const dataset = await Dataset.findOne({
                where: { userId, name, isDeleted: false }
            });

            if (!dataset) {
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            interface DatasetData {
                pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number }>;
                type?: string;
            }
            const data = dataset.data as DatasetData;
            const itemCount = data?.pairs?.length || 0;

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
        } catch (error) {
            logger.error("Error retrieving dataset", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Get dataset data/contents with viewable image URLs
    static async getDatasetData(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { name } = req.params;
            const { page = 1, limit = 10 } = req.query;

            const dataset = await Dataset.findOne({
                where: { userId, name, isDeleted: false }
            });

            if (!dataset) {
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
        } catch (error) {
            logger.error("Error retrieving dataset data", { error: error instanceof Error ? error.message : "Unknown error" });
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
                    res.status(401).json({ error: "Invalid or expired image token" });
                    return;
                }
                decoded = verifyResult as ImageTokenPayload;
            } catch (error) {
                logger.error("Error verifying image token", { error: error instanceof Error ? error.message : "Unknown error" });
                res.status(401).json({ error: "Invalid or expired image token" });
                return;
            }

            const { userId, imagePath } = decoded;

            // Security check: ensure the path belongs to the user
            if (!imagePath.startsWith(`datasets/${userId}/`)) {
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
                
                res.send(imageBuffer);
            } catch (fileError) {
                res.status(404).json({ error: "Image not found" });
            }
        } catch (error) {
            logger.error("Error serving image", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }

    // Delete a dataset
    static async deleteDataset(req: AuthRequest, res: Response): Promise<void> {
        try {
            const userId = req.user!.userId;
            const { name } = req.params;

            const dataset = await Dataset.findOne({
                where: { userId, name, isDeleted: false }
            });

            if (!dataset) {
                res.status(404).json({ error: "Dataset not found" });
                return;
            }

            // Soft delete
            await dataset.update({ isDeleted: true });

            res.status(200).json({ 
                success: true,
                message: "Dataset deleted successfully"
            });
        } catch (error) {
            logger.error("Error deleting dataset", { error: error instanceof Error ? error.message : "Unknown error" });
            res.status(500).json({ error: "Internal server error" });
        }
    }
}

