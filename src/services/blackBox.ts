// Import the 'sharp' library for image processing module.
import sharp from "sharp";
// Import custom logger utilities.
import { loggerFactory, ExecutionRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Define a TypeScript interface for the result of the inpainting operation.
export interface InpaintingResult {
    outputImage: Buffer; // The resulting image data as a Buffer.
    success: boolean;    // A flag to indicate if the operation was successful.
    error?: string;       // Optional error message if the operation failed.
}

/** A Singleton service class responsible for the core image processing logic.
 * It is only a mock that simulates inpainting by compositing the mask over the original image using a 'lighten' blend mode.
 */
export class BlackBoxService {
    // A private static property to hold the single instance of the class (Singleton pattern).
    private static instance: BlackBoxService;
    // Logger instances for execution and error logging.
    private readonly executionLogger: ExecutionRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        // Initialize the loggers using the factory.
        this.executionLogger = loggerFactory.createExecutionLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // The public static method to get the single instance of the service.
    public static getInstance(): BlackBoxService {
        if (!BlackBoxService.instance) {
            BlackBoxService.instance = new BlackBoxService();
        }
        return BlackBoxService.instance;
    }

    //Processes the image by blending a mask onto an original image.
    public async processInpainting(
        originalImageBuffer: Buffer, // The buffer containing the original image data.
        maskImageBuffer: Buffer // The buffer containing the mask image data.
    ): Promise<InpaintingResult> {
        this.executionLogger.log("Starting inpainting process", {
            component: "BlackBoxService",
            originalImageSize: originalImageBuffer.length,
            maskImageSize: maskImageBuffer.length
        });

        try {
            // Create a sharp instance from the original image buffer.
            const originalImage = sharp(originalImageBuffer);
            // Asynchronously retrieve the metadata of the original image.
            const originalMetadata = await originalImage.metadata();

            // Check if metadata was retrieved successfully.
            if (!originalMetadata.width || !originalMetadata.height) {
                throw new Error("Could not retrieve metadata from the original image.");
            }

            this.executionLogger.log("Image metadata retrieved", {
                component: "BlackBoxService",
                width: originalMetadata.width,
                height: originalMetadata.height,
                format: originalMetadata.format
            });

            /** Process the mask image:
             * 1. Resize it to the exact dimensions of the original image to ensure proper alignment.
             * 2. Convert it to PNG format.
             */
            const processedMask = await sharp(maskImageBuffer)
                .resize(originalMetadata.width, originalMetadata.height)
                .png()
                .toBuffer();

            /** This is the "inpainting" step. However, it's not actually inpainting.
             * .composite() overlays an image on top of another.
             * 'blend: lighten' compares each pixel from both images and returns the lighter one.
             * The result is a blend of the two images, not a "fill" of a masked area.
             */
            const outputImageBuffer = await originalImage
                .composite([{
                    input: processedMask,
                    blend: "lighten" 
                }])
                .png()
                .toBuffer();

            this.executionLogger.log("Inpainting process completed successfully", {
                component: "BlackBoxService",
                outputImageSize: outputImageBuffer.length
            });

            // Return a structured success response.
            return {
                outputImage: outputImageBuffer,
                success: true
            };
        } catch (error) {
            // This is a error handling block.
            const err = error instanceof Error ? error : new Error("Unknown error during image processing");
            this.errorLogger.log("Inpainting process failed", {
                component: "BlackBoxService",
                errorMessage: err.message,
                stack: err.stack
            });

            return {
                outputImage: Buffer.alloc(0),
                success: false,
                error: err.message
            };
        }
    }

    // Generates a preview of the inpainting result.
    public async generatePreview(
        originalImageBuffer: Buffer,
        maskImageBuffer: Buffer
    ): Promise<InpaintingResult> {
        this.executionLogger.log("Generating preview", {
            component: "BlackBoxService",
            operation: "preview"
        });

        // The preview is generated using the exact same logic as the main process.
        return this.processInpainting(originalImageBuffer, maskImageBuffer);
    }
}