import { UserRepository } from "../repository/userRepository";
import { TokenTransaction } from "../models/TokenTransaction";
import { DbConnection } from "../config/database";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";

const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

interface TokenReservationResult {
    success: boolean;
    reservationId?: string;
    error?: string;
}

interface TokenConfirmationResult {
    success: boolean;
    tokensSpent?: number;
    remainingBalance?: number;
    error?: string;
}

interface TokenBalanceResult {
    success: boolean;
    balance?: number;
    error?: string;
}

interface TokenTransactionHistoryResult {
    success: boolean;
    transactions?: Array<{
        id: string;
        operationType: string;
        operationId: string | null;
        amount: string;
        balanceBefore: string;
        balanceAfter: string;
        status: string;
        description: string | null;
        createdAt: Date;
    }>;
    error?: string;
}

interface DatasetUploadInfo {
    images?: number;
    videos?: Array<{ frames: number }>;

    zipFiles?: number;
    isZipUpload?: boolean;
}

interface DatasetContent {
    pairs?: Array<{
        imagePath: string;
        maskPath: string;
        frameIndex?: number;
        uploadIndex?: string | number;
    }>;
    type?: string;
}

export class TokenService {
    private static instance: TokenService;
    private readonly userRepository: UserRepository;
    private readonly sequelize;

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

    private constructor() {
        this.userRepository = UserRepository.getInstance();
        this.sequelize = DbConnection.getSequelizeInstance();
    }

    public static getInstance(): TokenService {
        if (!TokenService.instance) {
            TokenService.instance = new TokenService();
        }
        return TokenService.instance;
    }

