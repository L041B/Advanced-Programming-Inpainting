//import necessary modules and types
import { UserRepository } from "../repository/userRepository";
import { TokenTransaction } from "../models/TokenTransaction";
import { DbConnection } from "../config/database";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Define interfaces for input data structures
interface DatasetUploadInfo {
    images?: number;
    videos?: Array<{ frames: number }>;

    zipFiles?: number;
    isZipUpload?: boolean;
}

// Define interfaces for dataset content used in inference cost calculation
interface DatasetContent {
    pairs?: Array<{
        imagePath: string;
        maskPath: string;
        frameIndex?: number;
        uploadIndex?: string | number;
    }>;
    type?: string;
}

// TokenService handles all token-related operations such as reservation, confirmation, refund, and balance checks.
export class TokenService {
    private static instance: TokenService;
    private readonly userRepository: UserRepository;
    private readonly sequelize;
    private readonly errorManager: ErrorManager;
    private readonly userLogger: UserRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    // Pricing structure
    private static readonly PRICING = {
        DATASET_UPLOAD: {
            SINGLE_IMAGE: 0.65,
            VIDEO_FRAME: 0.4,
            ZIP_FILE: 0.7
        },
        INFERENCE: {
            SINGLE_IMAGE: 2.75,
            VIDEO_FRAME: 1.5
        }
    };

    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.userRepository = UserRepository.getInstance();
        this.sequelize = DbConnection.getSequelizeInstance();
        this.errorManager = ErrorManager.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Get the singleton instance of TokenService.
    public static getInstance(): TokenService {
        if (!TokenService.instance) {
            TokenService.instance = new TokenService();
        }
        return TokenService.instance;
    }

    // Throws standardized errors instead of returning result objects
    public async reserveTokens(
        userId: string,
        amount: number,
        operationType: "dataset_upload" | "inference",
        operationId: string
    ): Promise<string> { // Returns reservationId directly
        try {
            return await this.sequelize.transaction(async (t) => {
                const user = await this.userRepository.getUserById(userId);
                if (!user) {
                    throw this.errorManager.createError(ErrorStatus.userNotFoundError);
                }

                // Ensure user has enough tokens
                const currentBalance = Number(user.tokens);
                const requiredAmount = Number(amount);

                // If insufficient balance, log and throw error
                if (currentBalance < requiredAmount) {
                    const shortfall = requiredAmount - currentBalance;
                    
                    // Create ABORTED transaction to record the failed attempt
                    await TokenTransaction.create({
                        userId,
                        operationType,
                        operationId: `ABORTED_${operationId}`,
                        amount: -requiredAmount,
                        balanceBefore: currentBalance,
                        balanceAfter: currentBalance,
                        status: "aborted",
                        description: `Insufficient balance. Required: ${requiredAmount} tokens, Current balance: ${currentBalance} tokens, Shortfall: ${shortfall} tokens`
                    }, { transaction: t });

                    // Log the insufficient tokens attempt
                    this.errorLogger.logAuthorizationError(userId, `Insufficient tokens: required ${requiredAmount}, available ${currentBalance}`);
                    throw this.errorManager.createError(
                        ErrorStatus.insufficientTokensError, 
                        `Insufficient tokens. Required: ${requiredAmount} tokens, Current balance: ${currentBalance} tokens, Shortfall: ${shortfall} tokens`
                    );
                }

                // Deduct tokens and create a pending transaction
                const newBalance = currentBalance - requiredAmount;

                const transaction = await TokenTransaction.create({
                    userId,
                    operationType,
                    operationId,
                    amount: -requiredAmount,
                    balanceBefore: currentBalance,
                    balanceAfter: newBalance,
                    status: "pending",
                    description: `Token reservation for ${operationType}: ${operationId}`
                }, { transaction: t });

                await this.userRepository.updateUserTokens(userId, newBalance);

                this.userLogger.logTokenReservation(userId, requiredAmount, operationType, operationId);
                
                return transaction.id;
            });
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            this.errorLogger.logDatabaseError("RESERVE_TOKENS", "token_transactions", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.tokenReservationFailedError);
        }
    }

