import axios from "axios";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

interface ProcessingRequest {
    userId: string;
    data: Record<string, unknown>;
    parameters: Record<string, unknown>;
}

interface ProcessingResponse {
    success: boolean;
    images?: Array<{ originalPath: string; outputPath: string }>;
    videos?: Array<{ originalVideoId: string; outputPath: string }>;
    error?: string;
}

export class InferenceBlackBoxAdapter {
    private readonly pythonServiceUrl: string;

    constructor() {
        this.pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://python-inference:5000";
        inferenceLogger.log("BlackBox adapter initialized", { serviceUrl: this.pythonServiceUrl });
    }

    async processDataset(
        userId: string, 
        datasetData: Record<string, unknown>, 
        parameters: Record<string, unknown>
    ): Promise<ProcessingResponse> {
        try {
            inferenceLogger.logBlackBoxProcessingStarted(userId);

            const request: ProcessingRequest = {
                userId,
                data: datasetData,
                parameters
            };

            // Make HTTP request to Python service
            const response = await axios.post(
                `${this.pythonServiceUrl}/process-dataset`,
                request,
                {
                    timeout: 300000, // 5 minutes timeout
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );

            if (response.data.success) {
                inferenceLogger.logBlackBoxProcessingCompleted(
                    userId, 
                    response.data.images?.length || 0,
                    response.data.videos?.length || 0
                );
                return response.data;
            } else {
                throw new Error(response.data.error || "Processing failed");
            }
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            inferenceLogger.logBlackBoxProcessingFailed(userId, err.message);
            
            if (axios.isAxiosError(error)) {
                const axiosError = `Python service error: ${error.message}`;
                if (error.response) {
                    errorLogger.logDatabaseError("BLACKBOX_HTTP_ERROR", "python_service", 
                        `Status: ${error.response.status}, Message: ${axiosError}`);
                } else if (error.request) {
                    errorLogger.logDatabaseError("BLACKBOX_NETWORK_ERROR", "python_service", axiosError);
                } else {
                    errorLogger.logDatabaseError("BLACKBOX_REQUEST_ERROR", "python_service", axiosError);
                }
                throw new Error(axiosError);
            }
            
            errorLogger.logDatabaseError("BLACKBOX_PROCESSING", "python_service", err.message);
            throw error;
        }
    }
}
