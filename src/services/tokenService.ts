import { UserRepository } from "../repository/userRepository";
import { TokenTransaction } from "../models/TokenTransaction";
import { DbConnection } from "../config/database";
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { Op } from "sequelize";

const userLogger: UserRouteLogger = loggerFactory.createUserLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

interface TokenPricing {
  SINGLE_IMAGE_DATASET: 0.65;
  VIDEO_FRAME_DATASET: 0.4;
  ZIP_FILE_DATASET: 0.7;
  SINGLE_IMAGE_INFERENCE: 2.75;
  VIDEO_FRAME_INFERENCE: 1.5;
}

interface CostBreakdown {
  imageCount?: number;
  videoCount?: number;
  frameCount?: number;
  zipFileCount?: number;
  calculatedCost: number;
}

interface CostCalculationResult {
  totalCost: number;
  breakdown: CostBreakdown;
}

interface TokenReservationRecord {
  reservationKey: string;
  ownerUserId: string;
  reservedAmount: number;
  operationCategory: "dataset_upload" | "inference";
  operationReference: string;
  validUntil: Date;
}

export class TokenService {
  private static serviceInstance: TokenService;
  private readonly userRepo: UserRepository;
  private readonly dbConnection = DbConnection.getSequelizeInstance();
  private static cleanupLock = false; // Prevent multiple cleanup processes
  
  // Token pricing structure
  private readonly PRICING_STRUCTURE: TokenPricing = {
    SINGLE_IMAGE_DATASET: 0.65,
    ZIP_FILE_DATASET: 0.7,
    VIDEO_FRAME_DATASET: 0.4,
    SINGLE_IMAGE_INFERENCE: 2.75,
    VIDEO_FRAME_INFERENCE: 1.5,
  };

  // In-memory reservation tracking
  private reservationStorage = new Map<string, TokenReservationRecord>();

  private constructor() {
    this.userRepo = UserRepository.getInstance();
    
    // Clean up stale pending transactions on startup (only once across all instances)
    if (!TokenService.cleanupLock) {
      TokenService.cleanupLock = true;
      setTimeout(() => {
        this.cleanupStalePendingTransactions().catch(error => {
          errorLogger.logDatabaseError("STARTUP_CLEANUP", "token_transactions", `Failed to cleanup stale transactions: ${error}`);
        }).finally(() => {
          TokenService.cleanupLock = false;
        });
      }, 2000); // Delay to ensure database is fully ready
    }
    
    // Automated cleanup of expired reservations every 5 minutes
    setInterval(() => {
      this.performReservationCleanup();
    }, 300000);
  }

  public static getInstance(): TokenService {
    if (!TokenService.serviceInstance) {
      TokenService.serviceInstance = new TokenService();
    }
    return TokenService.serviceInstance;
  }