    // Confirms a pending token reservation, finalizing the deduction.
    public async confirmTokenUsage(reservationId: string): Promise<{ tokensSpent: number; remainingBalance: number }> {
        try {
            return await this.sequelize.transaction(async (t) => {
                const transaction = await TokenTransaction.findByPk(reservationId, { transaction: t });
                
                //  If transaction not found, throw error
                if (!transaction) {
                    throw this.errorManager.createError(ErrorStatus.reservationNotFoundError);
                }

                // Only pending transactions can be confirmed
                if (transaction.status !== "pending") {
                    throw this.errorManager.createError(
                        ErrorStatus.tokenConfirmationFailedError,
                        `Transaction already ${transaction.status}`
                    );
                }

                // Update transaction to completed
                await transaction.update({
                    status: "completed",
                    description: `${transaction.description} - Operation confirmed`
                }, { transaction: t });

                // Log the confirmation
                const tokensSpent = Math.abs(Number(transaction.amount));
                const remainingBalance = Number(transaction.balanceAfter);

                this.userLogger.logTokenConfirmation(reservationId, tokensSpent, remainingBalance);
                
                return { tokensSpent, remainingBalance };
            });
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            this.errorLogger.logDatabaseError("CONFIRM_TOKENS", "token_transactions", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.tokenConfirmationFailedError);
        }
    }

    // Refunds tokens from a pending reservation back to the user's balance.
    public async refundTokens(reservationId: string): Promise<{ tokensRefunded: number; restoredBalance: number }> {
        try {
            return await this.sequelize.transaction(async (t) => {
                const transaction = await TokenTransaction.findByPk(reservationId, { transaction: t });
                
                if (!transaction) {
                    // Silent success for non-existent reservations to avoid breaking the flow
                    this.userLogger.logTokenRefund(reservationId, 0, 0);
                    return { tokensRefunded: 0, restoredBalance: 0 };
                }

                // Only pending transactions can be refunded
                if (transaction.status !== "pending") {
                    // Silent success for non-pending transactions
                    const balance = Number(transaction.balanceAfter);
                    this.userLogger.logTokenRefund(reservationId, 0, balance);
                    return { tokensRefunded: 0, restoredBalance: balance };
                }

                // Refund tokens and update transaction to refunded
                const tokensToRefund = Math.abs(Number(transaction.amount));
                const originalBalance = Number(transaction.balanceBefore);

                await this.userRepository.updateUserTokens(transaction.userId, originalBalance);

                await transaction.update({
                    status: "refunded",
                    description: `${transaction.description} - Refunded due to operation failure`
                }, { transaction: t });

                this.userLogger.logTokenRefund(reservationId, tokensToRefund, originalBalance);
                
                return { tokensRefunded: tokensToRefund, restoredBalance: originalBalance };
            });
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            this.errorLogger.logDatabaseError("REFUND_TOKENS", "token_transactions", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.tokenRefundFailedError);
        }
    }

