// import necessary modules
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { Request, Response, NextFunction } from "express";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";

// Initialize loggers and error manager
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();
const errorManager: ErrorManager = ErrorManager.getInstance();

// Middleware class for dataset operations
export class DatasetMiddleware {
    // Modern multer configuration without callbacks
    static readonly fileStorageConfig = multer.diskStorage({
        destination: (request, uploadedFile, callback) => {
            const tempStoragePath = path.join(process.cwd(), "uploads", "temp");
            // Ensure directory exists asynchronously
            fs.mkdir(tempStoragePath, { recursive: true })
                .then(() => callback(null, tempStoragePath))
                .catch((error) => {
                    // Log error and pass to callback
                    const err = error instanceof Error ? error : new Error("Unknown error");
                    errorLogger.logDatabaseError("FILE_STORAGE", "file_system", err.message);
                    callback(err, "");
                });
        },
        // Generate unique filenames to avoid collisions
        filename: (request, uploadedFile, callback) => {
            try {
                // Generate a unique filename using timestamp and random number
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

    // Multer instance for handling file uploads with size limits and file type filtering
    static readonly fileUploadHandler = multer({
        storage: DatasetMiddleware.fileStorageConfig,
        limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
        fileFilter: (request, uploadedFile, callback) => {
            try {
                // Validate file type based on extension and MIME type
                const supportedExtensions = /jpeg|jpg|png|mp4|avi|mov|zip/;
                const extensionCheck = supportedExtensions.test(
                    path.extname(uploadedFile.originalname).toLowerCase()
                );
                // Check MIME type
                //MIME is a standard way to indicate the nature and format of a document, file, or assortment of bytes. It
                const mimeTypeCheck = supportedExtensions.test(uploadedFile.mimetype);
                
                // Allow file if both checks pass
                if (mimeTypeCheck && extensionCheck) {
                    callback(null, true);
                } else {
                    // Reject file and log error
                    const error = new Error("File type not supported");
                    errorLogger.logFileUploadError(
                        uploadedFile.originalname, 
                        uploadedFile.size, 
                        "Unsupported file type"
                    );
                    callback(error);
                }
            } catch (error) {
                // Log error and reject file
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logFileUploadError(uploadedFile.originalname, uploadedFile.size, err.message);
                callback(err);
            }
        }
    });

    // Middleware function to validate dataset name
    public static readonly validateDatasetName = (req: Request, res: Response, next: NextFunction): void => {
        const { datasetName } = req.body;

        // Validate presence and type
        if (!datasetName || typeof datasetName !== "string") {
            errorLogger.logValidationError("datasetName", datasetName, "Dataset name is required");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name is required"
            );
            next(error);
            return;
        }

        // Validate non-empty after trimming
        if (datasetName.trim().length === 0) {
            errorLogger.logValidationError("datasetName", datasetName, "Dataset name cannot be empty");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name cannot be empty"
            );
            next(error);
            return;
        }

        // Sanitize dataset name
        req.body.datasetName = datasetName.trim();
        next();
    };

    // Middleware function to validate uploaded files
    public static readonly validateUploadedFiles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const files = req.files as { [fieldname: string]: Express.Multer.File[] };

            if (!files?.image || !files?.mask) {
                errorLogger.logFileUploadError(undefined, undefined, "Both image and mask files are required");
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Both image and mask files are required"
                );
                next(error);
                return;
            }

            // Validate presence of files
            if (files.image.length === 0 || files.mask.length === 0) {
                errorLogger.logFileUploadError(undefined, undefined, "Both image and mask files are required");
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Both image and mask files are required"
                );
                next(error);
                return;
            }

            // Validate that files exist on disk
            const imageFile = files.image[0];
            const maskFile = files.mask[0];

            // Validate file existence
            const imageExists = await fs.access(imageFile.path).then(() => true).catch(() => false);
            const maskExists = await fs.access(maskFile.path).then(() => true).catch(() => false);

