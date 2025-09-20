import AdmZip from "adm-zip";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import { loggerFactory, DatasetRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { DatasetRepository } from "../repository/datasetRepository";
import { FileStorage } from "../utils/fileStorage";
import { TokenService } from "../services/tokenService";

// Initialize loggers
const datasetLogger: DatasetRouteLogger = loggerFactory.createDatasetLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

interface DatasetData {
    type: "image-mask" | "video-frames";
    pairs: Array<{
        imagePath: string;
        maskPath: string;
        frameIndex?: number;
        uploadIndex: number; // Add upload index to track upload batches
    }>;
}

export class DatasetMiddleware {
    private static readonly datasetRepository = DatasetRepository.getInstance();
    private static readonly tokenService = TokenService.getInstance();

    private static readonly PRICING_STRUCTURE = {
        SINGLE_IMAGE_DATASET: 0.65,
        VIDEO_FRAME_DATASET: 0.4,
        ZIP_FILE_DATASET: 0.7
    };

    // Modern multer configuration without callbacks
    static readonly fileStorageConfig = multer.diskStorage({
        destination: (request, uploadedFile, callback) => {
            const tempStoragePath = path.join(process.cwd(), "uploads", "temp");
            // Ensure directory exists asynchronously
            fs.mkdir(tempStoragePath, { recursive: true })
                .then(() => callback(null, tempStoragePath))
                .catch((error) => {
                    const err = error instanceof Error ? error : new Error("Unknown error");
                    errorLogger.logDatabaseError("FILE_STORAGE", "file_system", err.message);
                    callback(err, "");
                });
        },
        filename: (request, uploadedFile, callback) => {
            try {
                const timestamp = Date.now();
                const randomSuffix = Math.floor(Math.random() * 999999);
                const fileExtension = path.extname(uploadedFile.originalname);
                const generatedName = `upload_${timestamp}_${randomSuffix}${fileExtension}`;
                callback(null, generatedName);
            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logFileUploadError(uploadedFile.originalname, uploadedFile.size, err.message);
                callback(err, "");
            }
        }
    });

    static readonly fileUploadHandler = multer({
        storage: DatasetMiddleware.fileStorageConfig,
        limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
        fileFilter: (request, uploadedFile, callback) => {
            try {
                const supportedExtensions = /jpeg|jpg|png|mp4|avi|mov|zip/;
                const extensionCheck = supportedExtensions.test(
                    path.extname(uploadedFile.originalname).toLowerCase()
                );
                const mimeTypeCheck = supportedExtensions.test(uploadedFile.mimetype);
                
                if (mimeTypeCheck && extensionCheck) {
                    callback(null, true);
                } else {
                    const error = new Error("File type not supported");
                    errorLogger.logFileUploadError(
                        uploadedFile.originalname, 
                        uploadedFile.size, 
                        "Unsupported file type"
                    );
                    callback(error);
                }
            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logFileUploadError(uploadedFile.originalname, uploadedFile.size, err.message);
                callback(err);
            }
        }
    });

    // Modern file validation utility
    static async validateUploadedFiles(files: { image?: Express.Multer.File[]; mask?: Express.Multer.File[] }): Promise<{ success: boolean; error?: string }> {
        try {
            if (!files.image || !files.mask || files.image.length === 0 || files.mask.length === 0) {
                return { success: false, error: "Both image and mask files are required" };
            }

            const imageFile = files.image[0];
            const maskFile = files.mask[0];

            // Validate file existence
            const imageExists = await fs.access(imageFile.path).then(() => true).catch(() => false);
            const maskExists = await fs.access(maskFile.path).then(() => true).catch(() => false);

            if (!imageExists || !maskExists) {
                return { success: false, error: "Uploaded files not found on disk" };
            }

            return { success: true };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logFileUploadError("validation", 0, err.message);
            return { success: false, error: "File validation failed" };
        }
    }

    // Create an empty dataset
    static async createEmptyDataset(userId: string, name: string, tags?: string[]): Promise<{ success: boolean; dataset?: Record<string, unknown>; error?: string }> {
        try {
            // Check if dataset already exists
            const exists = await DatasetMiddleware.datasetRepository.datasetExists(userId, name);

            if (exists) {
                errorLogger.logValidationError("datasetName", name, "Dataset with this name already exists");
                return { success: false, error: "Dataset with this name already exists" };
            }

            // Create empty dataset
            const dataset = await DatasetMiddleware.datasetRepository.createDataset({
                userId,
                name,
                data: null,
                tags: tags || []
            });

            datasetLogger.logDatasetCreation(userId, name);
            return { success: true, dataset: dataset.toJSON() };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("CREATE_EMPTY_DATASET", "datasets", err.message);
            return { success: false, error: "Failed to create dataset" };
        }
    }

    // Process and add data to dataset with token management
    static async processAndAddData(
        userId: string,
        datasetName: string,
        imageFile: Express.Multer.File,
        maskFile: Express.Multer.File
    ): Promise<{
        success: boolean;
        processedItems?: number;
        error?: string;
        message?: string;
        details?: {
            requiredTokens: number;
            currentBalance: number;
            shortfall: number;
            operationType: string;
            actionRequired: string;
        };
        reservationId?: string;
        tokenCost?: number;
    }> {
        const tempFiles: string[] = [imageFile.path, maskFile.path];
        let tokenReservationId: string | undefined;

        try {
            const { tokenCost, processedFrameCount } = await this.calculateTokenCost(imageFile, maskFile);
            if (tokenCost === -1) {
                await FileStorage.cleanupTempFiles(tempFiles);
                return { success: false, error: "Unsupported file format" };
            }

            const reservation = await this.handleTokenReservation(userId, datasetName, tokenCost);
            if (!reservation.success) {
                await FileStorage.cleanupTempFiles(tempFiles);
                return reservation.errorResponse ?? {
                    success: false,
                    error: "Token reservation failed",
                    message: "Failed to reserve tokens for this operation. Please try again."
                };
            }
            tokenReservationId = reservation.reservationId;

            const dataset = await this.getDatasetOrHandleError(userId, datasetName, tokenReservationId, tempFiles);
            if (!dataset) return { success: false, error: "Dataset not found" };

            const processedData = await this.processUploadedFiles(
                imageFile,
                maskFile,
                `${userId}/${datasetName}`,
                dataset.nextUploadIndex
            );

            this.logFrameCountIfMismatch(imageFile, processedData, processedFrameCount);

            const result = await this.addDataToDatasetAndIncrementIndex(userId, datasetName, processedData, dataset.nextUploadIndex + 1);

            if (result.success) {
                await FileStorage.cleanupTempFiles(tempFiles);
                datasetLogger.logDatasetUpdate(userId, datasetName, result.processedItems);
                return {
                    success: true,
                    processedItems: result.processedItems,
                    reservationId: tokenReservationId,
                    tokenCost: tokenCost
                };
            } else {
                await this.refundTokensIfNeeded(tokenReservationId);
                await FileStorage.cleanupTempFiles(tempFiles);
                return result;
            }
        } catch (error) {
            await this.handleProcessAndAddDataError(error, tokenReservationId, tempFiles);
            return { success: false, error: "Failed to process data", message: (error instanceof Error ? error.message : String(error)) };
        }
    }

    private static async getDatasetOrHandleError(
        userId: string,
        datasetName: string,
        tokenReservationId: string | undefined,
        tempFiles: string[]
    ) {
        const dataset = await DatasetMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
        if (!dataset) {
            await this.refundTokensIfNeeded(tokenReservationId);
            await FileStorage.cleanupTempFiles(tempFiles);
            errorLogger.logDatabaseError("PROCESS_DATA", "datasets", "Dataset not found");
            return null;
        }
        return dataset;
    }

    private static logFrameCountIfMismatch(
        imageFile: Express.Multer.File,
        processedData: DatasetData,
        processedFrameCount?: number
    ) {
        const imageExt = path.extname(imageFile.originalname).toLowerCase();
        if (this.isVideoFile(imageExt) && processedData.pairs.length !== processedFrameCount) {
            datasetLogger.log("Frame count mismatch detected", {
                expected: processedFrameCount,
                actual: processedData.pairs.length,
                adjustingCost: true
            });
        }
    }

    private static async refundTokensIfNeeded(tokenReservationId: string | undefined) {
        if (tokenReservationId) {
            await DatasetMiddleware.tokenService.refundTokens(tokenReservationId);
        }
    }

    private static async handleProcessAndAddDataError(
        error: unknown,
        tokenReservationId: string | undefined,
        tempFiles: string[]
    ) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        errorLogger.logDatabaseError("PROCESS_AND_ADD_DATA", "datasets", err.message);
        await this.refundTokensIfNeeded(tokenReservationId);
        await FileStorage.cleanupTempFiles(tempFiles);
    }

    private static isVideoFile(extension: string): boolean {
        return [".mp4", ".avi", ".mov"].includes(extension);
    }

    private static async calculateZipTokenCost(zipFile: Express.Multer.File): Promise<number> {
        const zipBuffer = await fs.readFile(zipFile.path);
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries().filter(entry => !entry.isDirectory);
        const subdirs = new Map<string, { images: number; videos: number }>();
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];

        for (const entry of entries) {
            const pathParts = entry.entryName.split("/");
            if (pathParts.length < 2) continue;
            const subdir = pathParts[0];
            if (!subdirs.has(subdir)) subdirs.set(subdir, { images: 0, videos: 0 });

            const filename = pathParts[pathParts.length - 1];
            if (filename.toLowerCase().includes("mask")) continue;

            const ext = path.extname(filename).toLowerCase();
            const subdirData = subdirs.get(subdir)!;
            if (videoFormats.includes(ext)) subdirData.videos++;
            else if (imageFormats.includes(ext)) subdirData.images++;
        }

        const totalPairs = Array.from(subdirs.values()).reduce((sum, data) => sum + data.images + data.videos, 0);
        return totalPairs * this.PRICING_STRUCTURE.ZIP_FILE_DATASET;
    }

    private static async calculateTokenCost(imageFile: Express.Multer.File, maskFile: Express.Multer.File): Promise<{ tokenCost: number; processedFrameCount?: number }> {
        const imageExt = path.extname(imageFile.originalname).toLowerCase();
        const maskExt = path.extname(maskFile.originalname).toLowerCase();
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];
        const zipFormats = [".zip"];

        if (zipFormats.includes(imageExt)) {
            const tokenCost = await this.calculateZipTokenCost(imageFile);
            return { tokenCost };
        }

        if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
            return { tokenCost: this.PRICING_STRUCTURE.SINGLE_IMAGE_DATASET };
        }

        if (videoFormats.includes(imageExt)) {
            const videoBuffer = await fs.readFile(imageFile.path);
            const frameBuffers = await this.extractFramesFromVideo(videoBuffer);
            const processedFrameCount = frameBuffers.length;
            const tokenCost = processedFrameCount * this.PRICING_STRUCTURE.VIDEO_FRAME_DATASET;
            datasetLogger.log("Video frame extraction for cost calculation", { videoName: imageFile.originalname, actualFrameCount: processedFrameCount, exactCost: tokenCost });
            return { tokenCost, processedFrameCount };
        }

        errorLogger.logFileUploadError(imageFile.originalname, imageFile.size, "Unsupported file format");
        return { tokenCost: -1 };
    }

    private static async handleTokenReservation(userId: string, datasetName: string, tokenCost: number) {
        const reservationResult = await DatasetMiddleware.tokenService.reserveTokens(userId, tokenCost, "dataset_upload", `${datasetName}_${Date.now()}`);

        if (reservationResult.success) {
            return { success: true, reservationId: reservationResult.reservationId! };
        }

        let errorResponse: {
            success: boolean;
            error: string;
            message: string;
            details?: {
                requiredTokens: number;
                currentBalance: number;
                shortfall: number;
                operationType: string;
                actionRequired: string;
            };
        } = {
            success: false,
            error: "Token reservation failed",
            message: reservationResult.error || "Failed to reserve tokens for this operation. Please try again."
        };

        if (reservationResult.error?.includes("Insufficient tokens")) {
            const errorRegex = /Required: ([\d.]+) tokens, Current balance: ([\d.]+) tokens, Shortfall: ([\d.]+) tokens/;
            const errorParts = errorRegex.exec(reservationResult.error);
            errorResponse.error = "Insufficient tokens";

            if (errorParts) {
                const [required, current, shortfall] = errorParts.slice(1).map(parseFloat);
                errorLogger.logAuthorizationError(userId, `Insufficient tokens for dataset upload: ${required}`);
                errorResponse.message = `You need ${required} tokens for this dataset upload operation, but your current balance is ${current} tokens. You are short ${shortfall} tokens. Please contact an administrator to recharge your account.`;
                errorResponse.details = { requiredTokens: required, currentBalance: current, shortfall, operationType: "dataset upload", actionRequired: "Token recharge needed" };
            } else {
                errorLogger.logAuthorizationError(userId, `Insufficient tokens for dataset upload: ${tokenCost}`);
                errorResponse.message = reservationResult.error;
            }
        } else {
            errorLogger.logDatabaseError("RESERVE_TOKENS", "dataset_upload", reservationResult.error || "Token reservation failed");
        }

        return { success: false, errorResponse };
    }

    private static async processUploadedFiles(imageFile: Express.Multer.File, maskFile: Express.Multer.File, subfolder: string, uploadIndex: number): Promise<DatasetData> {
        const imageExt = path.extname(imageFile.originalname).toLowerCase();
        const maskExt = path.extname(maskFile.originalname).toLowerCase();
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];
        const zipFormats = [".zip"];

        datasetLogger.logDataProcessing(imageFile.originalname, subfolder, imageExt, true);

        if (zipFormats.includes(imageExt)) {
            const zipBuffer = await fs.readFile(imageFile.path);
            return this.processZipFile(zipBuffer, subfolder, uploadIndex);
        }

        const imageBuffer = await fs.readFile(imageFile.path);
        const maskBuffer = await fs.readFile(maskFile.path);

        if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
            return this.processImageMaskPair(imageBuffer, maskBuffer, subfolder, imageFile.originalname, maskFile.originalname, uploadIndex);
        }

        if (videoFormats.includes(imageExt)) {
            if (imageFormats.includes(maskExt)) {
                return this.processVideoWithSingleMask(imageBuffer, maskBuffer, subfolder, imageFile.originalname, maskFile.originalname, uploadIndex);
            }
            if (videoFormats.includes(maskExt)) {
                return this.processVideoWithMaskVideo(imageBuffer, maskBuffer, subfolder, imageFile.originalname, maskFile.originalname, uploadIndex);
            }
            throw new Error("Invalid mask format for video");
        }

        throw new Error("Unsupported file format combination");
    }

    // Process image-mask pair - updated to include upload index
    private static async processImageMaskPair(
        imageBuffer: Buffer, 
        maskBuffer: Buffer, 
        subfolder: string,
        imageName: string,
        maskName: string,
        uploadIndex: number
    ): Promise<DatasetData> {
        // Validate that mask is binary
        const isBinary = await this.validateBinaryMask(maskBuffer);
        if (!isBinary) {
            errorLogger.logValidationError("mask", maskName, "Mask must be a binary image");
            throw new Error("Mask must be a binary image");
        }

        // Save files to permanent storage
        const imagePath = await FileStorage.saveFile(imageBuffer, imageName, subfolder);
        const maskPath = await FileStorage.saveFile(maskBuffer, maskName, subfolder);

        datasetLogger.log("Image-mask pair processed", { imagePath, maskPath, uploadIndex });

        return {
            type: "image-mask",
            pairs: [{
                imagePath,
                maskPath,
                uploadIndex
            }]
        };
    }

    // Process video with single mask - updated to include upload index for all frames
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

        for (let i = 0; i < frameBuffers.length; i++) {
            const frameName = `${path.parse(videoName).name}_frame_${i.toString().padStart(3, "0")}.png`;
            const framePath = await FileStorage.saveFile(frameBuffers[i], frameName, subfolder);
            pairs.push({
                imagePath: framePath,
                maskPath,
                frameIndex: i,
                uploadIndex // Same upload index for all frames of the same video
            });
        }

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

    // Process video with mask video - updated to include upload index for all frames
    private static async processVideoWithMaskVideo(
        videoBuffer: Buffer, 
        maskVideoBuffer: Buffer, 
        subfolder: string,
        videoName: string,
        maskVideoName: string,
        uploadIndex: number
    ): Promise<DatasetData> {
        const frames = await this.extractFramesFromVideo(videoBuffer);
        const maskFrames = await this.extractFramesFromVideo(maskVideoBuffer);

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

        const pairs: DatasetData["pairs"] = [];
        
        for (let i = 0; i < frames.length; i++) {
            const frameName = `${path.parse(videoName).name}_frame_${i.toString().padStart(3, "0")}.png`;
            const maskFrameName = `${path.parse(maskVideoName).name}_mask_${i.toString().padStart(3, "0")}.png`;
            
            const framePath = await FileStorage.saveFile(frames[i], frameName, subfolder);
            const maskPath = await FileStorage.saveFile(maskFrames[i], maskFrameName, subfolder);
            
            pairs.push({
                imagePath: framePath,
                maskPath,
                frameIndex: i,
                uploadIndex // Same upload index for all frames of the same video
            });
        }

        datasetLogger.log("Video with mask video processed", { 
            videoName, 
            maskVideoName, 
            framesProcessed: pairs.length, 
            uploadIndex 
        });

        return {
            type: "video-frames",
            pairs
        };
    }

    // Process ZIP file - updated to handle upload indexing for multiple subdirectories
    private static async processZipFile(zipBuffer: Buffer, subfolder: string, startUploadIndex: number): Promise<DatasetData> {
        const zip = new AdmZip(zipBuffer);
        const subdirs = this.groupZipEntriesBySubdirectory(zip.getEntries());

        datasetLogger.log("ZIP file analyzed", {
            totalEntries: zip.getEntries().length,
            subdirectoriesFound: subdirs.size,
            subdirectoryNames: Array.from(subdirs.keys())
        });

        const { pairs, processedSubdirs, skippedSubdirs } = await this.processZipSubdirectories(subdirs, subfolder, startUploadIndex);

        if (pairs.length === 0 && subdirs.size > 0) {
            const errorMessage = "ZIP processing failed: No valid image-mask pairs were found in any subdirectory.";
            errorLogger.logFileUploadError("ZIP", zipBuffer.length, errorMessage);
            throw new Error(errorMessage);
        }

        datasetLogger.log("ZIP processing completed successfully", {
            totalSubdirectories: subdirs.size,
            processedSubdirs,
            skippedSubdirs,
            totalPairs: pairs.length
        });

        return { type: "image-mask", pairs };
    }

    private static groupZipEntriesBySubdirectory(entries: AdmZip.IZipEntry[]): Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }> {
        const subdirs = new Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }>();
        const supportedFormats = [".png", ".jpg", ".jpeg", ".mp4", ".avi", ".mov"];

        for (const entry of entries) {
            if (entry.isDirectory) continue;

            const pathParts = entry.entryName.split("/");
            if (pathParts.length < 2) continue;

            const subdir = pathParts[0];
            const filename = pathParts[pathParts.length - 1];
            const ext = path.extname(filename).toLowerCase();

            if (!supportedFormats.includes(ext)) {
                errorLogger.logFileUploadError(filename, undefined, `Unsupported file format: ${ext}`);
                continue;
            }

            if (!subdirs.has(subdir)) {
                subdirs.set(subdir, { images: [], masks: [] });
            }

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

    private static async processZipSubdirectories(subdirs: Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }>, subfolder: string, startUploadIndex: number) {
        let pairs: DatasetData["pairs"] = [];
        let processedSubdirs = 0;
        let skippedSubdirs = 0;
        let currentUploadIndex = startUploadIndex;

        for (const [subdirName, { images, masks }] of subdirs) {
            if (!this.validateSubdirectory(subdirName, images, masks)) {
                skippedSubdirs++;
                continue;
            }

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

    private static validateSubdirectory(subdirName: string, images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[]): boolean {
        if (images.length === 0 || masks.length === 0) {
            errorLogger.logValidationError("subdirectory", subdirName, "Missing images or masks");
            return false;
        }
        if (!this.validateSubdirectoryFormats(images, masks)) {
            errorLogger.logValidationError("subdirectory", subdirName, "No valid format combinations found");
            return false;
        }
        return true;
    }

    private static async processSingleSubdirectory(subdirName: string, files: { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }, subfolder: string, currentUploadIndex: number) {
        const { images, masks } = files;
        images.sort((a, b) => a.name.localeCompare(b.name));
        masks.sort((a, b) => a.name.localeCompare(b.name));

        const pairs: DatasetData["pairs"] = [];
        const minLength = Math.min(images.length, masks.length);
        let subdirPairsProcessed = 0;

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

        if (subdirPairsProcessed > 0) {
            datasetLogger.log("Subdirectory processed successfully", { subdirName, pairsProcessed: subdirPairsProcessed });
        } else {
            errorLogger.logValidationError("subdirectory", subdirName, "No successfully processed pairs");
        }

        return { pairs, nextUploadIndex: currentUploadIndex };
    }

    private static async processZipPair(imageEntry: AdmZip.IZipEntry, maskEntry: AdmZip.IZipEntry, zipSubfolder: string, uploadIndex: number) {
        const imageBuffer = imageEntry.getData();
        const maskBuffer = maskEntry.getData();
        const imageExt = path.extname(imageEntry.name).toLowerCase();
        const maskExt = path.extname(maskEntry.name).toLowerCase();
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];

        let subData: DatasetData;
        let nextUploadIndex = uploadIndex;

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

    // Helper method to validate subdirectory format combinations
    private static validateSubdirectoryFormats(images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[]): boolean {
        const imageFormats = [".png", ".jpg", ".jpeg"];
        const videoFormats = [".mp4", ".avi", ".mov"];

        // Check if any combination of formats is valid
        for (const imageEntry of images) {
            const imageExt = path.extname(imageEntry.name).toLowerCase();
            
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

    // Extract frames from video with better error handling and logging
    private static async extractFramesFromVideo(videoBuffer: Buffer): Promise<Buffer[]> {
        const tempDir = FileStorage.getTempDir();
        const timestamp = Date.now();
        const videoPath = path.join(tempDir, `video_${timestamp}.mp4`);
        const outputPattern = path.join(tempDir, `frame_${timestamp}_%03d.png`);

        datasetLogger.log("Starting video frame extraction", { 
            videoSize: videoBuffer.length, 
            videoPath, 
            outputPattern 
        });

        try {
            await DatasetMiddleware.checkFfmpegAvailable();
            await fs.writeFile(videoPath, videoBuffer);
            return await DatasetMiddleware.runFfmpegExtraction(videoPath, outputPattern, tempDir, timestamp);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VIDEO_EXTRACTION", "file_system", err.message);
            throw err;
        }
    }

    // Helper function for FFmpeg extraction
    private static async handleFfmpegEnd(
        resolve: (value: Buffer[]) => void,
        reject: (reason?: unknown) => void,
        tempDir: string,
        timestamp: number,
        videoPath: string
    ) {
        try {
            const files = await fs.readdir(tempDir);
            const frameFiles = files.filter(f =>
                f.startsWith(`frame_${timestamp}`) && f.endsWith(".png")
            ).sort((a, b) => a.localeCompare(b));

            const frames: Buffer[] = [];
            for (const file of frameFiles) {
                const framePath = path.join(tempDir, file);
                const frameBuffer = await fs.readFile(framePath);
                frames.push(frameBuffer);
                await fs.unlink(framePath).catch(() => {}); // Ignore cleanup errors
            }

            await fs.unlink(videoPath).catch(() => {}); // Ignore cleanup errors

            if (frames.length === 0) {
                errorLogger.logDatabaseError("VIDEO_EXTRACTION", "ffmpeg", "No frames extracted from video");
                reject(new Error("No frames were extracted from the video. The video might be corrupted or in an unsupported format."));
                return;
            }

            datasetLogger.log("Video frame extraction completed", {
                frameCount: frames.length,
                totalSize: frames.reduce((sum, frame) => sum + frame.length, 0)
            });

            resolve(frames);
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VIDEO_EXTRACTION", "file_system", err.message);
            reject(err instanceof Error ? err : new Error(String(error)));
        }
    }

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
                    "-q:v", "2"     // High quality
                ])
                .output(outputPattern)
                .on("start", (commandLine) => {
                    datasetLogger.log("FFmpeg command started", { command: commandLine });
                })
                .on("end", async () => {
                    await DatasetMiddleware.handleFfmpegEnd(resolve, reject, tempDir, timestamp, videoPath);
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

            command.on("end", () => clearTimeout(timeout));
            command.on("error", () => clearTimeout(timeout));

            command.run();
        });
    }

    // Helper function for FFmpeg availability check
    private static checkFfmpegAvailable(): Promise<void> {
        return new Promise((resolve, reject) => {
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
    // Validate that an image is binary (only black and white pixels)
    private static async validateBinaryMask(imageBuffer: Buffer): Promise<boolean> {
        try {
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
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logValidationError("binaryMask", "imageBuffer", err.message);
            return false;
        }
    }

    // Add processed data to dataset and increment upload index in a single transaction
    private static async addDataToDatasetAndIncrementIndex(
        userId: string, 
        datasetName: string, 
        data: DatasetData,
        nextUploadIndex: number
    ): Promise<{ success: boolean; processedItems?: number; error?: string }> {
        try {
            // Get existing dataset with detailed logging
            console.log(`Searching for dataset: userId=${userId}, name=${datasetName}`);
            const dataset = await DatasetMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                console.error(`Dataset not found: userId=${userId}, name=${datasetName}`);
                errorLogger.logDatabaseError("ADD_DATA_TO_DATASET", "datasets", "Dataset not found");
                return { success: false, error: "Dataset not found" };
            }

            console.log(`Found dataset: id=${dataset.id}, name=${dataset.name}, currentNextIndex=${dataset.nextUploadIndex}`);

            let currentData: DatasetData = dataset.data as DatasetData || { type: data.type, pairs: [] };
            
            // Merge new data with existing data
            if (!currentData.pairs) {
                currentData.pairs = [];
            }
            
            console.log(`Current data pairs: ${currentData.pairs.length}, New pairs to add: ${data.pairs.length}`);
            
            // Store file paths directly (no base64 conversion)
            const updatedData: DatasetData = {
                ...currentData,
                pairs: [
                    ...currentData.pairs,
                    ...data.pairs
                ]
            };

            console.log(`Preparing to update dataset with: totalPairs=${updatedData.pairs.length}, nextUploadIndex=${nextUploadIndex}`);

            // Update dataset with both data and nextUploadIndex in a single operation
            await DatasetMiddleware.datasetRepository.updateDataset(userId, datasetName, { 
                data: updatedData,
                nextUploadIndex: nextUploadIndex
            });

            // Verify the update was successful
            const verificationDataset = await DatasetMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);
            if (!verificationDataset) {
                console.error("Dataset verification failed: could not retrieve dataset after update");
                return { success: false, error: "Dataset update verification failed" };
            }

            const verificationData = verificationDataset.data as DatasetData;
            const actualPairCount = verificationData?.pairs?.length || 0;
            
            console.log(`Dataset update verification: expectedPairs=${updatedData.pairs.length}, actualPairs=${actualPairCount}, nextIndex=${verificationDataset.nextUploadIndex}`);

            if (actualPairCount !== updatedData.pairs.length) {
                console.error(`Data mismatch after update: expected ${updatedData.pairs.length} pairs, got ${actualPairCount}`);
                return { success: false, error: "Data verification failed after update" };
            }

            datasetLogger.log("Dataset updated successfully", { 
                userId, 
                datasetName, 
                processedItems: data.pairs.length,
                totalItems: actualPairCount,
                nextUploadIndex: verificationDataset.nextUploadIndex
            });

            return { success: true, processedItems: data.pairs.length };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            console.error("Error in addDataToDatasetAndIncrementIndex:", {
                userId,
                datasetName,
                error: err.message,
                stack: err.stack
            });
            errorLogger.logDatabaseError("ADD_DATA_TO_DATASET", "datasets", err.message);
            return { success: false, error: "Failed to add data to dataset" };
        }
    }
}