    // NUOVO: Crea transazione pending e sottrae token immediatamente
    public async reserveTokens(
        userId: string,
        amount: number,
        operationType: "dataset_upload" | "inference",
        operationId: string
    ): Promise<TokenReservationResult> {
        try {
            return await this.sequelize.transaction(async (t) => {
                // Get current user balance
                const user = await this.userRepository.getUserById(userId);
                if (!user) {
                    throw new Error("User not found");
                }

                const currentBalance = Number(user.tokens);
                const requiredAmount = Number(amount);

                // Check if user has sufficient balance
                if (currentBalance < requiredAmount) {
                    const shortfall = requiredAmount - currentBalance;
                    
                    // Create ABORTED transaction to record the failed attempt
                    await TokenTransaction.create({
                        userId,
                        operationType,
                        operationId: `ABORTED_${operationId}`,
                        amount: -requiredAmount, // Negative for deduction attempt
                        balanceBefore: currentBalance,
                        balanceAfter: currentBalance, // Balance unchanged
                        status: "aborted",
                        description: `Insufficient balance. Required: ${requiredAmount} tokens, Current balance: ${currentBalance} tokens, Shortfall: ${shortfall} tokens`
                    }, { transaction: t });

                    console.log(`❌ Token reservation failed: Insufficient balance for user ${userId}`);
                    errorLogger.logAuthorizationError(userId, `Insufficient tokens: required ${requiredAmount}, available ${currentBalance}`);
                    
                    return {
                        success: false,
                        error: `Insufficient tokens. Required: ${requiredAmount} tokens, Current balance: ${currentBalance} tokens, Shortfall: ${shortfall} tokens`
                    };
                }

                // Calculate new balance after deduction
                const newBalance = currentBalance - requiredAmount;

                // Create PENDING transaction and deduct tokens immediately
                const transaction = await TokenTransaction.create({
                    userId,
                    operationType,
                    operationId,
                    amount: -requiredAmount, // Negative for deduction
                    balanceBefore: currentBalance,
                    balanceAfter: newBalance,
                    status: "pending", // Will be confirmed or refunded later
                    description: `Token reservation for ${operationType}: ${operationId}`
                }, { transaction: t });

                // Update user balance immediately
                await this.userRepository.updateUserTokens(userId, newBalance);

                console.log(`✅ Tokens reserved: ${requiredAmount} for user ${userId}, new balance: ${newBalance}`);
                
                return {
                    success: true,
                    reservationId: transaction.id // Use transaction ID as reservation ID
                };
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("RESERVE_TOKENS", "token_transactions", err.message);
            console.error(`❌ Token reservation error for user ${userId}:`, err.message);
            
            return {
                success: false,
                error: `Token reservation failed: ${err.message}`
            };
        }
    }

    // NUOVO: Conferma la transazione (da PENDING a COMPLETED)
    public async confirmTokenUsage(reservationId: string): Promise<TokenConfirmationResult> {
        try {
            return await this.sequelize.transaction(async (t) => {
                // Find the pending transaction
                const transaction = await TokenTransaction.findByPk(reservationId, { transaction: t });
                
                if (!transaction) {
                    throw new Error("Reservation not found");
                }

                if (transaction.status !== "pending") {
                    throw new Error(`Transaction already ${transaction.status}`);
                }

                // Update transaction status to completed
                await transaction.update({
                    status: "completed",
                    description: `${transaction.description} - Operation confirmed`
                }, { transaction: t });

                const tokensSpent = Math.abs(Number(transaction.amount));
                const remainingBalance = Number(transaction.balanceAfter);

                console.log(`✅ Token usage confirmed: ${tokensSpent} tokens, remaining balance: ${remainingBalance}`);
                
                return {
                    success: true,
                    tokensSpent,
                    remainingBalance
                };
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("CONFIRM_TOKENS", "token_transactions", err.message);
            console.error(`❌ Token confirmation error for reservation ${reservationId}:`, err.message);
            
            return {
                success: false,
                error: `Token confirmation failed: ${err.message}`
            };
        }
    }

    // NUOVO: Rimborsa i token (da PENDING a REFUNDED)
    public async refundTokens(reservationId: string): Promise<TokenConfirmationResult> {
        try {
            return await this.sequelize.transaction(async (t) => {
                // Find the pending transaction
                const transaction = await TokenTransaction.findByPk(reservationId, { transaction: t });
                
                if (!transaction) {
                    console.log(`⚠️ Refund requested for non-existent reservation: ${reservationId}`);
                    return { success: true, tokensSpent: 0, remainingBalance: 0 }; // Silent success
                }

                if (transaction.status !== "pending") {
                    console.log(`⚠️ Refund requested for non-pending transaction: ${transaction.status}`);
                    return { success: true, tokensSpent: 0, remainingBalance: Number(transaction.balanceAfter) };
                }

                const tokensToRefund = Math.abs(Number(transaction.amount));
                const originalBalance = Number(transaction.balanceBefore);

                // Restore user balance
                await this.userRepository.updateUserTokens(transaction.userId, originalBalance);

                // Update transaction status to refunded
                await transaction.update({
                    status: "refunded",
                    description: `${transaction.description} - Refunded due to operation failure`
                }, { transaction: t });

                console.log(`💰 Tokens refunded: ${tokensToRefund} for user ${transaction.userId}, balance restored to: ${originalBalance}`);
                
                return {
                    success: true,
                    tokensSpent: 0, // No tokens spent since refunded
                    remainingBalance: originalBalance
                };
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("REFUND_TOKENS", "token_transactions", err.message);
            console.error(`❌ Token refund error for reservation ${reservationId}:`, err.message);
            
            return {
                success: false,
                error: `Token refund failed: ${err.message}`
            };
        }
    }

    public async getUserTokenBalance(userId: string): Promise<TokenBalanceResult> {
        try {
            const user = await this.userRepository.getUserById(userId);
            if (!user) {
                return { success: false, error: "User not found" };
            }

            return {
                success: true,
                balance: Number(user.tokens)
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("GET_TOKEN_BALANCE", "users", err.message);
            return {
                success: false,
                error: `Failed to get token balance: ${err.message}`
            };
        }
    }

    public async rechargeUserTokens(
        adminUserId: string,
        targetUserEmail: string,
        amount: number
    ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
        try {
            return await this.sequelize.transaction(async (t) => {
                // Verify admin privileges
                const admin = await this.userRepository.getUserById(adminUserId);
                if (!admin || admin.role !== "admin") {
                    throw new Error("Admin privileges required");
                }

                // Find target user
                const targetUser = await this.userRepository.getUserByEmail(targetUserEmail);
                if (!targetUser) {
                    throw new Error("Target user not found");
                }

                const currentBalance = Number(targetUser.tokens);
                const rechargeAmount = Number(amount);
                const newBalance = currentBalance + rechargeAmount;

                // Create recharge transaction
                await TokenTransaction.create({
                    userId: targetUser.id,
                    operationType: "admin_recharge",
                    operationId: `admin_recharge_${adminUserId}_${Date.now()}`,
                    amount: rechargeAmount, // Positive for recharge
                    balanceBefore: currentBalance,
                    balanceAfter: newBalance,
                    status: "completed",
                    description: `Admin recharge by ${admin.email}: +${rechargeAmount} tokens`
                }, { transaction: t });

                // Update user balance
                await this.userRepository.updateUserTokens(targetUser.id, newBalance);

                console.log(`💰 Admin recharge: ${rechargeAmount} tokens added to ${targetUserEmail} by ${admin.email}`);

                return {
                    success: true,
                    newBalance
                };
            });

        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("ADMIN_RECHARGE", "token_transactions", err.message);
            return {
                success: false,
                error: err.message
            };
        }
    }

    public async getUserTransactionHistory(
        userId: string,
        limit: number = 50
    ): Promise<TokenTransactionHistoryResult> {
        try {
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
                    "status",
                    "description",
                    "createdAt"
                ]
            });

            return {
                success: true,
                transactions: transactions.map(t => ({
                    id: t.id,
                    operationType: t.operationType,
                    operationId: t.operationId,
                    amount: t.amount.toString(),
                    balanceBefore: t.balanceBefore.toString(),
                    balanceAfter: t.balanceAfter.toString(),
                    status: t.status,
                    description: t.description,
                    createdAt: t.createdAt
                }))
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("GET_TRANSACTION_HISTORY", "token_transactions", err.message);
            return {
                success: false,
                error: `Failed to get transaction history: ${err.message}`
            };
        }
    }

    // ...existing calculation methods remain the same...
    public calculateDatasetUploadCost(uploadInfo: DatasetUploadInfo): { totalCost: number; breakdown: Record<string, number> } {
        let totalCost = 0;
        const breakdown: Record<string, number> = {};

        if (uploadInfo.isZipUpload && uploadInfo.zipFiles) {
            const zipCost = uploadInfo.zipFiles * TokenService.PRICING.DATASET_UPLOAD.ZIP_FILE;
            totalCost += zipCost;
            breakdown.zipFiles = zipCost;
        } else {
            if (uploadInfo.images) {
                const imageCost = uploadInfo.images * TokenService.PRICING.DATASET_UPLOAD.SINGLE_IMAGE;
                totalCost += imageCost;
                breakdown.singleImages = imageCost;
            }

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

    public calculateInferenceCost(datasetContent: DatasetContent): { totalCost: number; breakdown: Record<string, number> } {
        const breakdown: Record<string, number> = {};
        let totalCost = 0;

        if (!datasetContent.pairs || datasetContent.pairs.length === 0) {
            return { totalCost: 0, breakdown: {} };
        }

        const uploadGroups = new Map<string | number, number>();

        for (const pair of datasetContent.pairs) {
            const uploadIndex = pair.uploadIndex ?? "default";
            uploadGroups.set(uploadIndex, (uploadGroups.get(uploadIndex) || 0) + 1);
        }

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
      