    // Retrieves the current token balance for a user.
    public async getUserTokenBalance(userId: string): Promise<number> {
        try {
            const user = await this.userRepository.getUserById(userId);
            if (!user) {
                throw this.errorManager.createError(ErrorStatus.userNotFoundError);
            }

            // Ensure balance is a number
            const balance = Number(user.tokens);
            this.userLogger.logTokenBalanceCheck(userId, balance);
            return balance;
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            this.errorLogger.logDatabaseError("GET_TOKEN_BALANCE", "users", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Admin function to recharge tokens to a user's account
    public async rechargeUserTokens(
        adminUserId: string,
        targetUserEmail: string,
        amount: number
    ): Promise<number> { // Returns new balance directly
        try {
            return await this.sequelize.transaction(async (t) => {
                // Verify admin privileges
                const admin = await this.userRepository.getUserById(adminUserId);
                if (!admin || admin.role !== "admin") {
                    throw this.errorManager.createError(ErrorStatus.adminPrivilegesRequiredError);
                }

                // Find target user by email
                const targetUser = await this.userRepository.getUserByEmail(targetUserEmail);
                if (!targetUser) {
                    throw this.errorManager.createError(ErrorStatus.userNotFoundError, "Target user not found");
                }

                // Balance calculations
                const currentBalance = Number(targetUser.tokens);
                const rechargeAmount = Number(amount);
                const newBalance = currentBalance + rechargeAmount;

                await TokenTransaction.create({
                    userId: targetUser.id,
                    operationType: "admin_recharge",
                    operationId: `admin_recharge_${adminUserId}_${Date.now()}`,
                    amount: rechargeAmount,
                    balanceBefore: currentBalance,
                    balanceAfter: newBalance,
                    status: "completed",
                    description: `Admin recharge by ${admin.email}: +${rechargeAmount} tokens`
                }, { transaction: t });

                await this.userRepository.updateUserTokens(targetUser.id, newBalance);

                this.userLogger.logAdminTokenRecharge(adminUserId, targetUserEmail, rechargeAmount, newBalance);

                return newBalance;
            });
        } catch (error) {
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }
            this.errorLogger.logDatabaseError("ADMIN_RECHARGE", "token_transactions", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.tokenRechargeFailedError);
        }
    }

    // Retrieves a user's transaction history, limited to the most recent entries.
    public async getUserTransactionHistory(
        userId: string,
        limit: number = 50
    ): Promise<Array<{
        id: string;
        operationType: string;
        operationId: string | null;
        amount: string;
        balanceBefore: string;
        balanceAfter: string;
        description: string | null;
        createdAt: Date;
    }>> {
        try {
            // Validate user existence
            const transactions = await TokenTransaction.findAll({
                where: { userId },
                order: [["createdAt", "DESC"]],
                limit,
                attributes: [
                    "id",
                    "operationType",
                    "operationId", 
                    "amount",
                    "balanceBefore",
                    "balanceAfter",
                    "description",
                    "createdAt"
                ]
            });

            // Map to desired output format
            return transactions.map(t => ({
                id: t.id,
                operationType: t.operationType,
                operationId: t.operationId,
                amount: t.amount.toString(),
                balanceBefore: t.balanceBefore.toString(),
                balanceAfter: t.balanceAfter.toString(),
                description: t.description,
                createdAt: t.createdAt
            }));
        } catch (error) {
            this.errorLogger.logDatabaseError("GET_TRANSACTION_HISTORY", "token_transactions", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Calculates the token cost for uploading a dataset based on its contents.
    public calculateDatasetUploadCost(uploadInfo: DatasetUploadInfo): { totalCost: number; breakdown: Record<string, number> } {
        let totalCost = 0;
        const breakdown: Record<string, number> = {};

        if (uploadInfo.isZipUpload && uploadInfo.zipFiles) {
            const zipCost = uploadInfo.zipFiles * TokenService.PRICING.DATASET_UPLOAD.ZIP_FILE;
            totalCost += zipCost;
            breakdown.zipFiles = zipCost;
        } else {
            // Individual file uploads
            if (uploadInfo.images) {
                const imageCost = uploadInfo.images * TokenService.PRICING.DATASET_UPLOAD.SINGLE_IMAGE;
                totalCost += imageCost;
                breakdown.singleImages = imageCost;
            }

            // Video frame uploads
            if (uploadInfo.videos) {
                const videoFrameCost = uploadInfo.videos.reduce((sum, video) => 
                    sum + (video.frames * TokenService.PRICING.DATASET_UPLOAD.VIDEO_FRAME), 0
                );
                totalCost += videoFrameCost;
                breakdown.videoFrames = videoFrameCost;
            }
        }

        return { totalCost, breakdown };
    }

    // Calculates the token cost for performing inference based on dataset content.
    public calculateInferenceCost(datasetContent: DatasetContent): { totalCost: number; breakdown: Record<string, number> } {
        const breakdown: Record<string, number> = {};
        let totalCost = 0;

        // If no pairs, cost is zero
        if (!datasetContent.pairs || datasetContent.pairs.length === 0) {
            return { totalCost: 0, breakdown: {} };
        }

        // Group pairs by uploadIndex to differentiate single images from video frames
        const uploadGroups = new Map<string | number, number>();

        for (const pair of datasetContent.pairs) {
            const uploadIndex = pair.uploadIndex ?? "default";
            uploadGroups.set(uploadIndex, (uploadGroups.get(uploadIndex) || 0) + 1);
        }

        // Calculate costs based on groupings
        let singleImageCost = 0;
        let videoFrameCost = 0;

        for (const [, count] of uploadGroups) {
            if (count === 1) {
                // Single image
                singleImageCost += TokenService.PRICING.INFERENCE.SINGLE_IMAGE;
            } else {
                // Video frames
                videoFrameCost += count * TokenService.PRICING.INFERENCE.VIDEO_FRAME;
            }
        }

        totalCost = singleImageCost + videoFrameCost;

        if (singleImageCost > 0) breakdown.singleImages = singleImageCost;
        if (videoFrameCost > 0) breakdown.videoFrames = videoFrameCost;

        return { totalCost, breakdown };
    }
}
