import AdmZip from "adm-zip";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";
import logger from "../utils/logger";
import { DatasetRepository } from "../repository/datasetRepository";
import { FileStorage } from "../utils/fileStorage";



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

    // Create an empty dataset
    static async createEmptyDataset(userId: string, name: string, tags?: string[]): Promise<{ success: boolean; dataset?: Record<string, unknown>; error?: string }> {
        try {
            // Check if dataset already exists
            const exists = await DatasetMiddleware.datasetRepository.datasetExists(userId, name);

            if (exists) {
                return { success: false, error: "Dataset with this name already exists" };
            }

            // Create empty dataset
            const dataset = await DatasetMiddleware.datasetRepository.createDataset({
                userId,
                name,
                data: null,
                tags: tags || []
            });

            return { success: true, dataset: dataset.toJSON() };
        } catch (error) {
            logger.error("Error creating empty dataset", { error: error instanceof Error ? error.message : "Unknown error" });
            return { success: false, error: "Failed to create dataset" };
        }
    }

    // Process and add data to dataset
    static async processAndAddData(
        userId: string, 
        datasetName: string, 
        imageFile: Express.Multer.File, 
        maskFile: Express.Multer.File
    ): Promise<{ success: boolean; processedItems?: number; error?: string }> {
        let tempFiles: string[] = [];
        try {
            // Add uploaded files to cleanup list
            tempFiles.push(imageFile.path, maskFile.path);
            
            // Get current upload index and increment it
            const dataset = await DatasetMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                return { success: false, error: "Dataset not found" };
            }

            const currentUploadIndex = dataset.nextUploadIndex;
            
            // Determine file types
            const imageExt = path.extname(imageFile.originalname).toLowerCase();
            const maskExt = path.extname(maskFile.originalname).toLowerCase();

            const imageFormats = [".png", ".jpg", ".jpeg"];
            const videoFormats = [".mp4", ".avi", ".mov"];
            const zipFormats = [".zip"];

            let processedData: DatasetData;
            const subfolder = `${userId}/${datasetName}`;

            if (zipFormats.includes(imageExt)) {
                // Handle ZIP file
                const zipBuffer = await fs.readFile(imageFile.path);
                processedData = await this.processZipFile(zipBuffer, subfolder, currentUploadIndex);
            } else if (imageFormats.includes(imageExt) && imageFormats.includes(maskExt)) {
                // Handle image-mask pair
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
                // Handle video
                const videoBuffer = await fs.readFile(imageFile.path);
                const maskBuffer = await fs.readFile(maskFile.path);
                
                if (imageFormats.includes(maskExt)) {
                    // Video with single mask image
                    processedData = await this.processVideoWithSingleMask(
                        videoBuffer, 
                        maskBuffer, 
                        subfolder, 
                        imageFile.originalname, 
                        maskFile.originalname, 
                        currentUploadIndex
                    );
                } else if (videoFormats.includes(maskExt)) {
                    // Video with mask video
                    processedData = await this.processVideoWithMaskVideo(
                        videoBuffer, 
                        maskBuffer, 
                        subfolder, 
                        imageFile.originalname, 
                        maskFile.originalname, 
                        currentUploadIndex
                    );
                } else {
                    return { success: false, error: "Invalid mask format for video" };
                }
            } else {
                return { success: false, error: "Unsupported file format" };
            }

            // Add processed data to dataset and increment upload index in a single operation
            const result = await this.addDataToDatasetAndIncrementIndex(userId, datasetName, processedData, currentUploadIndex + 1);
            
            // Clean up temp files
            await FileStorage.cleanupTempFiles(tempFiles);
            
            return result;

        } catch (error) {
            logger.error("Error processing and adding data", { error: error instanceof Error ? error.message : "Unknown error" });
            // Clean up temp files on error
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
            throw new Error("Mask must be a binary image");
        }

        // Save files to permanent storage
        const imagePath = await FileStorage.saveFile(imageBuffer, imageName, subfolder);
        const maskPath = await FileStorage.saveFile(maskBuffer, maskName, subfolder);

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
            logger.warn("Frame count mismatch", { 
                videoFrames: frames.length, 
                maskFrames: maskFrames.length,
                videoName,
                maskVideoName
            });
            throw new Error(`Video and mask video must have the same number of frames. Video: ${frames.length} frames, Mask: ${maskFrames.length} frames`);
        }

        // Validate all mask frames are binary
        for (const maskFrame of maskFrames) {
            const isBinary = await this.validateBinaryMask(maskFrame);
            if (!isBinary) {
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
                logger.warn(`Skipping unsupported file format: ${filename}`, { 
                    subdirectory: subdir, 
                    extension: ext,
                    supportedFormats 
                });
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
                logger.debug(`Classified as mask: ${filename}`, { subdirectory: subdir });
            } else {
                subdirData.images.push(entry);
                logger.debug(`Classified as image: ${filename}`, { subdirectory: subdir });
            }
        }

        logger.info("ZIP file analysis completed", {
            totalEntries: entries.length,
            subdirectoriesFound: subdirs.size,
            subdirectoryNames: Array.from(subdirs.keys()),
            subdirectoryDetails: Array.from(subdirs.entries()).map(([name, data]) => ({
                name,
                images: data.images.map(img => ({ name: img.name, ext: path.extname(img.name) })),
                masks: data.masks.map(mask => ({ name: mask.name, ext: path.extname(mask.name) }))
            }))
        });

        // Process each subdirectory independently with comprehensive validation
        let processedSubdirs = 0;
        let skippedSubdirs = 0;
        let totalProcessedPairs = 0;
        let currentUploadIndex = startUploadIndex;
        const subdirResults = new Map<string, { processed: boolean; reason?: string; pairs: number }>();

        for (const [subdirName, { images, masks }] of subdirs) {
            logger.info(`Evaluating subdirectory: ${subdirName}`, { 
                images: images.length, 
                masks: masks.length,
                imageFiles: images.map(i => i.name),
                maskFiles: masks.map(m => m.name)
            });

            // Validation 1: Check if subdirectory has both images and masks
            if (images.length === 0 && masks.length === 0) {
                logger.warn(`Skipping subdirectory ${subdirName}: completely empty`, { 
                    images: images.length, 
                    masks: masks.length 
                });
                subdirResults.set(subdirName, { processed: false, reason: "empty_directory", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // Validation 2: Check if subdirectory has images but no masks
            if (images.length > 0 && masks.length === 0) {
                logger.warn(`Skipping subdirectory ${subdirName}: has images but no masks`, { 
                    images: images.length, 
                    masks: masks.length,
                    imageFiles: images.map(i => i.name)
                });
                subdirResults.set(subdirName, { processed: false, reason: "missing_masks", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // Validation 3: Check if subdirectory has masks but no images
            if (images.length === 0 && masks.length > 0) {
                logger.warn(`Skipping subdirectory ${subdirName}: has masks but no images`, { 
                    images: images.length, 
                    masks: masks.length,
                    maskFiles: masks.map(m => m.name)
                });
                subdirResults.set(subdirName, { processed: false, reason: "missing_images", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // Validation 4: Check file format compatibility within this specific subdirectory
            const hasValidFormats = this.validateSubdirectoryFormats(images, masks);
            if (!hasValidFormats) {
                logger.warn(`Skipping subdirectory ${subdirName}: no valid format combinations found within this subdirectory`, { 
                    images: images.length, 
                    masks: masks.length,
                    imageFormats: images.map(i => ({ name: i.name, ext: path.extname(i.name) })),
                    maskFormats: masks.map(m => ({ name: m.name, ext: path.extname(m.name) }))
                });
                subdirResults.set(subdirName, { processed: false, reason: "invalid_formats", pairs: 0 });
                skippedSubdirs++;
                continue;
            }

            // If we get here, the subdirectory passes all validations - process it
            try {
                logger.info(`Processing subdirectory: ${subdirName} (passed all validations)`, { 
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
                        logger.info(`Processing pair ${i + 1}/${minLength} in ${subdirName}`, {
                            image: imageEntry.name,
                            mask: maskEntry.name,
                            imageExt: path.extname(imageEntry.name),
                            maskExt: path.extname(maskEntry.name)
                        });

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
                                logger.warn(`Unsupported mask format for video in ${subdirName}`);
                                continue;
                            }
                            currentUploadIndex++; // Increment after processing video

                        } else {
                            logger.warn(`Unsupported file formats in ${subdirName}`);
                            continue;
                        }

                        // Add pairs to the main collection
                        pairs.push(...subData.pairs);
                        subdirPairsProcessed += subData.pairs.length;

                        logger.info(`Successfully processed pair ${i + 1}/${minLength} in ${subdirName}`, {
                            image: imageEntry.name,
                            mask: maskEntry.name,
                            pairsGenerated: subData.pairs.length,
                            totalPairsInSubdir: subdirPairsProcessed
                        });

                    } catch (pairError) {
                        logger.error(`Error processing pair ${i + 1} in ${subdirName}`, { 
                            image: imageEntry.name,
                            mask: maskEntry.name,
                            error: pairError instanceof Error ? pairError.message : "Unknown error" 
                        });
                        // Continue with next pair instead of breaking
                        continue;
                    }
                }

                // Log summary for this subdirectory
                if (subdirPairsProcessed > 0) {
                    logger.info(`Successfully completed subdirectory: ${subdirName}`, {
                        pairsProcessed: subdirPairsProcessed,
                        totalFiles: images.length + masks.length,
                        processedImages: Math.min(images.length, masks.length),
                        processedMasks: Math.min(images.length, masks.length),
                        unmatchedImages: Math.max(0, images.length - minLength),
                        unmatchedMasks: Math.max(0, masks.length - minLength)
                    });
                    
                    totalProcessedPairs += subdirPairsProcessed;
                    processedSubdirs++;
                    subdirResults.set(subdirName, { processed: true, pairs: subdirPairsProcessed });
                } else {
                    logger.warn(`Subdirectory ${subdirName} had no successfully processed pairs`, {
                        totalAttempts: minLength,
                        images: images.map(i => i.name),
                        masks: masks.map(m => m.name)
                    });
                    subdirResults.set(subdirName, { processed: false, reason: "no_valid_pairs", pairs: 0 });
                    skippedSubdirs++;
                }

                // Warn if there are unmatched files within this subdirectory
                if (images.length > masks.length) {
                    logger.warn(`${images.length - masks.length} unmatched images in ${subdirName}`, {
                        unmatchedImages: images.slice(minLength).map(e => e.name)
                    });
                } else if (masks.length > images.length) {
                    logger.warn(`${masks.length - images.length} unmatched masks in ${subdirName}`, {
                        unmatchedMasks: masks.slice(minLength).map(e => e.name)
                    });
                }

            } catch (subdirError) {
                logger.error(`Critical error processing subdirectory ${subdirName} - SKIPPING and continuing with next`, {
                    error: subdirError instanceof Error ? subdirError.message : "Unknown error",
                    images: images.length,
                    masks: masks.length,
                    imageFiles: images.map(i => i.name),
                    maskFiles: masks.map(m => m.name)
                });
                subdirResults.set(subdirName, { processed: false, reason: "critical_error", pairs: 0 });
                skippedSubdirs++;
                // Continue with next subdirectory instead of failing completely
                continue;
            }
        }

        // Final validation and comprehensive summary
        if (pairs.length === 0) {
            const detailedBreakdown = Array.from(subdirResults.entries()).map(([name, result]) => ({
                name,
                processed: result.processed,
                pairs: result.pairs,
                reason: result.reason || "success"
            }));

            throw new Error(`No valid image-mask pairs found in ZIP file. 
                Processed: ${processedSubdirs}/${subdirs.size} subdirectories successfully.
                Skipped: ${skippedSubdirs} subdirectories.
                Details: ${JSON.stringify(detailedBreakdown, null, 2)}`);
        }

        logger.info("ZIP processing completed successfully", { 
            totalSubdirectories: subdirs.size,
            processedSubdirectories: processedSubdirs,
            skippedSubdirectories: skippedSubdirs,
            totalPairs: pairs.length,
            totalProcessedPairs,
            detailedResults: Array.from(subdirResults.entries()).map(([name, result]) => ({
                name,
                processed: result.processed,
                pairs: result.pairs,
                skipReason: result.reason,
                details: subdirs.get(name) ? {
                    images: subdirs.get(name)!.images.map(i => i.name),
                    masks: subdirs.get(name)!.masks.map(m => m.name)
                } : null
            }))
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

            logger.info("Starting video frame extraction", { 
                videoSize: videoBuffer.length, 
                videoPath, 
                outputPattern 
            });

            // First test FFmpeg availability
            ffmpeg.getAvailableFormats((err) => {
                if (err) {
                    logger.error("FFmpeg not available", { error: err.message });
                    reject(new Error(`FFmpeg is not available: ${err.message}`));
                    return;
                }

                logger.info("FFmpeg is available, starting frame extraction");

                fs.writeFile(videoPath, videoBuffer)
                    .then(() => {
                        logger.info("Video file written to temp directory", { path: videoPath });
                        
                        const command = ffmpeg(videoPath)
                            .outputOptions([
                                "-vf", "fps=1", // Extract 1 frame per second
                                "-q:v", "2"     // High quality
                            ])
                            .output(outputPattern)
                            .on("start", (commandLine) => {
                                logger.info("FFmpeg command started", { command: commandLine });
                            })
                            .on("progress", (progress) => {
                                logger.info("FFmpeg progress", { 
                                    frames: progress.frames, 
                                    currentFps: progress.currentFps,
                                    timemark: progress.timemark
                                });
                            })
                            .on("end", async () => {
                                logger.info("FFmpeg processing completed");
                                try {
                                    const files = await fs.readdir(tempDir);
                                    const frameFiles = files.filter(f => 
                                        f.startsWith(`frame_${timestamp}`) && f.endsWith(".png")
                                    ).sort();
                                    
                                    logger.info("Frame files found", { count: frameFiles.length, files: frameFiles });

                                    const frames: Buffer[] = [];
                                    for (const file of frameFiles) {
                                        const framePath = path.join(tempDir, file);
                                        const frameBuffer = await fs.readFile(framePath);
                                        frames.push(frameBuffer);
                                        await fs.unlink(framePath).catch(() => {}); // Ignore cleanup errors
                                    }
                                    
                                    await fs.unlink(videoPath).catch(() => {}); // Ignore cleanup errors
                                    
                                    logger.info("Video frame extraction completed successfully", { 
                                        frameCount: frames.length,
                                        totalSize: frames.reduce((sum, frame) => sum + frame.length, 0)
                                    });
                                    
                                    if (frames.length === 0) {
                                        reject(new Error("No frames were extracted from the video. The video might be corrupted or in an unsupported format."));
                                        return;
                                    }
                                    
                                    resolve(frames);
                                } catch (error) {
                                    logger.error("Error processing extracted frames", { 
                                        error: error instanceof Error ? error.message : "Unknown error" 
                                    });
                                    reject(error);
                                }
                            })
                            .on("error", (error) => {
                                logger.error("FFmpeg processing error", { 
                                    error: error.message,
                                    videoPath,
                                    outputPattern
                                });
                                // Cleanup on error
                                fs.unlink(videoPath).catch(() => {});
                                reject(new Error(`Video processing failed: ${error.message}`));
                            });

                        // Add timeout to prevent hanging
                        const timeout = setTimeout(() => {
                            command.kill("SIGKILL");
                            fs.unlink(videoPath).catch(() => {});
                            reject(new Error("Video processing timeout (60 seconds)"));
                        }, 60000);

                        command.on("end", () => clearTimeout(timeout));
                        command.on("error", () => clearTimeout(timeout));
                        
                        command.run();
                    })
                    .catch((writeError) => {
                        logger.error("Failed to write video file", { error: writeError.message });
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
            logger.error("Error validating binary mask", { error: error instanceof Error ? error.message : "Unknown error" });
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

            logger.info("Dataset updated successfully", { 
                userId, 
                datasetName, 
                processedItems: data.pairs.length,
                totalItems: updatedData.pairs.length,
                nextUploadIndex
            });

            return { success: true, processedItems: data.pairs.length };
        } catch (error) {
            logger.error("Error adding data to dataset", { error: error instanceof Error ? error.message : "Unknown error" });
            return { success: false, error: "Failed to add data to dataset" };
        }
    }
}
      
    