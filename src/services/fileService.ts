// Import Node.js built-in modules for file system (fs) and path manipulation (path).
import * as fs from "fs";
import * as path from "path";
// Import custom logger utilities.
import { loggerFactory, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// A Singleton service class to handle all file system operations related to images.
export class FileService {
    private static instance: FileService;
    private static initializationPromise: Promise<FileService> | null = null;
    private readonly staticDir: string;
    private readonly baseUrl: string;
    private readonly apiLogger: ApiRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.staticDir = process.env.STATIC_FILES_DIR || "/var/www/html/images";
        this.baseUrl = process.env.STATIC_FILES_URL || "http://localhost:8080/images";
        this.apiLogger = loggerFactory.createApiLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // The getInstance method ensures that any async setup is complete before the service instance is used.
    public static async getInstance(): Promise<FileService> {
        if (!FileService.instance) {
            FileService.initializationPromise ??= FileService.createInstance();
            FileService.instance = await FileService.initializationPromise;
        }
        return FileService.instance;
    }

    private static async createInstance(): Promise<FileService> {
        const newInstance = new FileService();
        await newInstance.ensureDirectoryExists();
        return newInstance;
    }

    // This method ensures the static directory for images exists.
    private async ensureDirectoryExists(): Promise<void> {
        try {
            // Try to access the directory.
            await fs.promises.access(this.staticDir);
        } catch {
            // If access fails, assume the directory needs to be created.
            try {
                await fs.promises.mkdir(this.staticDir, { recursive: true });
                this.apiLogger.log("Created static directory", {
                    component: "FileService",
                    directory: this.staticDir
                });
            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                this.errorLogger.log("Failed to create static directory", {
                    component: "FileService",
                    directory: this.staticDir,
                    error: err.message
                });
                throw new Error(`Failed to create static directory: ${err.message}`);
            }
        }
    }

    // This method asynchronously saves an image buffer to the static directory.
    public async saveImageToStatic(imageBuffer: Buffer, executionId: string, userId: string): Promise<string> {
        try {
            const filename = `inpainted_${executionId}_${userId}_${Date.now()}.png`;
            const filepath = path.join(this.staticDir, filename);
            
            await fs.promises.writeFile(filepath, imageBuffer);
            
            const imageUrl = `${this.baseUrl}/${filename}`;
            
            this.apiLogger.log("Image saved to static storage", {
                component: "FileService",
                filename,
                imageSize: imageBuffer.length,
                imageUrl
            });
            
            return imageUrl;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.log("Failed to save image to static storage", {
                component: "FileService",
                executionId,
                userId,
                error: err.message
            });
            throw new Error("Failed to save image to static storage");
        }
    }
    // This method returns the full path to an image file in the static directory.
    public getImagePath(filename: string): string {
        return path.join(this.staticDir, filename);
    }

    // This method asynchronously checks if an image file exists.
    public async imageExists(filename: string): Promise<boolean> {
        try {
            const filepath = path.join(this.staticDir, filename);
            await fs.promises.access(filepath);
            return true;
        } catch {
            return false;
        }
    }

    // This method asynchronously deletes an image file.
    public async deleteImage(filename: string): Promise<boolean> {
        try {
            const filepath = path.join(this.staticDir, filename);
            await fs.promises.unlink(filepath);
            
            this.apiLogger.log("Image deleted successfully", {
                component: "FileService",
                filename
            });
            
            return true;
        } catch (error) {
            const err = error as NodeJS.ErrnoException; 
            
            // If the error is that the file doesn't exist, it's not a failure state.   
            if (err.code === "ENOENT") {
                this.apiLogger.log("Attempted to delete non-existent file", { component: "FileService", filename });
                return false;
            }
            
            this.errorLogger.log("Failed to delete image", {
                component: "FileService",
                filename,
                error: err.message
            });
            
            throw new Error(`Failed to delete image ${filename}: ${err.message}`);
        }
    }

    //This method asynchronously cleans up old images from the static directory.
    public async cleanupOldImages(olderThanDays: number = 7): Promise<number> {
        try {
            const files = await fs.promises.readdir(this.staticDir);
            const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
            let deletedCount = 0;

            for (const file of files) {
                try {
                    const filepath = path.join(this.staticDir, file);
                    const stats = await fs.promises.stat(filepath);
                    
                    if (stats.mtime.getTime() < cutoffTime) {
                        await fs.promises.unlink(filepath);
                        deletedCount++;
                    }
                } catch (error) {
                    // Log individual file errors but continue with the rest of the cleanup.
                    const err = error instanceof Error ? error : new Error("Unknown error");
                    this.errorLogger.log("Error deleting individual file during cleanup", {
                        component: "FileService",
                        filename: file,
                        error: err.message
                    });
                }
            }

            this.apiLogger.log("Cleanup completed", {
                component: "FileService",
                deletedCount,
                olderThanDays
            });

            return deletedCount;
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.errorLogger.log("Error during cleanup", {
                component: "FileService",
                error: err.message
            });
            throw new Error(`Failed to cleanup old images: ${err.message}`);
        }
    }

    // This method returns the static directory path.
    public getStaticDirectory(): string {
        return this.staticDir;
    }

    // This method returns the base URL for serving static files.
    public getBaseUrl(): string {
        return this.baseUrl;
    }
}