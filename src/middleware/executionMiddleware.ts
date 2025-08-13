// Import necessary types from Express and custom factory modules.
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { loggerFactory, ErrorRouteLogger } from '../factory/loggerFactory';
import { ExecutionRepository } from '../repository/executionRepository';
import { ErrorStatus } from '../factory/status';

// Add interface for authenticated requests to ensure type safety.
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

// Custom error interface
interface ValidationError extends Error {
    status: number;
    errorType: ErrorStatus;
}

// Initialize the error logger.
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Helper function to create validation errors
const createValidationError = (message: string, errorType: ErrorStatus, status: number = 400): ValidationError => {
    const error = new Error(message) as ValidationError;
    error.status = status;
    error.errorType = errorType;
    return error;
};

// Configure multer's disk storage.
const storage = multer.diskStorage({
    // Destination folder for uploaded files
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        // cb is a callback function provided by multer to indicate the destination folder
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate a unique filename to prevent overwrites. 
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // cb is a callback function provided by multer to indicate the filename
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// Define a filter to accept only specific image MIME types.
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    if (allowedMimeTypes.includes(file.mimetype)) {
        // Accept the file.
        cb(null, true);
    } else {
        // Reject the file by passing an error.
        const error = new Error('Only image files (JPEG, PNG, GIF) are allowed');
        error.name = "MulterFileFilterError"; 
        cb(error);
    }
};

// Create the main multer instance with storage, limits, and the file filter.
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB. Multer will automatically reject files larger than this.
    },
    fileFilter: fileFilter
});

// uploadImagePair is a middleware for handling image uploads.
export const uploadImagePair = upload.fields([
    { name: 'originalImage', maxCount: 1 },
    { name: 'maskImage', maxCount: 1 }
]);

// checksFilePresence is a middleware for validating the presence of required files.
export const checkFilesPresence = (req: Request, res: Response, next: NextFunction): void => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // Ensure both originalImage and maskImage are present in the request.
    if (!(files?.originalImage && files?.maskImage)) {
        errorLogger.log('File presence validation failed', { reason: 'Both files required', ip: req.ip });
        const error = createValidationError(
            'Both originalImage and maskImage files are required',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next(); // Proceed to the next step.
};

// checkUpdateFilesPresence is a middleware for validating the presence of files in update requests.
export const checkUpdateFilesPresence = (req: Request, res: Response, next: NextFunction): void => {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    // The request is valid if there are no files or if at least one of the expected files is present.
    if (req.files && Object.keys(req.files).length > 0 && !files.originalImage && !files.maskImage) {
         errorLogger.log('Update file presence validation failed', { reason: 'At least one file required if files are sent', ip: req.ip });
         const error = createValidationError(
             'At least one image file (original or mask) is required for update',
             ErrorStatus.invalidFormat
         );
         next(error);
         return;
    }
    next();
};

// checkExecutionIdParam is a middleware for validating the presence of the execution ID parameter.
export const checkExecutionIdParam = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.params.id) {
        const error = createValidationError(
            'Execution ID is required',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// checkUserIdParam is a middleware for validating the presence of the user ID parameter.
export const checkUserIdParam = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.params.userId) {
        const error = createValidationError(
            'User ID is required',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// checkJobIdParam is a middleware for validating the presence of the job ID parameter.
export const checkJobIdParam = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.params.jobId) {
        const error = createValidationError(
            'Job ID is required',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// validateExecutionUUID is a middleware for validating the format of the execution ID parameter.
export const validateExecutionUUID = (req: Request, res: Response, next: NextFunction): void => {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (req.params.id && !uuidRegex.test(req.params.id)) {
        const error = createValidationError(
            'Invalid Execution ID format',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// validateUserUUID is a middleware for validating the format of the user ID parameter.
export const validateUserUUID = (req: Request, res: Response, next: NextFunction): void => {
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (req.params.userId && !uuidRegex.test(req.params.userId)) {
        const error = createValidationError(
            'Invalid User ID format',
            ErrorStatus.invalidFormat
        );
        next(error);
        return;
    }
    next();
};

// verifyExecutionOwnership is a middleware for verifying ownership of an execution.
export const verifyExecutionOwnership = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
        const executionId = req.params.id;
        const userId = req.user?.userId;

        // This check is a safeguard, but `authenticateToken` should always run first.
        if (!userId) {
            const error = createValidationError(
                'Authentication required',
                ErrorStatus.jwtNotValid,
                401
            );
            next(error);
            return;
        }

        // Use the imported repository instance.
        const executionRepository = ExecutionRepository.getInstance();
        const execution = await executionRepository.getExecutionBasicInfoWithUserId(executionId);
        
        // If the execution doesn't exist, it's a 404 Not Found error.
        if (!execution) {
            const error = createValidationError(
                'Execution not found',
                ErrorStatus.resourceNotFoundError,
                404
            );
            next(error);
            return;
        }

        // This is the authorization check.
        if (execution.userId !== userId) {
            errorLogger.logAuthorizationError(userId, `execution_${executionId}`);
            const error = createValidationError(
                'Access denied: You are not the owner of this execution',
                ErrorStatus.userNotAuthorized,
                403
            );
            next(error);
            return;
        }

        // If all checks pass, proceed to the next handler (the controller).
        next();
    } catch (error) {
        const err = error instanceof Error ? error : new Error('Unknown error');
        errorLogger.log('Error verifying execution ownership', { error: err.message });
        const validationError = createValidationError(
            'Error verifying execution ownership',
            ErrorStatus.readInternalServerError,
            500
        );
        next(validationError);
    }
};

// validateExecutionCreation is a middleware for validating the creation of a new execution.
export const validateExecutionCreation = [
    checkFilesPresence, // The redundant file type and size validators have been removed.
];

// validateExecutionUpdate is a middleware for validating the update of an existing execution.
export const validateExecutionUpdate = [
    checkUpdateFilesPresence, // The redundant file type and size validators have been removed.
];

// validateExecutionId is a middleware for validating the execution ID parameter.
export const validateExecutionId = [checkExecutionIdParam, validateExecutionUUID];

// validateUserId is a middleware for validating the user ID parameter.
export const validateUserId = [checkUserIdParam, validateUserUUID];

// validateJobId is a middleware for validating the job ID parameter.
export const validateJobId = [checkJobIdParam];

// Middleware for authorizing execution access.
export const authorizeExecution = [verifyExecutionOwnership];