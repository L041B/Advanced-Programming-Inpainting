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
        limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
        fileFilter: (request, uploadedFile, callback) => {
            try {
                // Validate file type based on extension and MIME type
                const supportedExtensions = /jpeg|jpg|png|mp4|avi|mov|zip/;
                const extensionCheck = supportedExtensions.test(
                    path.extname(uploadedFile.originalname).toLowerCase()
                );
                
                const supportedMimeTypes = [
                    "image/jpeg", "image/jpg", "image/png",
                    "video/mp4", "video/avi",
                    "application/zip"
                ];
                const mimeTypeCheck = supportedMimeTypes.includes(uploadedFile.mimetype);
                
                // Allow file if both checks pass
                if (mimeTypeCheck && extensionCheck) {
                    callback(null, true);
                } else {
                    // Create a standardized error instead of generic Error
                    const error = errorManager.createError(
                        ErrorStatus.invalidFormat,
                        "File type not supported. Supported formats: JPEG, PNG, MP4, AVI, ZIP."
                    );
                    
                    errorLogger.logFileUploadError(
                        uploadedFile.originalname, 
                        uploadedFile.size, 
                        `Unsupported file type: ${uploadedFile.mimetype}`
                    );
                    
                    callback(error);
                }
            } catch (error) {
                // Log error and create standardized error
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logFileUploadError(uploadedFile.originalname, uploadedFile.size, err.message);
                
                const standardError = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "File validation failed"
                );
                callback(standardError);
            }
        }
    });

    // New middleware to handle multer errors properly
    public static readonly handleMulterErrors = (err: Error | null, req: Request, res: Response, next: NextFunction): void => {
        if (err) {
            // Check if it's a multer error
            const multerError = err as Error & { code?: string; errorType?: string; getResponse?: () => unknown };
            if (multerError.code === "LIMIT_FILE_SIZE") {
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "File size exceeds the maximum limit of 10MB"
                );
                next(error);
                return;
            }
            
            if (multerError.code === "LIMIT_UNEXPECTED_FILE") {
                const error = errorManager.createError(
                    ErrorStatus.invalidFormat,
                    "Unexpected file field or too many files"
                );
                next(error);
                return;
            }

            // Check if it's already a standardized error from file filter
            if (multerError.errorType && multerError.getResponse) {
                next(err);
                return;
            }

            // For other multer errors, create a standardized error
            errorLogger.logFileUploadError("unknown", 0, err.message || "Multer error occurred");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                err.message || "File upload failed"
            );
            next(error);
            return;
        }
        
        next();
    };

    // Middleware function to validate dataset name
    public static readonly validateDatasetName = (req: Request, res: Response, next: NextFunction): void => {
        let { datasetName } = req.body;

        // Trim input if it's a string
        if (typeof datasetName === "string") datasetName = datasetName.trim();

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
        if (datasetName.length === 0) {
            errorLogger.logValidationError("datasetName", datasetName, "Dataset name cannot be empty or contain only spaces");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name cannot be empty or contain only spaces"
            );
            next(error);
            return;
        }

        // Update body with trimmed dataset name
        req.body = { ...req.body, datasetName };
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
        let { name } = req.body;

        // Trim input if it's a string
        if (typeof name === "string") name = name.trim();

        // Validate presence and type
        if (!name || typeof name !== "string") {
            errorLogger.logValidationError("name", name, "Dataset name is required");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name is required"
            );
            next(error);
            return;
        }

        // Validate non-empty after trimming
        if (name.length === 0) {
            errorLogger.logValidationError("name", name, "Dataset name cannot be empty or contain only spaces");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name cannot be empty or contain only spaces"
            );
            next(error);
            return;
        }

        // Update body with trimmed name
        req.body = { ...req.body, name };
        next();
    };

    // Middleware function to sanitize dataset data
    public static readonly sanitizeDatasetData = (req: Request, res: Response, next: NextFunction): void => {
        const body = req.body as { name?: string; datasetName?: string; tags?: string[] };

        // Sanitize dataset name
        if (typeof body.name === "string") {
            body.name = body.name.trim();
            if (body.name.length === 0) body.name = undefined;
        }
        if (typeof body.datasetName === "string") {
            body.datasetName = body.datasetName.trim();
            if (body.datasetName.length === 0) body.datasetName = undefined;
        }

        // Sanitize tags if present
        if (Array.isArray(body.tags)) {
            body.tags = body.tags
                .map((tag: unknown) => typeof tag === "string" ? tag.trim() : "")
                .filter((tag: string) => tag.length > 0);
        }

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

            // Validate each tag after trimming
            for (let i = 0; i < tags.length; i++) {
                const tag = tags[i];
                if (typeof tag !== "string") {
                    errorLogger.logValidationError("tags", String(tag), "Each tag must be a string");
                    const error = errorManager.createError(
                        ErrorStatus.invalidFormat,
                        "Each tag must be a string"
                    );
                    next(error);
                    return;
                }
                
                const trimmedTag = tag.trim();
                if (trimmedTag.length === 0) {
                    errorLogger.logValidationError("tags", tag, "Tags cannot be empty or contain only spaces");
                    const error = errorManager.createError(
                        ErrorStatus.invalidFormat,
                        "Tags cannot be empty or contain only spaces"
                    );
                    next(error);
                    return;
                }
                
                // Update the tag with trimmed value
                tags[i] = trimmedTag;
            }
        }

        next();
    };

    // Middleware function to validate dataset name parameter
    public static readonly validateDatasetNameParam = (req: Request, res: Response, next: NextFunction): void => {
        let { name } = req.params;

        // Trim input if it's a string
        if (typeof name === "string") name = name.trim();

        // Validate presence and type
        if (!name || typeof name !== "string" || name.length === 0) {
            errorLogger.logValidationError("datasetNameParam", name, "Valid dataset name is required and cannot be empty");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Valid dataset name is required and cannot be empty or contain only spaces"
            );
            next(error);
            return;
        }

        // Update params with trimmed name
        req.params = { ...req.params, name };
        next();
    };

    // Middleware function to validate dataset update fields
    public static readonly validateDatasetUpdateFields = (req: Request, res: Response, next: NextFunction): void => {
        let { name, tags } = req.body;

        // Trim name if provided
        if (typeof name === "string") name = name.trim();

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
        if (name !== undefined && (typeof name !== "string" || name.length === 0)) {
            errorLogger.logValidationError("name", name, "Dataset name must be a non-empty string");
            const error = errorManager.createError(
                ErrorStatus.invalidFormat,
                "Dataset name must be a non-empty string and cannot contain only spaces"
            );
            next(error);
            return;
        }

        // Update body with trimmed name
        req.body = { ...req.body, name };
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
    DatasetMiddleware.handleMulterErrors,
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