  // Calculate dataset upload cost
  public calculateDatasetUploadCost(uploadInfo: {
    images?: number;
    videos?: { frames: number }[];
    zipFiles?: number;
    isZipUpload?: boolean;
  }): CostCalculationResult {
    let totalCost = 0;
    const breakdown: CostBreakdown = { calculatedCost: 0 };

    if (uploadInfo.isZipUpload) {
      // ZIP file processing - 0.7 per image-mask or video-mask pair
      let totalPairs = 0;
      
      if (uploadInfo.images) {
        totalPairs += uploadInfo.images;
        breakdown.imageCount = uploadInfo.images;
      }
      
      if (uploadInfo.videos) {
        totalPairs += uploadInfo.videos.length; // Count videos, not frames
        breakdown.videoCount = uploadInfo.videos.length;
        breakdown.frameCount = uploadInfo.videos.reduce((acc, video) => acc + video.frames, 0);
      }
      
      totalCost = totalPairs * this.PRICING_STRUCTURE.ZIP_FILE_DATASET;
      
    } else {
      // Regular upload processing
      
      // Image-mask pairs: 0.65 per pair
      if (uploadInfo.images) {
        const imageCost = uploadInfo.images * this.PRICING_STRUCTURE.SINGLE_IMAGE_DATASET;
        totalCost += imageCost;
        breakdown.imageCount = uploadInfo.images;
      }

      // Video processing: 0.4 per frame (regardless of mask type)
      if (uploadInfo.videos) {
        const totalFrames = uploadInfo.videos.reduce((accumulator, video) => accumulator + video.frames, 0);
        const videoCost = totalFrames * this.PRICING_STRUCTURE.VIDEO_FRAME_DATASET;
        totalCost += videoCost;
        breakdown.videoCount = uploadInfo.videos.length;
        breakdown.frameCount = totalFrames;
      }
    }

    breakdown.calculatedCost = totalCost;

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      breakdown
    };
  }

  // Calculate inference processing cost
  public calculateInferenceCost(datasetContent: {
    pairs?: Array<{ imagePath: string; maskPath: string; frameIndex?: number; uploadIndex?: string | number }>,
    type?: string
  }): CostCalculationResult {
    let totalCost = 0;
    const breakdown: CostBreakdown = { calculatedCost: 0 };

    if (!datasetContent.pairs || datasetContent.pairs.length === 0) {
      return { totalCost: 0, breakdown };
    }

    // Count occurrences of each uploadIndex to detect videos vs images
    const uploadIndexCounts = new Map<string, number>();
    
    datasetContent.pairs.forEach(pair => {
      if (pair.uploadIndex !== undefined && pair.uploadIndex !== null) {
        const indexKey = String(pair.uploadIndex);
        uploadIndexCounts.set(indexKey, (uploadIndexCounts.get(indexKey) || 0) + 1);
      }
    });

    let imageCount = 0;
    let videoFrameCount = 0;

    // Process each unique uploadIndex according to the rules
    for (const [, count] of uploadIndexCounts.entries()) {
      if (count === 1) {
        // Single occurrence = IMAGE: 2.75 tokens per image
        imageCount += 1;
        totalCost += this.PRICING_STRUCTURE.SINGLE_IMAGE_INFERENCE; // 2.75
      } else {
        // Multiple occurrences = VIDEO: 1.5 tokens per frame
        videoFrameCount += count;
        totalCost += count * this.PRICING_STRUCTURE.VIDEO_FRAME_INFERENCE; // 1.5 per frame
      }
    }

    // Handle pairs without uploadIndex (legacy fallback)
    const pairsWithoutIndex = datasetContent.pairs.filter(pair => 
      pair.uploadIndex === undefined || pair.uploadIndex === null
    );
    
    if (pairsWithoutIndex.length > 0) {
      // Use type as fallback only if no uploadIndex is available
      if (datasetContent.type === "video-frames") {
        // All pairs are video frames: 1.5 per frame
        videoFrameCount += pairsWithoutIndex.length;
        totalCost += pairsWithoutIndex.length * this.PRICING_STRUCTURE.VIDEO_FRAME_INFERENCE;
      } else {
        // All pairs are images: 2.75 per image
        imageCount += pairsWithoutIndex.length;
        totalCost += pairsWithoutIndex.length * this.PRICING_STRUCTURE.SINGLE_IMAGE_INFERENCE;
      }
    }

    breakdown.imageCount = imageCount > 0 ? imageCount : undefined;
    breakdown.frameCount = videoFrameCount > 0 ? videoFrameCount : undefined;
    breakdown.calculatedCost = totalCost;

    return {
      totalCost: Math.round(totalCost * 100) / 100,
      breakdown
    };
  }

  // Reserve tokens for operations
  public async reserveTokens(
    userId: string,
    amount: number,
    operationType: "dataset_upload" | "inference",
    operationId: string
  ): Promise<{ success: boolean; reservationId?: string; error?: string }> {
    return await this.createTokenReservation(userId, amount, operationType, operationId);
  }

  // Confirm token usage
  public async confirmTokenUsage(reservationId: string): Promise<{ success: boolean; tokensSpent?: number; remainingBalance?: number; error?: string }> {
    return await this.finalizeTokenUsage(reservationId);
  }

  // Refund tokens
  public async refundTokens(reservationId: string): Promise<{ success: boolean; error?: string }> {
    return await this.refundReservedTokens(reservationId);
  }

  // Get user token balance
  public async getUserTokenBalance(userId: string): Promise<{ success: boolean; balance?: number; error?: string }> {
    return await this.retrieveUserTokenBalance(userId);
  }

  // Get user transaction history
  public async getUserTransactionHistory(userId: string, limit = 50): Promise<{ success: boolean; transactions?: TokenTransaction[]; error?: string }> {
    return await this.retrieveTransactionHistory(userId, limit);
  }

  // Get all transactions (admin only)
  public async getAllTransactions(
    filters: { status?: string; operationType?: string; userId?: string } = {},
    limit = 50,
    offset = 0
  ): Promise<{ success: boolean; transactions?: TokenTransaction[]; count?: number; error?: string }> {
    try {
      const whereConditions: {
        status?: string;
        operationType?: string;
        userId?: string;
      } = {};
      
      if (filters.status) {
        whereConditions.status = filters.status;
      }
      if (filters.operationType) {
        whereConditions.operationType = filters.operationType;
      }
      if (filters.userId) {
        whereConditions.userId = filters.userId;
      }

      const { rows: transactions, count } = await TokenTransaction.findAndCountAll({
        where: whereConditions,
        order: [["createdAt", "DESC"]],
        limit,
        offset
      });

      return { success: true, transactions, count };

    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("GET_ALL_TRANSACTIONS", "token_transactions", err.message);
      return { success: false, error: "Failed to retrieve all transactions" };
    }
  }

  // Admin recharge tokens
  public async rechargeUserTokens(adminUserId: string, userEmail: string, amount: number): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    return await this.performAdminTokenRecharge(adminUserId, userEmail, amount);
  }

  // Create token reservation to prevent double-spending
  private async createTokenReservation(
    userId: string,
    amount: number,
    operationType: "dataset_upload" | "inference",
    operationId: string
  ): Promise<{ success: boolean; reservationKey?: string; error?: string }> {
    const dbTransaction = await this.dbConnection.transaction();

    try {
      // Get fresh user data with current balance
      const user = await this.userRepo.getUserById(userId);
      if (!user) {
        await dbTransaction.rollback();
        errorLogger.logDatabaseError("CREATE_RESERVATION", "users", "User not found");
        return { success: false, error: "User account not found. Please contact support." };
      }

      // Check if user has sufficient tokens (including pending reservations)
      const currentBalance = user.tokens;
      if (currentBalance < amount) {
        // NEW: Record aborted transaction before returning error
        await TokenTransaction.create({
          userId,
          operationType,
          operationId,
          amount: -amount, // Negative amount (what was requested)
          balanceBefore: currentBalance,
          balanceAfter: currentBalance, // Balance remains unchanged
          status: "aborted",
          description: `Transaction aborted due to insufficient tokens. Required: ${amount}, Available: ${currentBalance}, Shortfall: ${amount - currentBalance}`
        }, { transaction: dbTransaction });

        await dbTransaction.commit(); // Commit the aborted transaction record
        
        errorLogger.logAuthorizationError(userId, `Insufficient token balance: ${currentBalance} < ${amount}`);
        
        // Create detailed error message based on operation type
        const operationName = operationType === "dataset_upload" ? "dataset upload" : "inference processing";
        const shortfall = amount - currentBalance;
        
        return { 
          success: false, 
          error: `Insufficient tokens for ${operationName}. Required: ${amount} tokens, Current balance: ${currentBalance} tokens, Shortfall: ${shortfall} tokens. Please contact an administrator to recharge your account.`
        };
      }

      // Generate unique reservation key
      const reservationKey = `${userId}_${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const expirationTime = new Date(Date.now() + 1800000); // 30 minutes validity

      const reservationRecord: TokenReservationRecord = {
        reservationKey,
        ownerUserId: userId,
        reservedAmount: amount,
        operationCategory: operationType,
        operationReference: operationId,
        validUntil: expirationTime
      };

      this.reservationStorage.set(reservationKey, reservationRecord);

      const newBalance = currentBalance - amount;

      // Deduct tokens from user balance
      await user.update({ tokens: newBalance }, { transaction: dbTransaction });

      // Create pending transaction record
      await TokenTransaction.create({
        userId,
        operationType,
        operationId,
        amount: -amount,
        balanceBefore: currentBalance,
        balanceAfter: newBalance,
        status: "pending",
        description: `Token reservation for ${operationType} operation`
      }, { transaction: dbTransaction });

      await dbTransaction.commit();

      userLogger.logTokenReservation(userId, amount, operationType, reservationKey);

      return { success: true, reservationKey };

    } catch (error) {
      await dbTransaction.rollback();
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("CREATE_RESERVATION", "users", err.message);
      
      // More specific error message based on the type of error
      if (err.message.includes("insufficient")) {
        return { 
          success: false, 
          error: "Token reservation failed due to insufficient balance. Please recharge your account or try a smaller operation."
        };
      } else if (err.message.includes("timeout") || err.message.includes("connection")) {
        return { 
          success: false, 
          error: "Token reservation failed due to database connectivity issues. Please try again in a few moments."
        };
      } else {
        return { 
          success: false, 
          error: "Token reservation failed due to a system error. Please contact support if this problem persists."
        };
      }
    }
  }

  // Confirm and finalize token usage
  private async finalizeTokenUsage(reservationKey: string): Promise<{ success: boolean; tokensSpent?: number; remainingBalance?: number; error?: string }> {
    const dbTransaction = await this.dbConnection.transaction();

    try {
      const reservation = this.reservationStorage.get(reservationKey);
      if (!reservation) {
        await dbTransaction.rollback();
        errorLogger.logDatabaseError("FINALIZE_TOKENS", "reservations", "Reservation not found");
        return { success: false, error: "Reservation not found" };
      }

      if (new Date() > reservation.validUntil) {
        await dbTransaction.rollback();
        this.reservationStorage.delete(reservationKey);
        errorLogger.logDatabaseError("FINALIZE_TOKENS", "reservations", "Reservation expired");
        return { success: false, error: "Reservation expired" };
      }

      // Get user's current balance (after token deduction from reservation)
      const user = await this.userRepo.getUserById(reservation.ownerUserId);
      if (!user) {
        await dbTransaction.rollback();
        errorLogger.logDatabaseError("FINALIZE_TOKENS", "users", "User not found");
        return { success: false, error: "User not found" };
      }

      // Update transaction record to completed status
      await TokenTransaction.update(
        { status: "completed", description: `Successfully completed ${reservation.operationCategory}` },
        {
          where: {
            userId: reservation.ownerUserId,
            operationType: reservation.operationCategory,
            operationId: reservation.operationReference,
            status: "pending"
          },
          transaction: dbTransaction
        }
      );

      // Get the actual transaction record to retrieve the exact amount spent
      const completedTransaction = await TokenTransaction.findOne({
        where: {
          userId: reservation.ownerUserId,
          operationType: reservation.operationCategory,
          operationId: reservation.operationReference,
          status: "completed"
        },
        order: [["createdAt", "DESC"]], // Get the most recent transaction
        transaction: dbTransaction
      });

      // Remove reservation from memory
      this.reservationStorage.delete(reservationKey);

      await dbTransaction.commit();

      // Use the actual transaction amount (convert to positive for tokensSpent)
      const actualTokensSpent = completedTransaction ? Math.abs(Number(completedTransaction.amount)) : reservation.reservedAmount;

      userLogger.logTokenUsage(reservation.ownerUserId, actualTokensSpent, reservation.operationCategory);

      return { 
        success: true, 
        tokensSpent: actualTokensSpent, // This is now the actual amount from the transaction
        remainingBalance: user.tokens // This is the balance after token deduction
      };

    } catch (error) {
      await dbTransaction.rollback();
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("FINALIZE_TOKENS", "token_transactions", err.message);
      return { success: false, error: "Failed to finalize token usage" };
    }
  }

  // Refund tokens for failed operations
  private async refundReservedTokens(reservationKey: string): Promise<{ success: boolean; error?: string }> {
    const dbTransaction = await this.dbConnection.transaction();

    try {
      const reservation = this.reservationStorage.get(reservationKey);
      if (!reservation) {
        await dbTransaction.rollback();
        errorLogger.logDatabaseError("REFUND_TOKENS", "reservations", "Reservation not found");
        return { success: false, error: "Reservation not found" };
      }

      const user = await this.userRepo.getUserById(reservation.ownerUserId);
      if (!user) {
        await dbTransaction.rollback();
        errorLogger.logDatabaseError("REFUND_TOKENS", "users", "User not found");
        return { success: false, error: "User not found" };
      }

      // Restore user token balance
      await user.update({ tokens: user.tokens + reservation.reservedAmount }, { transaction: dbTransaction });

      // Update transaction record to refunded status
      await TokenTransaction.update(
        { status: "refunded", description: `Refunded due to failed ${reservation.operationCategory}` },
        {
          where: {
            userId: reservation.ownerUserId,
            operationType: reservation.operationCategory,
            operationId: reservation.operationReference,
            status: "pending"
          },
          transaction: dbTransaction
        }
      );

      // Remove reservation from memory
      this.reservationStorage.delete(reservationKey);

      await dbTransaction.commit();

      userLogger.logTokenRefund(reservation.ownerUserId, reservation.reservedAmount, reservation.operationCategory);

      return { success: true };

    } catch (error) {
      await dbTransaction.rollback();
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("REFUND_TOKENS", "users", err.message);
      return { success: false, error: "Failed to process token refund" };
    }
  }

  // Admin functionality for token recharge
  private async performAdminTokenRecharge(
    adminUserId: string,
    targetUserEmail: string,
    rechargeAmount: number
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    const dbTransaction = await this.dbConnection.transaction();

    try {
      // Verify admin privileges
      const adminUser = await this.userRepo.getUserById(adminUserId);
      if (!adminUser || adminUser.role !== "admin") {
        await dbTransaction.rollback();
        errorLogger.logAuthorizationError(adminUserId, "Admin privileges required for token recharge");
        return { success: false, error: "Admin privileges required" };
      }

      // Locate target user by email
      const targetUser = await this.userRepo.getUserByEmail(targetUserEmail);
      if (!targetUser) {
        await dbTransaction.rollback();
        errorLogger.logDatabaseError("ADMIN_RECHARGE", "users", "Target user not found");
        return { success: false, error: "User not found" };
      }

      // Converti i valori in numeri per assicurarsi dell'aritmetica corretta
      const previousBalance = Number(targetUser.tokens);
      const rechargeAmountNum = Number(rechargeAmount);
      const updatedBalance = previousBalance + rechargeAmountNum;

      userLogger.log(`Admin recharge calculation: ${previousBalance} + ${rechargeAmountNum} = ${updatedBalance}`);

      // Update user token balance
      await targetUser.update({ tokens: updatedBalance }, { transaction: dbTransaction });

      // Record transaction
      await TokenTransaction.create({
        userId: targetUser.id,
        operationType: "admin_recharge",
        operationId: `admin_${adminUserId}`,
        amount: rechargeAmountNum, // Assicurati che sia numerico
        balanceBefore: previousBalance,
        balanceAfter: updatedBalance,
        status: "completed",
        description: `Admin token recharge by ${adminUser.email}: +${rechargeAmountNum} tokens`
      }, { transaction: dbTransaction });

      await dbTransaction.commit();

      userLogger.logTokenRecharge(targetUser.id, rechargeAmountNum, adminUserId);

      return { success: true, newBalance: updatedBalance };

    } catch (error) {
      await dbTransaction.rollback();
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("ADMIN_RECHARGE", "users", err.message);
      return { success: false, error: "Failed to process token recharge" };
    }
  }

  // Get current user token balance - always get fresh data
  private async retrieveUserTokenBalance(userId: string): Promise<{ success: boolean; balance?: number; error?: string }> {
    try {
      // Force fresh data retrieval without cache
      const user = await this.userRepo.getUserById(userId);
      if (!user) {
        errorLogger.logDatabaseError("GET_BALANCE", "users", "User not found");
        return { success: false, error: "User not found" };
      }

      // Reload the user instance to get the latest data from database
      await user.reload();

      return { success: true, balance: user.tokens };

    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("GET_BALANCE", "users", err.message);
      return { success: false, error: "Failed to retrieve token balance" };
    }
  }

  // Clean up expired reservations
  private performReservationCleanup(): void {
    const currentTime = new Date();
    let cleanupCount = 0;

    for (const [reservationKey, reservation] of this.reservationStorage.entries()) {
      if (currentTime > reservation.validUntil) {
        // Process refund for expired reservations
        this.refundReservedTokens(reservationKey).catch((error) => {
          errorLogger.logDatabaseError("CLEANUP_EXPIRED", "reservations", `Failed to refund ${reservationKey}: ${error}`);
        });
        cleanupCount++;
      }
    }

    if (cleanupCount > 0) {
      userLogger.log(`Processed cleanup for ${cleanupCount} expired token reservations`);
    }
  }

  // Clean up stale pending transactions (older than 1 hour)
  private async cleanupStalePendingTransactions(): Promise<void> {
    if (TokenService.cleanupLock) {
      return; // Another instance is already running cleanup
    }

    try {
      TokenService.cleanupLock = true;
      
      // Check if TokenTransaction model is properly initialized
      if (!TokenTransaction || typeof TokenTransaction.findAll !== "function") {
        userLogger.log("TokenTransaction model not ready for cleanup, skipping...");
        return;
      }

      const oneHourAgo = new Date(Date.now() - 3600000);
      
      // Find stale pending transactions with proper error handling
      let staleTransactions;
      try {
        staleTransactions = await TokenTransaction.findAll({
          where: {
            status: "pending",
            createdAt: {
              [Op.lt]: oneHourAgo
            }
          }
        });
      } catch (queryError) {
        const err = queryError instanceof Error ? queryError : new Error("Unknown query error");
        errorLogger.logDatabaseError("CLEANUP_STALE_QUERY", "token_transactions", err.message);
        return;
      }

      if (!staleTransactions || staleTransactions.length === 0) {
        userLogger.log("No stale pending transactions found");
        return;
      }

      let refundedCount = 0;
      for (const transaction of staleTransactions) {
        const dbTransaction = await this.dbConnection.transaction();
        
        try {
          // Validate transaction data
          if (!transaction || !transaction.id || !transaction.userId) {
            userLogger.log(`Skipping invalid transaction: ${JSON.stringify(transaction?.id || "unknown")}`);
            await dbTransaction.rollback();
            continue;
          }

          // Refund tokens by updating user balance
          const user = await this.userRepo.getUserById(transaction.userId);
          if (user) {
            const refundAmount = Math.abs(Number(transaction.amount) || 0);
            if (refundAmount > 0) {
              const currentBalance = Number(user.tokens) || 0;
              await user.update({ 
                tokens: currentBalance + refundAmount 
              }, { transaction: dbTransaction });
              
              // Update transaction status
              await transaction.update({
                status: "refunded",
                description: "Auto-refunded stale transaction after 1 hour"
              }, { transaction: dbTransaction });
              
              await dbTransaction.commit();
              refundedCount++;
              
              userLogger.log(`Auto-refunded stale transaction ${transaction.id} for user ${transaction.userId}: ${refundAmount} tokens`);
            } else {
              // Just mark as refunded if amount is 0
              await transaction.update({
                status: "refunded",
                description: "Auto-marked stale transaction as refunded (zero amount)"
              }, { transaction: dbTransaction });
              
              await dbTransaction.commit();
              userLogger.log(`Marked zero-amount stale transaction ${transaction.id} as refunded`);
            }
          } else {
            // If user not found, just mark transaction as refunded
            await transaction.update({
              status: "refunded",
              description: "Auto-refunded stale transaction - user not found"
            }, { transaction: dbTransaction });
            
            await dbTransaction.commit();
            
            userLogger.log(`Marked stale transaction ${transaction.id} as refunded - user not found`);
          }
        } catch (transactionError) {
          await dbTransaction.rollback();
          const err = transactionError instanceof Error ? transactionError : new Error("Unknown transaction error");
          errorLogger.logDatabaseError("CLEANUP_STALE_TRANSACTION", "token_transactions", 
            `Failed to refund transaction ${transaction.id}: ${err.message}`);
        }
      }

      if (refundedCount > 0) {
        userLogger.log(`Cleaned up ${refundedCount} stale pending transactions on startup`);
      }

    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("CLEANUP_STALE", "token_transactions", err.message);
    } finally {
      TokenService.cleanupLock = false;
    }
  }

  // Get user transaction history
  private async retrieveTransactionHistory(
    userId: string,
    maxRecords = 50
  ): Promise<{ success: boolean; transactions?: TokenTransaction[]; error?: string }> {
    try {
      const transactions = await TokenTransaction.findAll({
        where: { userId },
        order: [["createdAt", "DESC"]],
        limit: maxRecords
      });

      return { success: true, transactions };

    } catch (error) {
      const err = error instanceof Error ? error : new Error("Unknown error");
      errorLogger.logDatabaseError("GET_HISTORY", "token_transactions", err.message);
      return { success: false, error: "Failed to retrieve transaction history" };
    }
  }
}
