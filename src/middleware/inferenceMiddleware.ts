import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import { DatasetRepository } from "../repository/datasetRepository";
import jwt from "jsonwebtoken";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

interface CreateInferenceData {
    datasetName: string;
    modelId?: string;
    parameters?: Record<string, unknown>;
}

export class InferenceMiddleware {
    private static readonly datasetRepository = DatasetRepository.getInstance();

    // Validate input data for creating inference
    static async validateCreateInference(
        userId: string, 
        data: CreateInferenceData
    ): Promise<{ success: boolean; error?: string; dataset?: { id: string; name: string; data: unknown } }> {
        try {
            const { datasetName } = data;

            // Check 1: Dataset name is required
            if (!datasetName) {
                errorLogger.logValidationError("datasetName", datasetName, "Dataset name is required");
                return { success: false, error: "Dataset name is required" };
            }

            // Check 2: Dataset exists and belongs to user
            const dataset = await InferenceMiddleware.datasetRepository.getDatasetByUserIdAndName(userId, datasetName);

            if (!dataset) {
                errorLogger.logDatabaseError("VALIDATE_INFERENCE", "datasets", "Dataset not found");
                return { success: false, error: "Dataset not found" };
            }

            // Check 3: Dataset has data
            const datasetData = dataset.data as { pairs?: Array<{ input: string; output: string }>; type?: string } | null;
            if (!(datasetData?.pairs?.length)) {
                errorLogger.logValidationError("datasetData", datasetName, "Dataset is empty");
                return { success: false, error: "Dataset is empty" };
            }

            inferenceLogger.log("Inference validation successful", { 
                userId, 
                datasetName,
                datasetId: dataset.id, // Include dataset ID in logs
                pairCount: datasetData.pairs.length,
                modelId: data.modelId 
            });

            return { 
                success: true, 
                dataset: { 
                    id: dataset.id, 
                    name: dataset.name, 
                    data: dataset.data 
                }
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VALIDATE_CREATE_INFERENCE", "datasets", err.message);
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
                const errorMessage = jwtError instanceof Error ? jwtError.message : "File token verification failed";
                errorLogger.logAuthenticationError(undefined, errorMessage);
                return { success: false, error: "Invalid or expired file token" };
            }

            const { userId, filePath } = decoded;

            // Security check: ensure the path belongs to the user (same as controller)
            if (!filePath.startsWith(`inferences/${userId}/`)) {
                errorLogger.logAuthorizationError(userId, filePath);
                return { success: false, error: "Access denied" };
            }

            inferenceLogger.log("File token validated successfully", { userId, filePath });

            return {
                success: true,
                userId,
                filePath
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("VALIDATE_FILE_TOKEN", "token_validation", err.message);
            return { success: false, error: "Token validation failed" };
        }
    }
}
