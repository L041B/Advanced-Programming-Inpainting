import logger from "../utils/logger";
import { DatasetRepository } from "../repository/datasetRepository";
import jwt from "jsonwebtoken";

interface CreateInferenceData {
    datasetName: string;
    modelId?: string;
    parameters?: Record<string, unknown>;
}

export class InferenceMiddleware {
    private static datasetRepository = DatasetRepository.getInstance();

    // Validate input data for creating inference
    static async validateCreateInference(
        userId: string, 
        data: CreateInferenceData
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const { datasetName } = data;

            // Check 1: Dataset name is required (same as controller)
            if (!datasetName) {
                return { success: false, error: "Dataset name is required" };
            }

            // Check 2: Dataset exists and belongs to user (same as controller)
            const dataset = await InferenceMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                return { success: false, error: "Dataset not found" };
            }

            // Check 3: Dataset has data (same as controller)
            const datasetData = dataset.data as { pairs?: Array<{ input: string; output: string }>; type?: string } | null;
            if (!datasetData || !datasetData.pairs || datasetData.pairs.length === 0) {
                return { success: false, error: "Dataset is empty" };
            }

            return { success: true };
        } catch (error) {
            logger.error("Error validating inference input", { 
                userId,
                error: error instanceof Error ? error.message : "Unknown error" 
            });
            return { success: false, error: "Failed to validate inference data" };
        }
    }

    // Validate file token (same logic as controller)
    static async validateFileToken(token: string): Promise<{ success: boolean; userId?: string; filePath?: string; error?: string }> {
        try {
            let decoded: { userId: string; filePath: string; type: string };
            try {
                const verifyResult = jwt.verify(token, process.env.JWT_SECRET || "fallback_secret");
                decoded = verifyResult as { userId: string; filePath: string; type: string };
            } catch (jwtError) {
                return { success: false, error: "Invalid or expired file token" };
            }

            const { userId, filePath } = decoded;

            // Security check: ensure the path belongs to the user (same as controller)
            if (!filePath.startsWith(`inferences/${userId}/`)) {
                return { success: false, error: "Access denied" };
            }

            return {
                success: true,
                userId,
                filePath
            };
        } catch (error) {
            logger.error("Error validating file token", { 
                error: error instanceof Error ? error.message : "Unknown error" 
            });
            return { success: false, error: "Token validation failed" };
        }
    }
}
       