            // If either file does not exist, log error and return
            if (!imageExists || !maskExists) {
                errorLogger.logFileUploadError("validation", 0, "Uploaded files not found on disk");
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Uploaded files not found on disk"
                );
                next(error);
                return;
            }

            // If all validations pass, proceed to next middleware
            next();
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logFileUploadError("validation", 0, err.message);
            const validationError = errorManager.createError(
                ErrorStatus.invalidFormat,
                "File validation failed"
            );
            // Pass error to next middleware
            next(validationError);
        }
    };

    // Middleware function to check required fields for dataset creation
    public static readonly checkDatasetCreationFields = (req: Request, res: Response, next: NextFunction): void => {
        const { name } = req.body;

        // Validate presence and type
        if (!name || typeof name !== "string") {
            errorLogger.logValidationError("name", name, "Dataset name is required");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name is required"
            );
            // Pass error to next middleware
            next(error);
            return;
        }

        // Sanitize dataset name
        next();
    };

    // Middleware function to sanitize dataset data
    public static readonly sanitizeDatasetData = (req: Request, res: Response, next: NextFunction): void => {
        // Extract relevant fields from request body
        const body = req.body as { name?: string; datasetName?: string; tags?: string[] };

        // Sanitize dataset name
        if (typeof body.name === "string") {
            body.name = body.name.trim();
        }
        if (typeof body.datasetName === "string") {
            body.datasetName = body.datasetName.trim();
        }

        // Sanitize tags if present
        if (Array.isArray(body.tags)) {
            body.tags = body.tags
                .map((tag: unknown) => typeof tag === "string" ? tag.trim() : "")
                .filter((tag: string) => tag.length > 0);
        }

        // Update request body with sanitized data
        req.body = body;
        next();
    };

    // Middleware function to validate tags format
    public static readonly validateTagsFormat = (req: Request, res: Response, next: NextFunction): void => {
        const { tags } = req.body;

        // If tags are provided, validate they are an array of non-empty strings
        if (tags !== undefined) {
            if (!Array.isArray(tags)) {
                errorLogger.logValidationError("tags", typeof tags, "Tags must be an array");
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Tags must be an array of strings"
                );
                next(error);
                return;
            }

            // Validate each tag
            for (const tag of tags as unknown[]) {
                if (typeof tag !== "string" || tag.trim().length === 0) {
                    errorLogger.logValidationError("tags", String(tag), "Each tag must be a non-empty string");
                    const error = errorManager.createError(
                        ErrorStatus.invalidFormat,
                        "Each tag must be a non-empty string"
                    );
                    next(error);
                    return;
                }
            }
        }

        // If all validations pass, proceed to next middleware
        next();
    };

    // Middleware function to validate dataset name parameter
    public static readonly validateDatasetNameParam = (req: Request, res: Response, next: NextFunction): void => {
        const { name } = req.params;

        // Validate presence and type
        if (!name || typeof name !== "string" || name.trim().length === 0) {
            errorLogger.logValidationError("datasetNameParam", name, "Valid dataset name is required");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Valid dataset name is required"
            );
            next(error);
            return;
        }

        // Sanitize dataset name
        next();
    };

    // Middleware function to validate dataset update fields
    public static readonly validateDatasetUpdateFields = (req: Request, res: Response, next: NextFunction): void => {
        const { name, tags } = req.body;

        // Ensure at least one field is provided
        if (!name && !tags) {
            errorLogger.logValidationError("updateFields", "empty", "At least one field (name or tags) must be provided for update");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "At least one field (name or tags) must be provided for update"
            );
            next(error);
            return;
        }

        // If name is provided, validate it
        if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
            errorLogger.logValidationError("name", name, "Dataset name must be a non-empty string");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name must be a non-empty string"
            );
            next(error);
            return;
        }

        // If tags are provided, validate them
        next();
    };
}

// Middleware chains for different dataset operations

// Middleware chain for dataset creation validation
export const validateDatasetCreation = [
    DatasetMiddleware.checkDatasetCreationFields,
    DatasetMiddleware.sanitizeDatasetData,
    DatasetMiddleware.validateTagsFormat
];

// Middleware chain for dataset upload validation
export const validateDatasetUpload = [
    DatasetMiddleware.validateDatasetName,
    DatasetMiddleware.sanitizeDatasetData,
    DatasetMiddleware.validateUploadedFiles
];

// Middleware chain for dataset update validation
export const validateDatasetUpdate = [
    DatasetMiddleware.validateDatasetNameParam,
    DatasetMiddleware.validateDatasetUpdateFields,
    DatasetMiddleware.sanitizeDatasetData,
    DatasetMiddleware.validateTagsFormat
];

// Middleware chain for dataset access validation
export const validateDatasetAccess = [
    DatasetMiddleware.validateDatasetNameParam
];
           