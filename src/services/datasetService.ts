// import necessary modules and types
import AdmZip from "adm-zip";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import { loggerFactory, DatasetRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { DatasetRepository } from "../repository/datasetRepository";
import { FileStorage } from "../utils/fileStorage";
import { TokenService } from "../services/tokenService";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";

// Initialize loggers and error manager
const datasetLogger: DatasetRouteLogger = loggerFactory.createDatasetLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Define interfaces for dataset data and processing results
interface DatasetData {
    type: "image-mask" | "video-frames";
    pairs: Array<{
        imagePath: string;
        maskPath: string;
        frameIndex?: number;
        uploadIndex: number;
    }>;
}

// Result of processing and adding data to dataset
interface ProcessingResult {
    processedItems: number;
    reservationId: string;
    tokenCost: number;
}

// Define Dataset interface
interface Dataset {
    id: string;
    userId: string;
    name: string;
    data: unknown;
    tags: string[];
    nextUploadIndex: number;
    createdAt: Date;
    updatedAt: Date;
    toJSON(): Record<string, unknown>;
}

// Main service class for dataset operations
export class DatasetService {
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly tokenService = TokenService.getInstance();
    private static readonly errorManager = ErrorManager.getInstance();

    // Pricing structure for different dataset types
    private static readonly PRICING_STRUCTURE = {
        SINGLE_IMAGE_DATASET: 0.65,
        VIDEO_FRAME_DATASET: 0.4,
        ZIP_FILE_DATASET: 0.7
    };

    // Create an empty dataset - now throws standardized errors
    static async createEmptyDataset(userId: string, name: string, tags?: string[]): Promise<Dataset> {
        try {
            // Check for existing dataset with the same name
            const exists = await DatasetService.datasetRepository.datasetExists(userId, name);
            if (exists) {
                // Log and throw error if dataset already exists
                throw this.errorManager.createError(
                    ErrorStatus.resourceAlreadyPresent, 
                    "A dataset with this name already exists."
                );
            }

            // Proceed to create the dataset
            const dataset = await DatasetService.datasetRepository.createDataset({
                userId,
                name,
                data: null,
                tags: tags || []
            });

            // Sanity check
            if (dataset.userId === null) {
                throw this.errorManager.createError(
                    ErrorStatus.creationInternalServerError,
                    "Dataset creation failed: userId is null."
                );
            }

            return dataset as Dataset;
        } catch (error) {
            // Re-throw standardized errors
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Log and wrap unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("CREATE_EMPTY_DATASET", "datasets", err.message);
            throw this.errorManager.createError(
                ErrorStatus.creationInternalServerError, 
                "Failed to create dataset."
            );
        }
    }

    // Process and add data to dataset 
    static async processAndAddData(
        userId: string,
        datasetName: string,
        imageFile: Express.Multer.File,
        maskFile: Express.Multer.File
    ): Promise<ProcessingResult> {
        const tempFiles: string[] = [imageFile.path, maskFile.path];
        let tokenReservationId: string | undefined;

        // Main try-catch block to handle processing and token management
        try {
            const { tokenCost, processedFrameCount } = await this.calculateTokenCost(imageFile, maskFile);
            if (tokenCost === -1) {
                throw this.errorManager.createError(
                    ErrorStatus.invalidFormat, 
                    "Unsupported file format for cost calculation."
                );
            }

            // TokenService throws standardized errors
            tokenReservationId = await this.tokenService.reserveTokens(
                userId, 
                tokenCost, 
                "dataset_upload", 
                `${datasetName}_${Date.now()}`
            );

            // Fetch dataset and validate existence
            const dataset = await this.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
            if (!dataset) {
                throw this.errorManager.createError(
                    ErrorStatus.resourceNotFoundError, 
                    "Dataset not found."
                );
            }

            // Process uploaded files
            const processedData = await this.processUploadedFiles(
                imageFile,
                maskFile,
                `${userId}/${datasetName}`,
                dataset.nextUploadIndex
            );

            // Log frame count mismatch if applicable
            this.logFrameCountIfMismatch(imageFile, processedData, processedFrameCount);

            // Add data to dataset and increment index
            const result = await this.addDataToDatasetAndIncrementIndex(
                userId, 
                datasetName, 
                processedData, 
                dataset.nextUploadIndex + 1
            );

            // Ensure processedItems is valid
            if (!result.processedItems) {
                throw this.errorManager.createError(
                    ErrorStatus.creationInternalServerError,
                    "Failed to add data to dataset."
                );
            }

            // Cleanup temporary files
            await FileStorage.cleanupTempFiles(tempFiles);
            
            return {
                processedItems: result.processedItems,
                reservationId: tokenReservationId,
                tokenCost: tokenCost
            };
        } catch (error) {
            // Cleanup on any error
            await this.refundTokensIfNeeded(tokenReservationId);
            await FileStorage.cleanupTempFiles(tempFiles);
            
            // Re-throw standardized errors
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Log and wrap unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("PROCESS_AND_ADD_DATA", "datasets", err.message);
            throw this.errorManager.createError(
                ErrorStatus.creationInternalServerError,
                "Failed to process and add data to dataset."
            );
        }
    }

    // Refund tokens if reservation ID is provided
    private static async refundTokensIfNeeded(tokenReservationId: string | undefined): Promise<void> {
        if (tokenReservationId) {
            try {
                // Attempt to refund tokens
                await DatasetService.tokenService.refundTokens(tokenReservationId);
            } catch (error) {
                // Log refund errors but don't throw - this is cleanup logic
                errorLogger.logDatabaseError("REFUND_TOKENS", "tokens", 
                    error instanceof Error ? error.message : "Token refund failed");
            }
        }
    }

    // Log frame count mismatch if applicable
    private static logFrameCountIfMismatch(
        imageFile: Express.Multer.File,
        processedData: DatasetData,
        processedFrameCount?: number
    ): void {
        // Ignore if no frame count to compare
        const imageExt = path.extname(imageFile.originalname).toLowerCase();
        if (this.isVideoFile(imageExt) && processedData.pairs.length !== processedFrameCount) {
            datasetLogger.log("Frame count mismatch detected", {
                expected: processedFrameCount,
                actual: processedData.pairs.length,
                adjustingCost: true
            });
        }
    }

    // Check if file is a video based on extension
    private static isVideoFile(extension: string): boolean {
        return [".mp4", ".avi", ".mov"].includes(extension);
    }

    // Calculate token cost based on uploaded files
    private static async calculateTokenCost(
        imageFile: Express.Multer.File, 
        maskFile: Express.Multer.File
    ): Promise<{ tokenCost: number; processedFrameCount?: number }> {
        try {
            // Determine file types and calculate cost accordingly
            const imageExt = path.extname(imageFile.originalname).toLowerCase();
            const maskExt = path.extname(maskFile.originalname).toLowerCase();
            const imageFormats = [".png", ".jpg", ".jpeg"];
            const videoFormats = [".mp4", ".avi", ".mov"];
            const zipFormats = [".zip"];

            // Handle ZIP files
            if (zipFormats.includes(imageExt)) {
                const tokenCost = await this.calculateZipTokenCost(imageFile);
                return { tokenCost };
            }

            // Handle image-mask pairs
            if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                return { tokenCost: this.PRICING_STRUCTURE.SINGLE_IMAGE_DATASET };
            }

            // Handle video files
            if (videoFormats.includes(imageExt)) {
                const videoBuffer = await fs.readFile(imageFile.path);
                const frameBuffers = await this.extractFramesFromVideo(videoBuffer);
                const processedFrameCount = frameBuffers.length;
                const tokenCost = processedFrameCount * this.PRICING_STRUCTURE.VIDEO_FRAME_DATASET;
                return { tokenCost, processedFrameCount };
            }

            // Unsupported format
            return { tokenCost: -1 };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logValidationError("tokenCost", imageFile.originalname, err.message);
            throw this.errorManager.createError(
                ErrorStatus.invalidFormat,
                "Failed to calculate processing cost for uploaded files."
            );
        }
    }

    // Calculate token cost for ZIP file 
    private static async calculateZipTokenCost(zipFile: Express.Multer.File): Promise<number> {
        try {
            // Analyze ZIP contents to estimate number of image-mask pairs
            const zipBuffer = await fs.readFile(zipFile.path);
            const zip = new AdmZip(zipBuffer);
            const entries = zip.getEntries().filter(entry => !entry.isDirectory);
            const subdirs = new Map<string, { images: number; videos: number }>();
            const imageFormats = [".png", ".jpg", ".jpeg"];
            const videoFormats = [".mp4", ".avi", ".mov"];

            // Group entries by subdirectory and count images/videos
            for (const entry of entries) {
                const pathParts = entry.entryName.split("/");
                if (pathParts.length < 2) continue;
                const subdir = pathParts[0];
                if (!subdirs.has(subdir)) subdirs.set(subdir, { images: 0, videos: 0 });

                // Skip mask files in cost calculation
                const filename = pathParts[pathParts.length - 1];
                if (filename.toLowerCase().includes("mask")) continue;

                // Get file extension
                const ext = path.extname(filename).toLowerCase();
                const subdirData = subdirs.get(subdir)!;
                if (videoFormats.includes(ext)) subdirData.videos++;
                else if (imageFormats.includes(ext)) subdirData.images++;
            }

            // Estimate total pairs across all subdirectories
            const totalPairs = Array.from(subdirs.values()).reduce((sum, data) => sum + data.images + data.videos, 0);
            return totalPairs * this.PRICING_STRUCTURE.ZIP_FILE_DATASET;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logFileUploadError(zipFile.originalname, zipFile.size, err.message);
            throw this.errorManager.createError(
                ErrorStatus.invalidFormat,
                "Failed to analyze ZIP file for cost calculation."
            );
        }
    }

    //  Process uploaded files and return structured data
    private static async processUploadedFiles(
        imageFile: Express.Multer.File, 
        maskFile: Express.Multer.File, 
        subfolder: string, 
        uploadIndex: number
    ): Promise<DatasetData> {
        try {
            // Validate file formats
            const imageExt = path.extname(imageFile.originalname).toLowerCase();
            const maskExt = path.extname(maskFile.originalname).toLowerCase();
            const imageFormats = [".png", ".jpg", ".jpeg"];
            const videoFormats = [".mp4", ".avi", ".mov"];
            const zipFormats = [".zip"];

            // Log the start of processing
            datasetLogger.logDataProcessing(imageFile.originalname, subfolder, imageExt, true);

            // Handle ZIP files
            if (zipFormats.includes(imageExt)) {
                const zipBuffer = await fs.readFile(imageFile.path);
                return this.processZipFile(zipBuffer, subfolder, uploadIndex);
            }

            // Read file buffers
            const imageBuffer = await fs.readFile(imageFile.path);
            const maskBuffer = await fs.readFile(maskFile.path);

            // Process based on file types
            if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                return this.processImageMaskPair(imageBuffer, maskBuffer, subfolder, imageFile.originalname, maskFile.originalname, uploadIndex);
            }

            // Handle video files
            if (videoFormats.includes(imageExt)) {
                if (imageFormats.includes(maskExt)) {
                    return this.processVideoWithSingleMask(imageBuffer, maskBuffer, subfolder, imageFile.originalname, maskFile.originalname, uploadIndex);
                }
                if (videoFormats.includes(maskExt)) {
                    return this.processVideoWithMaskVideo(imageBuffer, maskBuffer, subfolder, imageFile.originalname, maskFile.originalname, uploadIndex);
                }
                throw this.errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Invalid mask format for video processing."
                );
            }

            // Unsupported format combination
            throw this.errorManager.createError(
                ErrorStatus.invalidFormat,
                "Unsupported file format combination."
            );
        } catch (error) {
            // Re-throw standardized errors
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Log and wrap unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("PROCESS_UPLOADED_FILES", "file_system", err.message);
            throw this.errorManager.createError(
                ErrorStatus.creationInternalServerError,
                "Failed to process uploaded files."
            );
        }
    }

    // Process image-mask pair 
    private static async processImageMaskPair(
        imageBuffer: Buffer, 
        maskBuffer: Buffer, 
        subfolder: string,
        imageName: string,
        maskName: string,
        uploadIndex: number
    ): Promise<DatasetData> {
        try {
            // Validate that mask is binary
            const isBinary = await this.validateBinaryMask(maskBuffer);
            if (!isBinary) {
                throw this.errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Mask must be a binary image (only black and white pixels)."
                );
            }

            // Save files to permanent storage
            const imagePath = await FileStorage.saveFile(imageBuffer, imageName, subfolder);
            const maskPath = await FileStorage.saveFile(maskBuffer, maskName, subfolder);

            // Log successful processing
            datasetLogger.log("Image-mask pair processed", { imagePath, maskPath, uploadIndex });

            return {
                type: "image-mask",
                pairs: [{
                    imagePath,
                    maskPath,
                    uploadIndex
                }]
            };
        } catch (error) {
            // Re-throw standardized errors
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Log and wrap unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logValidationError("imageProcessing", imageName, err.message);
            throw this.errorManager.createError(
                ErrorStatus.creationInternalServerError,
                "Failed to process image-mask pair."
            );
        }
    }

    // Process video with single mask 
    private static async processVideoWithSingleMask(
        videoBuffer: Buffer, 
        maskBuffer: Buffer, 
        subfolder: string,
        videoName: string,
        maskName: string,
        uploadIndex: number
    ): Promise<DatasetData> {
        const isBinary = await this.validateBinaryMask(maskBuffer);
        if (!isBinary) {
            errorLogger.logValidationError("mask", maskName, "Mask must be a binary image");
            throw new Error("Mask must be a binary image");
        }

        // Save mask to permanent storage
        const maskPath = await FileStorage.saveFile(maskBuffer, maskName, subfolder);
        
        // Extract frames and save them
        const frameBuffers = await this.extractFramesFromVideo(videoBuffer);
        const pairs: DatasetData["pairs"] = [];

        // Process each frame
        for (let i = 0; i < frameBuffers.length; i++) {
            const frameName = `${path.parse(videoName).name}_frame_${i.toString().padStart(3, "0")}.png`;
            const framePath = await FileStorage.saveFile(frameBuffers[i], frameName, subfolder);
            pairs.push({
                imagePath: framePath,
                maskPath,
                frameIndex: i,
                uploadIndex 
            });
        }

        // Log processing completion
        datasetLogger.log("Video with single mask processed", { 
            videoName, 
            maskName, 
            framesExtracted: frameBuffers.length, 
            uploadIndex 
        });

        return {
            type: "video-frames",
            pairs
        };
    }

    // Process video with mask video 
    private static async processVideoWithMaskVideo(
        videoBuffer: Buffer, 
        maskVideoBuffer: Buffer, 
        subfolder: string,
        videoName: string,
        maskVideoName: string,
        uploadIndex: number
    ): Promise<DatasetData> {
        // Extract frames from both videos
        const frames = await this.extractFramesFromVideo(videoBuffer);
        const maskFrames = await this.extractFramesFromVideo(maskVideoBuffer);

        // Validate frame count match
        if (frames.length !== maskFrames.length) {
            const mismatchMessage = `Video and mask video must have the same number of frames. Video: ${frames.length} frames, Mask: ${maskFrames.length} frames`;
            errorLogger.logValidationError("frameCount", `${frames.length}vs${maskFrames.length}`, mismatchMessage);
            throw new Error(mismatchMessage);
        }

        // Validate all mask frames are binary
        for (const maskFrame of maskFrames) {
            const isBinary = await this.validateBinaryMask(maskFrame);
            if (!isBinary) {
                errorLogger.logValidationError("maskFrames", maskVideoName, "All mask frames must be binary images");
                throw new Error("All mask frames must be binary images");
            }
        }

        // Save frames and mask frames to permanent storage
        const pairs: DatasetData["pairs"] = [];
        
        // Process each frame
        for (let i = 0; i < frames.length; i++) {
            const frameName = `${path.parse(videoName).name}_frame_${i.toString().padStart(3, "0")}.png`;
            const maskFrameName = `${path.parse(maskVideoName).name}_mask_${i.toString().padStart(3, "0")}.png`;
            //  Save both frame and corresponding mask frame
            const framePath = await FileStorage.saveFile(frames[i], frameName, subfolder);
            const maskPath = await FileStorage.saveFile(maskFrames[i], maskFrameName, subfolder);
            
            // Add to pairs with upload index
            pairs.push({
                imagePath: framePath,
                maskPath,
                frameIndex: i,
                uploadIndex 
            });
        }

        // Log processing completion
        datasetLogger.log("Video with mask video processed", { 
            videoName, 
            maskVideoName, 
            framesProcessed: pairs.length, 
            uploadIndex 
        });

        // Return structured data
        return {
            type: "video-frames",
            pairs
        };
    }

    // Process ZIP file 
    private static async processZipFile(zipBuffer: Buffer, subfolder: string, startUploadIndex: number): Promise<DatasetData> {
        const zip = new AdmZip(zipBuffer);
        const subdirs = this.groupZipEntriesBySubdirectory(zip.getEntries());

        // Log analysis results
        datasetLogger.log("ZIP file analyzed", {
            totalEntries: zip.getEntries().length,
            subdirectoriesFound: subdirs.size,
            subdirectoryNames: Array.from(subdirs.keys())
        });

        // Process each subdirectory
        const { pairs, processedSubdirs, skippedSubdirs } = await this.processZipSubdirectories(subdirs, subfolder, startUploadIndex);

        // If no valid pairs found in any subdirectory, log and throw error
        if (pairs.length === 0 && subdirs.size > 0) {
            const errorMessage = "ZIP processing failed: No valid image-mask pairs were found in any subdirectory.";
            errorLogger.logFileUploadError("ZIP", zipBuffer.length, errorMessage);
            throw new Error(errorMessage);
        }

        // Log final processing summary
        datasetLogger.log("ZIP processing completed successfully", {
            totalSubdirectories: subdirs.size,
            processedSubdirs,
            skippedSubdirs,
            totalPairs: pairs.length
        });

        return { type: "image-mask", pairs };
    }

    // Group ZIP entries by their subdirectory and classify as images or masks
    private static groupZipEntriesBySubdirectory(entries: AdmZip.IZipEntry[]): Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }> {
        const subdirs = new Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }>();
        const supportedFormats = [".png", ".jpg", ".jpeg", ".mp4", ".avi", ".mov"];

        // Classify entries into subdirectories
        for (const entry of entries) {
            if (entry.isDirectory) continue;

            // Extract subdirectory and filename
            const pathParts = entry.entryName.split("/");
            if (pathParts.length < 2) continue;

            // Get subdirectory and file extension
            const subdir = pathParts[0];
            const filename = pathParts[pathParts.length - 1];
            const ext = path.extname(filename).toLowerCase();

            // Skip unsupported formats
            if (!supportedFormats.includes(ext)) {
                errorLogger.logFileUploadError(filename, undefined, `Unsupported file format: ${ext}`);
                continue;
            }

            // Initialize subdirectory entry if not present
            if (!subdirs.has(subdir)) {
                subdirs.set(subdir, { images: [], masks: [] });
            }

            // Classify as mask if filename or any path part includes "mask"
            const isMask = filename.toLowerCase().includes("mask") || pathParts.some(part => part.toLowerCase().includes("mask"));
            const subdirData = subdirs.get(subdir)!;

            if (isMask) {
                subdirData.masks.push(entry);
            } else {
                subdirData.images.push(entry);
            }
        }
        return subdirs;
    }

    // Process each subdirectory in the ZIP file
    private static async processZipSubdirectories(subdirs: Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }>, subfolder: string, startUploadIndex: number) {
        let pairs: DatasetData["pairs"] = [];
        let processedSubdirs = 0;
        let skippedSubdirs = 0;
        let currentUploadIndex = startUploadIndex;

        // Iterate through each subdirectory and process
        for (const [subdirName, { images, masks }] of subdirs) {
            if (!this.validateSubdirectory(subdirName, images, masks)) {
                skippedSubdirs++;
                continue;
            }

            // Process valid subdirectory
            try {
                const result = await this.processSingleSubdirectory(subdirName, { images, masks }, subfolder, currentUploadIndex);
                pairs.push(...result.pairs);
                currentUploadIndex = result.nextUploadIndex;
                processedSubdirs++;
            } catch (subdirError) {
                const err = subdirError instanceof Error ? subdirError : new Error("Unknown error");
                errorLogger.logDatabaseError("PROCESS_ZIP_SUBDIRECTORY", "file_system", err.message);
                skippedSubdirs++;
            }
        }
        return { pairs, processedSubdirs, skippedSubdirs };
    }

    // Validate that a mask image is binary (only black and white pixels)
    private static validateSubdirectory(subdirName: string, images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[]): boolean {
        if (images.length === 0 || masks.length === 0) {
            errorLogger.logValidationError("subdirectory", subdirName, "Missing images or masks");
            return false;
        }
        // Validate format combinations
        if (!this.validateSubdirectoryFormats(images, masks)) {
            errorLogger.logValidationError("subdirectory", subdirName, "No valid format combinations found");
            return false;
        }
        return true;
    }

    // Process a single subdirectory and return pairs and next upload index
    private static async processSingleSubdirectory(subdirName: string, files: { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }, subfolder: string, currentUploadIndex: number) {
        const { images, masks } = files;
        images.sort((a, b) => a.name.localeCompare(b.name));
        masks.sort((a, b) => a.name.localeCompare(b.name));

        // Process pairs
        const pairs: DatasetData["pairs"] = [];
        const minLength = Math.min(images.length, masks.length);
        let subdirPairsProcessed = 0;

        // Process each image-mask pair
        for (let i = 0; i < minLength; i++) {
            try {
                const subData = await this.processZipPair(images[i], masks[i], `${subfolder}/${subdirName}`, currentUploadIndex);
                pairs.push(...subData.pairs);
                subdirPairsProcessed += subData.pairs.length;
                currentUploadIndex = subData.nextUploadIndex;
            } catch (pairError) {
                const err = pairError instanceof Error ? pairError : new Error("Unknown error");
                errorLogger.logFileUploadError(images[i].name, undefined, err.message);
            }
        }

        // Log subdirectory processing result
        if (subdirPairsProcessed > 0) {
            datasetLogger.log("Subdirectory processed successfully", { subdirName, pairsProcessed: subdirPairsProcessed });
        } else {
            errorLogger.logValidationError("subdirectory", subdirName, "No successfully processed pairs");
        }

        // Return processed pairs and next upload index
        return { pairs, nextUploadIndex: currentUploadIndex };
    }

    // Process a single image-mask pair from ZIP entries
    private static async processZipPair(imageEntry: AdmZip.IZipEntry, maskEntry: AdmZip.IZipEntry, zipSubfolder: string, uploadIndex: number) {
        const imageBuffer = imageEntry.getData();
        const maskBuffer = maskEntry.getData();
        const imageExt = path.extname(imageEntry.name).toLowerCase();
        const maskExt = path.extname(maskEntry.name).toLowerCase();
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];

        // Determine processing method based on file types
        let subData: DatasetData;
        let nextUploadIndex = uploadIndex;

        // Process based on file types
        if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
            subData = await this.processImageMaskPair(imageBuffer, maskBuffer, zipSubfolder, imageEntry.name, maskEntry.name, uploadIndex);
            nextUploadIndex++;
        } else if (videoFormats.includes(imageExt)) {
            if (imageFormats.includes(maskExt)) {
                subData = await this.processVideoWithSingleMask(imageBuffer, maskBuffer, zipSubfolder, imageEntry.name, maskEntry.name, uploadIndex);
            } else if (videoFormats.includes(maskExt)) {
                subData = await this.processVideoWithMaskVideo(imageBuffer, maskBuffer, zipSubfolder, imageEntry.name, maskEntry.name, uploadIndex);
            } else {
                throw new Error("Unsupported mask format for video");
            }
            nextUploadIndex++;
        } else {
            throw new Error("Unsupported file formats");
        }

        return { pairs: subData.pairs, nextUploadIndex };
    }

    // Validate that a mask image is binary (only black and white pixels)
    private static validateSubdirectoryFormats(images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[]): boolean {
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];

        // Check if any combination of formats is valid
        for (const imageEntry of images) {
            const imageExt = path.extname(imageEntry.name).toLowerCase();
            
            // Check against all masks
            for (const maskEntry of masks) {
                const maskExt = path.extname(maskEntry.name).toLowerCase();
                
                // Valid combinations:
                if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                    return true; // Image + Image mask
                }
                if (videoFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                    return true; // Video + Image mask
                }
                if (videoFormats.includes(imageExt) && videoFormats.includes(maskExt)) {
                    return true; // Video + Video mask
                }
            }
        }
        
        return false; // No valid format combinations found
    }

    // Extract frames from video buffer using FFmpeg
    private static async extractFramesFromVideo(videoBuffer: Buffer): Promise<Buffer[]> {
        const tempDir = FileStorage.getTempDir();
        const timestamp = Date.now();
        const videoPath = path.join(tempDir, `video_${timestamp}.mp4`);
        const outputPattern = path.join(tempDir, `frame_${timestamp}_%03d.png`);

        // Log extraction start
        datasetLogger.log("Starting video frame extraction", { 
            videoSize: videoBuffer.length, 
            videoPath, 
            outputPattern 
        });

        // Ensure temp directory exists
        try {
            await DatasetService.checkFfmpegAvailable();
            await fs.writeFile(videoPath, videoBuffer);
            return await DatasetService.runFfmpegExtraction(videoPath, outputPattern, tempDir, timestamp);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VIDEO_EXTRACTION", "file_system", err.message);
            throw err;
        }
    }

    // Handle FFmpeg end event and read extracted frames
    private static async handleFfmpegEnd(
        resolve: (value: Buffer[]) => void,
        reject: (reason?: unknown) => void,
        tempDir: string,
        timestamp: number,
        videoPath: string
    ) {
        // Read extracted frames
        try {
            // List files in temp directory
            const files = await fs.readdir(tempDir);
            const frameFiles = files.filter(f =>
                f.startsWith(`frame_${timestamp}`) && f.endsWith(".png")
            ).sort((a, b) => a.localeCompare(b));

            // Read each frame into buffer
            const frames: Buffer[] = [];
            for (const file of frameFiles) {
                const framePath = path.join(tempDir, file);
                const frameBuffer = await fs.readFile(framePath);
                frames.push(frameBuffer);
                await fs.unlink(framePath).catch(() => {}); 
            }

            // Cleanup video file
            await fs.unlink(videoPath).catch(() => {}); 

            // Handle case of no frames extracted
            if (frames.length === 0) {
                errorLogger.logDatabaseError("VIDEO_EXTRACTION", "ffmpeg", "No frames extracted from video");
                reject(new Error("No frames were extracted from the video. The video might be corrupted or in an unsupported format."));
                return;
            }

            // Log extraction completion
            datasetLogger.log("Video frame extraction completed", {
                frameCount: frames.length,
                totalSize: frames.reduce((sum, frame) => sum + frame.length, 0)
            });

            // Resolve with extracted frames
            resolve(frames);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VIDEO_EXTRACTION", "file_system", err.message);
            reject(err instanceof Error ? err : new Error(String(error)));
        }
    }

    // Run FFmpeg command to extract frames with timeout and error handling
    private static runFfmpegExtraction(
        videoPath: string,
        outputPattern: string,
        tempDir: string,
        timestamp: number
    ): Promise<Buffer[]> {
        return new Promise((resolve, reject) => {
            const command = ffmpeg(videoPath)
                .outputOptions([
                    "-vf", "fps=1", // Extract 1 frame per second
                    "-q:v", "2"    // Set quality for output frames  
                ])
                .output(outputPattern)
                .on("start", (commandLine) => {
                    datasetLogger.log("FFmpeg command started", { command: commandLine });
                })
                .on("end", async () => {
                    await DatasetService.handleFfmpegEnd(resolve, reject, tempDir, timestamp, videoPath);
                })
                .on("error", (error) => {
                    errorLogger.logDatabaseError("VIDEO_EXTRACTION", "ffmpeg", error.message);
                    // Cleanup on error
                    fs.unlink(videoPath).catch(() => {});
                    reject(new Error(`Video processing failed: ${error.message}`));
                });

            // Add timeout to prevent hanging
            const timeout = setTimeout(() => {
                command.kill("SIGKILL");
                fs.unlink(videoPath).catch(() => {});
                errorLogger.logDatabaseError("VIDEO_EXTRACTION", "ffmpeg", "Processing timeout (60 seconds)");
                reject(new Error("Video processing timeout (60 seconds)"));
            }, 60000);

            // Clear timeout on completion or error
            command.on("end", () => clearTimeout(timeout));
            command.on("error", () => clearTimeout(timeout));

            command.run();
        });
    }

    // Check if FFmpeg is available on the system
    private static checkFfmpegAvailable(): Promise<void> {
        return new Promise((resolve, reject) => {
            // Check if ffmpeg is available
            ffmpeg.getAvailableFormats((err) => {
                if (err) {
                    errorLogger.logDatabaseError("FFMPEG_CHECK", "system", `FFmpeg not available: ${err.message}`);
                    reject(new Error(`FFmpeg is not available: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });
    }

    // Validate that a mask image is binary (only black and white pixels)
    private static async validateBinaryMask(imageBuffer: Buffer): Promise<boolean> {
        try {
            // Convert image to greyscale and get raw pixel data
            const { data } = await sharp(imageBuffer)
                .greyscale()
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            // Check if all pixels are either 0 (black) or 255 (white)
            for (const pixel of data) {
                if (pixel !== 0 && pixel !== 255) {
                    return false;
                }
            }
            return true;
        } catch (error) {
            // Log and return false on error
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logValidationError("binaryMask", "imageBuffer", err.message);
            return false;
        }
    }

    // Add data to dataset and increment nextUploadIndex atomically
    private static async addDataToDatasetAndIncrementIndex(
        userId: string, 
        datasetName: string, 
        data: DatasetData,
        nextUploadIndex: number
    ): Promise<{ processedItems: number }> {
        try {
            const dataset = await DatasetService.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                throw this.errorManager.createError(
                    ErrorStatus.resourceNotFoundError,
                    "Dataset not found during data addition."
                );
            }

            // Merge new data with existing dataset data
            let currentData: DatasetData = dataset.data as DatasetData || { type: data.type, pairs: [] };
            
            // Ensure pairs array exists
            if (!currentData.pairs) {
                currentData.pairs = [];
            }
            
            // Append new pairs to existing pairs
            const updatedData: DatasetData = {
                ...currentData,
                pairs: [
                    ...currentData.pairs,
                    ...data.pairs
                ]
            };

            // Update dataset with both data and nextUploadIndex in a single operation
            await DatasetService.datasetRepository.updateDataset(userId, datasetName, { 
                data: updatedData,
                nextUploadIndex: nextUploadIndex
            });

            // Verify the update was successful
            const verificationDataset = await DatasetService.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
            if (!verificationDataset) {
                throw this.errorManager.createError(
                    ErrorStatus.creationInternalServerError,
                    "Dataset update verification failed."
                );
            }

            // Check that the number of pairs matches
            const verificationData = verificationDataset.data as DatasetData;
            const actualPairCount = verificationData?.pairs?.length || 0;
            
            // Log discrepancy if counts do not match
            if (actualPairCount !== updatedData.pairs.length) {
                throw this.errorManager.createError(
                    ErrorStatus.creationInternalServerError,
                    "Data verification failed after dataset update."
                );
            }

            // Log successful update
            datasetLogger.log("Dataset updated successfully", { 
                userId, 
                datasetName, 
                processedItems: data.pairs.length,
                totalItems: actualPairCount,
                nextUploadIndex: verificationDataset.nextUploadIndex
            });

            // Return count of processed items
            return { processedItems: data.pairs.length };
        } catch (error) {
            // Re-throw standardized errors
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            
            // Log and wrap unexpected errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("ADD_DATA_TO_DATASET", "datasets", err.message);
            throw this.errorManager.createError(
                ErrorStatus.creationInternalServerError,
                "Failed to add data to dataset."
            );
        }
    }
}