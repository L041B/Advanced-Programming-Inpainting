// Import necessary modules from Node.js, Express, jwt and project files
import { Request, Response, NextFunction } from "express";
import { UserRepository } from "../repository/userRepository";
import jwt from "jsonwebtoken";
import { loggerFactory, UserRouteLogger, ApiRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { TokenService } from "../services/tokenService";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
 
// Define a custom Request interface to provide type safety for the `user` property added by auth middleware.
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}
 
// Controller responsible for handling all user-related HTTP requests.
export class UserController {
    private readonly userRepository: UserRepository;
    private readonly userLogger: UserRouteLogger;
    private readonly apiLogger: ApiRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;
    private readonly tokenService: TokenService;
    private readonly errorManager: ErrorManager;
 
    // Singleton pattern to ensure a single instance of UserController.
    constructor() {
        this.userRepository = UserRepository.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.apiLogger = loggerFactory.createApiLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
        this.tokenService = TokenService.getInstance();
        this.errorManager = ErrorManager.getInstance();
    }
 
    // Handles new user registration.
    public createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
 
        try {
            // Only accept basic user data - no role or tokens
            const { name, surname, email, password } = req.body as { name: string; surname: string; email: string; password: string };
            const user = await this.userRepository.createUser({ name, surname, email, password });
 
            // Log the user creation event
            this.userLogger.logUserCreation(user.id, user.email);
 
            // Respond with 201 Created for successful resource creation.
            res.status(201).json({
                success: true,
                message: "User created successfully",
                data: {
                    id: user.id,
                    name: user.name,
                    surname: user.surname,
                    email: user.email,
                    tokens: user.tokens, 
                    role: user.role 
                }
            });
            // Log the API response time
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            this.apiLogger.logError(req, error as Error);
            const managedError = this.errorManager.createError(ErrorStatus.userCreationFailedError);
            next(managedError);
        }
    };
 
    // Handles user login, validating credentials and issuing a JWT on success.
    public login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
 
        // Validate user credentials
        try {
            // Extract email and password from request body
            const { email, password } = req.body as { email: string; password: string };
            const user = await this.userRepository.validateLogin(email, password);
 
            if (!user) {
                this.userLogger.logUserLogin(email, false);
                const error = this.errorManager.createError(ErrorStatus.userLoginError);
                next(error);
                return;
            }
 
            // Ensure the JWT secret is defined in environment variables.
            const secret = process.env.JWT_SECRET;
            if (!secret) {
                this.errorLogger.log("FATAL: JWT_SECRET is not defined in environment variables.", { component: "UserController" });
                const error = this.errorManager.createError(ErrorStatus.creationInternalServerError, "Server security configuration error.");
                next(error);
                return;
            }
 
            // Generate a JWT token for the authenticated user.
            const token = jwt.sign(
                { userId: user.id, email: user.email },
                secret,
                { expiresIn: "24h" }
            );
 
            // Log the successful login.
            this.userLogger.logUserLogin(email, true);
            res.status(200).json({
                success: true,
                message: "Login successful",
                data: { token, user: { id: user.id, name: user.name, email: user.email } }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            this.apiLogger.logError(req, error as Error);
            const managedError = this.errorManager.createError(ErrorStatus.userLoginError);
            next(managedError);
        }
    };
 
    /** Retrieves a user's profile. This method handles two routes:
     * 1. `GET /profile`: Gets the authenticated user's own data.
     * 2. `GET /:userId`: Gets a specific user's data.
     */
    public getUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
 
        try {
            // Determine the target user ID from URL params or the authenticated user's token.
            const userId = req.params.userId || (req.user ? req.user.userId : undefined);
            if (!userId) {
                const error = this.errorManager.createError(ErrorStatus.invalidParametersError, "User ID not provided");
                next(error);
                return;
            }
            // Fetch user data from the repository.
            const user = await this.userRepository.getUserById(userId);
 
            // If the user does not exist, return a 404 error.
            if (!user) {
                const error = this.errorManager.createError(ErrorStatus.userNotFoundError);
                next(error);
                return;
            }
 
            // Log the user retrieval action.
            this.userLogger.logUserRetrieval(userId);
            res.status(200).json({
                success: true,
                data: { id: user.id, name: user.name, surname: user.surname, email: user.email }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            this.apiLogger.logError(req, error as Error);
            const managedError = this.errorManager.createError(ErrorStatus.readInternalServerError);
            next(managedError);
        }
    };
 
    // Updates an existing user's data.
    public updateUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
 
        // Validate input data
        try {
            const userId = req.params.userId;
            const { name, surname, email, password } = req.body as { name: string; surname: string; email: string; password?: string };
           
            // Update user data in the repository
            const updatedUser = await this.userRepository.updateUser(userId, { name, surname, email, password });
 
            // Log which fields were part of the update request payload.
            const updatedFields = Object.keys(req.body as Record<string, unknown>).filter(key => ["name", "surname", "email", "password"].includes(key));
            this.userLogger.logUserUpdate(userId, updatedFields);
 
            // If the user does not exist, return a 404 error.
            res.status(200).json({
                success: true,
                message: "User updated successfully",
                data: { id: updatedUser.id, name: updatedUser.name, surname: updatedUser.surname, email: updatedUser.email }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            this.apiLogger.logError(req, error as Error);
            const managedError = this.errorManager.createError(ErrorStatus.userUpdateFailedError);
            next(managedError);
        }
    };
 
    // Deletes a user from the database.
    public deleteUser = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
 
        // Validate input data
        try {
            const userId = req.params.userId;
           
            // Soft delete all datasets associated with the user before deleting the user
            const { DatasetRepository } = await import("../repository/datasetRepository");
            const datasetRepository = DatasetRepository.getInstance();
           
            // Soft delete user datasets
            const deletedDatasetsCount = await datasetRepository.softDeleteAllUserDatasets(userId);
            this.userLogger.log(`Soft deleted ${deletedDatasetsCount} datasets for user: ${userId}`);
           
            // Proceed with user deletion
            const deleted = await this.userRepository.deleteUser(userId);
 
            // If the user does not exist, return a 404 error.
            if (!deleted) {
                const error = this.errorManager.createError(ErrorStatus.userNotFoundError);
                next(error);
                return;
            }
 
            // Log the user deletion action
            this.userLogger.logUserDeletion(userId);
            res.status(200).json({
                success: true,
                message: `User deleted successfully. ${deletedDatasetsCount} associated datasets have been marked as deleted but preserved in the database.`
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            this.apiLogger.logError(req, error as Error);
            const managedError = this.errorManager.createError(ErrorStatus.userDeletionFailedError);
            next(managedError);
        }
    };
 
    // Get user's token balance
    public getUserTokens = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);
 
        // Validate input data
        try {
            const userId = req.user!.userId;
 
            const balance = await this.tokenService.getUserTokenBalance(userId);
 
            if (typeof balance !== "number") {
                const error = this.errorManager.createError(ErrorStatus.readInternalServerError, "Failed to get token balance");
                next(error);
                return;
            }
 
            // Get recent transaction history
            const transactionResult = await this.tokenService.getUserTransactionHistory(userId, 10);
 
            // Log the token balance retrieval action
            res.status(200).json({
                success: true,
                message: "Token balance retrieved successfully",
                data: {
                    balance: balance,
                    recentTransactions: transactionResult,
                    tokenPricing: {
                        dataset_upload: {
                            single_image: 0.65,
                            video_frame: 0.4,
                            zip_file: 0.7
                        },
                        inference: {
                            single_image: 2.75,
                            video_frame: 1.5
                        }
                    }
                }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            this.apiLogger.logError(req, error as Error);
            const managedError = this.errorManager.createError(ErrorStatus.readInternalServerError);
            next(managedError);
        }
    };
 
    // Add new method to handle token cost calculation for operations
    private buildUploadInfo(operationData: { single_image?: number; video_frame?: number; zip_file?: number }) {
        const uploadInfo: {
            images?: number;
            videos?: { frames: number }[];
            zipFiles?: number;
            isZipUpload?: boolean;
        } = {};
        // Build upload info based on provided operation data
        if ("single_image" in operationData) {
            uploadInfo.images = operationData.single_image;
        }
        // Handle video frames
        if ("video_frame" in operationData) {
            uploadInfo.videos = [{ frames: operationData.video_frame! }];
        }
        // Handle zip files
        if ("zip_file" in operationData) {
            uploadInfo.zipFiles = operationData.zip_file;
            uploadInfo.isZipUpload = true;
        }
        return uploadInfo;
    }
 
    // New method to build dataset content structure for inference requests
    private buildInferenceContent(operationData: { single_image?: number; video_frame?: number }) {
        let datasetContent: { pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number; uploadIndex?: string | number }>, type?: string } = {};
        // Build dataset content based on provided operation data
        if ("single_image" in operationData && operationData.single_image) {
            datasetContent.pairs = Array.from({ length: operationData.single_image }, (_, i) => ({
                imagePath: `image_${i}`,
                maskPath: `mask_${i}`,
                uploadIndex: i
            }));
            datasetContent.type = "image";
        }
        // Handle video frames
        if ("video_frame" in operationData && operationData.video_frame) {
            datasetContent.pairs = [
                ...(datasetContent.pairs || []),
                ...Array.from({ length: operationData.video_frame }, (_, i) => ({
                    imagePath: `video_frame_${i}`,
                    maskPath: `mask_${i}`,
                    frameIndex: i,
                    uploadIndex: "video1"
                }))
            ];
            datasetContent.type = "video-frames";
        }
        return datasetContent;
    }
 
}