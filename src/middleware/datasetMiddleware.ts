import AdmZip from "adm-zip";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
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
    private static datasetRepository = DatasetRepository.getInstance();
    private static tokenService = TokenService.getInstance();

    private static readonly PRICING_STRUCTURE = {
        SINGLE_IMAGE_DATASET: 0.65,
        VIDEO_FRAME_DATASET: 0.4,
        ZIP_FILE_DATASET: 0.7
    };

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
        tokenCost?: number 
    }> {
        let tempFiles: string[] = [];
        let tokenReservationId: string | undefined;
        let calculatedTokenCost = 0;

        try {
            // Add uploaded files to cleanup list
            tempFiles.push(imageFile.path, maskFile.path);
            
            // Determine file types
            const imageExt = path.extname(imageFile.originalname).toLowerCase();
            const maskExt = path.extname(maskFile.originalname).toLowerCase();

            const imageFormats = [".png", ".jpg", ".jpeg"];
            const videoFormats = [".mp4", ".avi", ".mov"];
            const zipFormats = [".zip"];

            let tokenCost = 0;
            let processedFrameCount = 0; // For videos

            // Pre-calculate EXACT token cost by processing content first
            if (zipFormats.includes(imageExt)) {
                // For ZIP files, analyze content to get exact cost
                const zipBuffer = await fs.readFile(imageFile.path);
                const zip = new AdmZip(zipBuffer);
                const entries = zip.getEntries().filter(entry => !entry.isDirectory);
                
                // Count actual pairs in ZIP
                const subdirs = new Map<string, { images: number, videos: number, videoFrames: number }>();
                
                for (const entry of entries) {
                    const pathParts = entry.entryName.split("/");
                    if (pathParts.length < 2) continue;
                    
                    const subdir = pathParts[0];
                    const filename = pathParts[pathParts.length - 1];
                    const ext = path.extname(filename).toLowerCase();
                    
                    if (!subdirs.has(subdir)) {
                        subdirs.set(subdir, { images: 0, videos: 0, videoFrames: 0 });
                    }
                    
                    const subdirData = subdirs.get(subdir)!;
                    const isVideo = videoFormats.includes(ext);
                    
                    if (!filename.toLowerCase().includes("mask")) {
                        if (isVideo) {
                            // Extract frames to get exact count
                            try {
                                const videoBuffer = entry.getData();
                                const frames = await this.extractFramesFromVideo(videoBuffer);
                                subdirData.videos++;
                                subdirData.videoFrames += frames.length;
                            } catch (error) {
                                // Skip invalid videos
                                continue;
                            }
                        } else if (imageFormats.includes(ext)) {
                            subdirData.images++;
                        }
                    }
                }
                
                // Calculate exact cost: 0.7 per pair (image-mask or video-mask)
                let totalPairs = 0;
                for (const [, data] of subdirs) {
                    totalPairs += data.images + data.videos; // Each video counts as 1 pair regardless of frames
                }
                
                tokenCost = totalPairs * this.PRICING_STRUCTURE.ZIP_FILE_DATASET; // 0.7 per pair
                
            } else if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                // Single image-mask pair: exactly 0.65
                tokenCost = this.PRICING_STRUCTURE.SINGLE_IMAGE_DATASET; // 0.65
                
            } else if (videoFormats.includes(imageExt)) {
                // Video: extract frames first to get exact count
                const videoBuffer = await fs.readFile(imageFile.path);
                const frameBuffers = await this.extractFramesFromVideo(videoBuffer);
                processedFrameCount = frameBuffers.length;
                
                // Cost: 0.4 per frame (regardless of mask type)
                tokenCost = processedFrameCount * this.PRICING_STRUCTURE.VIDEO_FRAME_DATASET; // 0.4 per frame
                
                datasetLogger.log("Video frame extraction for cost calculation", { 
                    videoName: imageFile.originalname,
                    actualFrameCount: processedFrameCount,
                    exactCost: tokenCost
                });
                
            } else {
                errorLogger.logFileUploadError(imageFile.originalname, imageFile.size, "Unsupported file format");
                return { success: false, error: "Unsupported file format" };
            }

            // Store the calculated cost for later use
            calculatedTokenCost = tokenCost;

            // Reserve tokens with EXACT calculated cost
            const reservationResult = await DatasetMiddleware.tokenService.reserveTokens(
                userId,
                tokenCost,
                "dataset_upload",
                `${datasetName}_${Date.now()}`
            );

            if (!reservationResult.success) {
                await FileStorage.cleanupTempFiles(tempFiles);
                
                if (reservationResult.error?.includes("Insufficient tokens")) {
                    // Parse detailed error for structured response
                    const errorParts = reservationResult.error.match(/Required: ([\d.]+) tokens, Current balance: ([\d.]+) tokens, Shortfall: ([\d.]+) tokens/);
                    
                    if (errorParts) {
                        const required = parseFloat(errorParts[1]);
                        const current = parseFloat(errorParts[2]);
                        const shortfall = parseFloat(errorParts[3]);
                        
                        // NOTE: The aborted transaction is already recorded by TokenService
                        errorLogger.logAuthorizationError(userId, `Insufficient tokens for dataset upload: ${required}`);
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
                        errorLogger.logAuthorizationError(userId, `Insufficient tokens for dataset upload: ${tokenCost}`);
                        return { 
                            success: false, 
                            error: "Insufficient tokens",
                            message: reservationResult.error
                        };
                    }
                }
                
                errorLogger.logDatabaseError("RESERVE_TOKENS", "dataset_upload", reservationResult.error || "Token reservation failed");
                return { 
                    success: false, 
                    error: "Token reservation failed",
                    message: reservationResult.error || "Failed to reserve tokens for this operation. Please try again."
                };
            }

            tokenReservationId = reservationResult.reservationId!;

            // Get dataset info
            const dataset = await DatasetMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                await DatasetMiddleware.tokenService.refundTokens(tokenReservationId);
                await FileStorage.cleanupTempFiles(tempFiles);
                errorLogger.logDatabaseError("PROCESS_DATA", "datasets", "Dataset not found");
                return { success: false, error: "Dataset not found" };
            }

            const currentUploadIndex = dataset.nextUploadIndex;
            const subfolder = `${userId}/${datasetName}`;

            datasetLogger.logDataProcessing(userId, datasetName, imageExt, true);

            let processedData: DatasetData;

            // Process the actual data (reuse extracted frames for videos)
            if (zipFormats.includes(imageExt)) {
                const zipBuffer = await fs.readFile(imageFile.path);
                processedData = await this.processZipFile(zipBuffer, subfolder, currentUploadIndex);
                
            } else if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                const imageBuffer = await fs.readFile(imageFile.path);
                const maskBuffer = await fs.readFile(maskFile.path);
                processedData = await this.processImageMaskPair(
                    imageBuffer, 
                    maskBuffer, 
                    subfolder, 
                    imageFile.originalname, 
                    maskFile.originalname, 
                    currentUploadIndex
                );
                
            } else if (videoFormats.includes(imageExt)) {
                const videoBuffer = await fs.readFile(imageFile.path);
                const maskBuffer = await fs.readFile(maskFile.path);
                
                if (imageFormats.includes(maskExt)) {
                    processedData = await this.processVideoWithSingleMask(
                        videoBuffer, 
                        maskBuffer, 
                        subfolder, 
                        imageFile.originalname, 
                        maskFile.originalname, 
                        currentUploadIndex
                    );
                } else if (videoFormats.includes(maskExt)) {
                    processedData = await this.processVideoWithMaskVideo(
                        videoBuffer, 
                        maskBuffer, 
                        subfolder, 
                        imageFile.originalname, 
                        maskFile.originalname, 
                        currentUploadIndex
                    );
                } else {
                    await DatasetMiddleware.tokenService.refundTokens(tokenReservationId);
                    await FileStorage.cleanupTempFiles(tempFiles);
                    errorLogger.logFileUploadError(imageFile.originalname, imageFile.size, "Invalid mask format for video");
                    return { success: false, error: "Invalid mask format for video" };
                }
            } else {
                await DatasetMiddleware.tokenService.refundTokens(tokenReservationId);
                await FileStorage.cleanupTempFiles(tempFiles);
                errorLogger.logFileUploadError(imageFile.originalname, imageFile.size, "Unsupported file format");
                return { success: false, error: "Unsupported file format" };
            }

            // Verify the processed data matches our cost calculation
            if (videoFormats.includes(imageExt) && processedData.pairs.length !== processedFrameCount) {
                datasetLogger.log("Frame count mismatch detected", {
                    expected: processedFrameCount,
                    actual: processedData.pairs.length,
                    adjustingCost: true
                });
            }

            // Add processed data to dataset
            const result = await this.addDataToDatasetAndIncrementIndex(userId, datasetName, processedData, currentUploadIndex + 1);
            
            if (result.success) {
                // DON'T confirm token usage here - let the controller handle it
                
                await FileStorage.cleanupTempFiles(tempFiles);
                
                datasetLogger.logDatasetUpdate(userId, datasetName, result.processedItems);
                
                return { 
                    success: true, 
                    processedItems: result.processedItems,
                    reservationId: tokenReservationId,
                    tokenCost: calculatedTokenCost // Return the calculated cost
                };
            } else {
                await DatasetMiddleware.tokenService.refundTokens(tokenReservationId);
                await FileStorage.cleanupTempFiles(tempFiles);
                return result;
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("PROCESS_AND_ADD_DATA", "datasets", err.message);
            
            if (tokenReservationId) {
                await DatasetMiddleware.tokenService.refundTokens(tokenReservationId);
            }
            
            await FileStorage.cleanupTempFiles(tempFiles);
            return { success: false, error: "Failed to process data" };
        }
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
        const entries = zip.getEntries();
        const pairs: DatasetData["pairs"] = [];

        // Group entries by subdirectory with better file classification
        const subdirs = new Map<string, { images: AdmZip.IZipEntry[], masks: AdmZip.IZipEntry[] }>();

        for (const entry of entries) {
            if (entry.isDirectory) continue;

            const pathParts = entry.entryName.split("/");
            if (pathParts.length < 2) continue;

            const subdir = pathParts[0];
            const filename = pathParts[pathParts.length - 1];
            const ext = path.extname(filename).toLowerCase();

            // Skip unsupported file formats early
            const supportedFormats = [".png", ".jpg", ".jpeg", ".mp4", ".avi", ".mov"];
            if (!supportedFormats.includes(ext)) {
                errorLogger.logFileUploadError(filename, undefined, `Unsupported file format: ${ext}`);
                continue;
            }

            if (!subdirs.has(subdir)) {
                subdirs.set(subdir, { images: [], masks: [] });
            }

            const subdirData = subdirs.get(subdir)!;
            
            // Improved mask detection logic
            const isMask = filename.toLowerCase().includes("mask") || 
                          pathParts.some(part => part.toLowerCase() === "masks") ||
                          pathParts.some(part => part.toLowerCase().includes("mask"));
            
            if (isMask) {
                subdirData.masks.push(entry);
            } else {
                subdirData.images.push(entry);
            }
        }

        datasetLogger.log("ZIP file analyzed", {
            totalEntries: entries.length,
            subdirectoriesFound: subdirs.size,
            subdirectoryNames: Array.from(subdirs.keys())
        });

        // Process each subdirectory independently with comprehensive validation
        let processedSubdirs = 0;
        let skippedSubdirs = 0;
        let currentUploadIndex = startUploadIndex;
        const subdirResults = new Map<string, { processed: boolean; reason?: string; pairs: number }>();

        for (const [subdirName, { images, masks }] of subdirs) {
            datasetLogger.log("Evaluating subdirectory", { 
                subdirName, 
                images: images.length, 
                masks: masks.length
            });

            // Validation 1: Check if subdirectory has both images and masks
            if (images.length === 0 && masks.length === 0) {
                errorLogger.logValidationError("subdirectory", subdirName, "Empty directory");
                subdirResults.set(subdirName, { processed: false, reason: "empty_directory", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // Validation 2: Check if subdirectory has images but no masks
            if (images.length > 0 && masks.length === 0) {
                errorLogger.logValidationError("subdirectory", subdirName, "Has images but no masks");
                subdirResults.set(subdirName, { processed: false, reason: "missing_masks", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // Validation 3: Check if subdirectory has masks but no images
            if (images.length === 0 && masks.length > 0) {
                errorLogger.logValidationError("subdirectory", subdirName, "Has masks but no images");
                subdirResults.set(subdirName, { processed: false, reason: "missing_images", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // Validation 4: Check file format compatibility within this specific subdirectory
            const hasValidFormats = this.validateSubdirectoryFormats(images, masks);
            if (!hasValidFormats) {
                errorLogger.logValidationError("subdirectory", subdirName, "No valid format combinations found");
                subdirResults.set(subdirName, { processed: false, reason: "invalid_formats", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // If we get here, the subdirectory passes all validations - process it
            try {
                datasetLogger.log("Processing subdirectory", { 
                    subdirName, 
                    images: images.length, 
                    masks: masks.length,
                    uploadIndex: currentUploadIndex
                });

                // Sort files by name for consistent association WITHIN THE SAME SUBDIRECTORY
                images.sort((a, b) => a.name.localeCompare(b.name));
                masks.sort((a, b) => a.name.localeCompare(b.name));

                // Create one-to-one associations ONLY within this specific subdirectory
                const minLength = Math.min(images.length, masks.length);
                let subdirPairsProcessed = 0;
                
                for (let i = 0; i < minLength; i++) {
                    const imageEntry = images[i];
                    const maskEntry = masks[i];
                    
                    try {
                        const imageBuffer = imageEntry.getData();
                        const maskBuffer = maskEntry.getData();
                        
                        const imageExt = path.extname(imageEntry.name).toLowerCase();
                        const maskExt = path.extname(maskEntry.name).toLowerCase();
                        
                        const imageFormats = [".png", ".jpg", ".jpeg"];
                        const videoFormats = [".mp4", ".avi", ".mov"];
                        const zipSubfolder = `${subfolder}/${subdirName}`;

                        let subData: DatasetData;

                        if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                            // Image + Mask pair - each pair gets its own upload index
                            subData = await this.processImageMaskPair(
                                imageBuffer, 
                                maskBuffer, 
                                zipSubfolder, 
                                imageEntry.name, 
                                maskEntry.name,
                                currentUploadIndex
                            );
                            currentUploadIndex++; // Increment for next pair

                        } else if (videoFormats.includes(imageExt)) {
                            
                            if (imageFormats.includes(maskExt)) {
                                // Video + Single Mask - all frames get same upload index
                                subData = await this.processVideoWithSingleMask(
                                    imageBuffer, 
                                    maskBuffer, 
                                    zipSubfolder, 
                                    imageEntry.name, 
                                    maskEntry.name,
                                    currentUploadIndex
                                );
                            } else if (videoFormats.includes(maskExt)) {
                                // Video + Mask Video - all frames get same upload index
                                subData = await this.processVideoWithMaskVideo(
                                    imageBuffer, 
                                    maskBuffer, 
                                    zipSubfolder, 
                                    imageEntry.name, 
                                    maskEntry.name,
                                    currentUploadIndex
                                );
                            } else {
                                errorLogger.logFileUploadError(imageEntry.name, undefined, "Unsupported mask format for video");
                                continue;
                            }
                            currentUploadIndex++; // Increment after processing video

                        } else {
                            errorLogger.logFileUploadError(imageEntry.name, undefined, "Unsupported file formats");
                            continue;
                        }

                        // Add pairs to the main collection
                        pairs.push(...subData.pairs);
                        subdirPairsProcessed += subData.pairs.length;

                    } catch (pairError) {
                        const err = pairError instanceof Error ? pairError : new Error("Unknown error");
                        errorLogger.logFileUploadError(imageEntry.name, undefined, err.message);
                        // Continue with next pair instead of breaking
                        continue;
                    }
                }

                // Log summary for this subdirectory
                if (subdirPairsProcessed > 0) {
                    datasetLogger.log("Subdirectory processed successfully", {
                        subdirName,
                        pairsProcessed: subdirPairsProcessed,
                        totalFiles: images.length + masks.length
                    });
                    
                    processedSubdirs++;
                    subdirResults.set(subdirName, { processed: true, pairs: subdirPairsProcessed });
                } else {
                    errorLogger.logValidationError("subdirectory", subdirName, "No successfully processed pairs");
                    subdirResults.set(subdirName, { processed: false, reason: "no_valid_pairs", pairs: 0 });
                    skippedSubdirs++;
                }

            } catch (subdirError) {
                const err = subdirError instanceof Error ? subdirError : new Error("Unknown error");
                errorLogger.logDatabaseError("PROCESS_ZIP_SUBDIRECTORY", "file_system", err.message);
                subdirResults.set(subdirName, { processed: false, reason: "critical_error", pairs: 0 });
                skippedSubdirs++;
                // Continue with next subdirectory instead of failing completely
                continue;
            }
        }

        // Final validation and comprehensive summary
        if (pairs.length === 0) {
            const errorMessage = `No valid image-mask pairs found in ZIP file. Processed: ${processedSubdirs}/${subdirs.size} subdirectories successfully. Skipped: ${skippedSubdirs} subdirectories.`;
            errorLogger.logFileUploadError("ZIP", zipBuffer.length, errorMessage);
            throw new Error(errorMessage);
        }

        datasetLogger.log("ZIP processing completed successfully", { 
            totalSubdirectories: subdirs.size,
            processedSubdirectories: processedSubdirs,
            skippedSubdirectories: skippedSubdirs,
            totalPairs: pairs.length
        });

        return {
            type: "image-mask",
            pairs
        };
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
        return new Promise((resolve, reject) => {
            const tempDir = FileStorage.getTempDir();
            const timestamp = Date.now();
            const videoPath = path.join(tempDir, `video_${timestamp}.mp4`);
            const outputPattern = path.join(tempDir, `frame_${timestamp}_%03d.png`);

            datasetLogger.log("Starting video frame extraction", { 
                videoSize: videoBuffer.length, 
                videoPath, 
                outputPattern 
            });

            // First test FFmpeg availability
            ffmpeg.getAvailableFormats((err) => {
                if (err) {
                    errorLogger.logDatabaseError("FFMPEG_CHECK", "system", `FFmpeg not available: ${err.message}`);
                    reject(new Error(`FFmpeg is not available: ${err.message}`));
                    return;
                }

                fs.writeFile(videoPath, videoBuffer)
                    .then(() => {
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
                                try {
                                    const files = await fs.readdir(tempDir);
                                    const frameFiles = files.filter(f => 
                                        f.startsWith(`frame_${timestamp}`) && f.endsWith(".png")
                                    ).sort();

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
                                    reject(error);
                                }
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
                    })
                    .catch((writeError) => {
                        errorLogger.logDatabaseError("VIDEO_EXTRACTION", "file_system", `Failed to write video file: ${writeError.message}`);
                        reject(new Error(`Failed to write video file: ${writeError.message}`));
                    });
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
            // Get existing dataset
            const dataset = await DatasetMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                errorLogger.logDatabaseError("ADD_DATA_TO_DATASET", "datasets", "Dataset not found");
                return { success: false, error: "Dataset not found" };
            }

            let currentData: DatasetData = dataset.data as DatasetData || { type: data.type, pairs: [] };
            
            // Merge new data with existing data
            if (!currentData.pairs) {
                currentData.pairs = [];
            }
            
            // Store file paths directly (no base64 conversion)
            const updatedData: DatasetData = {
                ...currentData,
                pairs: [
                    ...currentData.pairs,
                    ...data.pairs
                ]
            };

            // Update dataset with both data and nextUploadIndex in a single operation
            await DatasetMiddleware.datasetRepository.updateDataset(userId, datasetName, { 
                data: updatedData,
                nextUploadIndex: nextUploadIndex
            });

            datasetLogger.log("Dataset updated successfully", { 
                userId, 
                datasetName, 
                processedItems: data.pairs.length,
                totalItems: updatedData.pairs.length,
                nextUploadIndex
            });

            return { success: true, processedItems: data.pairs.length };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("ADD_DATA_TO_DATASET", "datasets", err.message);
            return { success: false, error: "Failed to add data to dataset" };
        }
    }
}
