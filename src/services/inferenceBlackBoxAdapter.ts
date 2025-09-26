// Adapter to interact with the Python-based black-box inference service
import axios from "axios"; // HTTP client for making requests
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";


// Define interfaces for request and response payloads
interface ProcessingRequest {
    userId: string;
    data: Record<string, unknown>;
    parameters: Record<string, unknown>;
}

// Response from the Python service
interface ProcessingResponse {
    success: boolean;
    images?: Array<{ originalPath: string; outputPath: string }>;
    videos?: Array<{ originalVideoId: string; outputPath: string }>;
    error?: string;
}

// InferenceBlackBoxAdapter provides an abstraction layer to communicate with the external Python service.
export class InferenceBlackBoxAdapter {
    private static instance: InferenceBlackBoxAdapter;
    private readonly pythonServiceUrl: string;
    private readonly errorManager: ErrorManager;
    private readonly inferenceLogger: InferenceRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://python-inference:5000";
        this.errorManager = ErrorManager.getInstance();
        this.inferenceLogger = loggerFactory.createInferenceLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
        
        this.inferenceLogger.log("BlackBox adapter initialized", { serviceUrl: this.pythonServiceUrl });
    }

    // Provides access to the single instance of InferenceBlackBoxAdapter.
    public static getInstance(): InferenceBlackBoxAdapter {
        if (!InferenceBlackBoxAdapter.instance) {
            InferenceBlackBoxAdapter.instance = new InferenceBlackBoxAdapter();
        }
        return InferenceBlackBoxAdapter.instance;
    }

    // Sends data to the Python service for processing and handles the response.
    async processDataset(
        userId: string, 
        datasetData: Record<string, unknown>, 
        parameters: Record<string, unknown>
    ): Promise<ProcessingResponse> {
        try {
            this.inferenceLogger.logBlackBoxProcessingStarted(userId);

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

            // Handle response
            if (response.data.success) {
                this.inferenceLogger.logBlackBoxProcessingCompleted(
                    userId, 
                    response.data.images?.length || 0,
                    response.data.videos?.length || 0
                );
                return response.data;
            } else {
                const errorMessage = response.data.error || "Processing failed";
                this.inferenceLogger.logBlackBoxProcessingFailed(userId, errorMessage);
                throw this.errorManager.createError(ErrorStatus.inferenceProcessingFailedError, errorMessage);
            }
        } catch (error) {
            // Handle standardized errors 
            if (error instanceof Error && "errorType" in error) {
                throw error;
            }

            // Log and wrap other errors
            const err = error instanceof Error ? error : new Error("Unknown error");
            this.inferenceLogger.logBlackBoxProcessingFailed(userId, err.message);
            
            // Handle Axios errors
            if (axios.isAxiosError(error)) {
                let axiosError: string;
                let errorType: ErrorStatus;

                // Differentiate between response errors and network errors
                if (error.response) {
                    // Server responded with error status
                    axiosError = `Python service HTTP error: Status ${error.response.status} - ${error.message}`;
                    errorType = ErrorStatus.externalServiceError;
                    this.errorLogger.logDatabaseError("BLACKBOX_HTTP_ERROR", "python_service", 
                        `Status: ${error.response.status}, Message: ${error.message}`);
                } else if (error.request) {
                    // Request was made but no response received (network error, timeout, etc.)
                    axiosError = `Python service network error: ${error.message}`;
                    errorType = ErrorStatus.externalServiceError;
                    this.errorLogger.logDatabaseError("BLACKBOX_NETWORK_ERROR", "python_service", error.message);
                } else {
                    // Something else happened in setting up the request
                    axiosError = `Python service request setup error: ${error.message}`;
                    errorType = ErrorStatus.externalServiceError;
                    this.errorLogger.logDatabaseError("BLACKBOX_REQUEST_ERROR", "python_service", error.message);
                }
                
                throw this.errorManager.createError(errorType, axiosError);
            }
            
            // Handle any other unexpected errors
            this.errorLogger.logDatabaseError("BLACKBOX_PROCESSING", "python_service", err.message);
            throw this.errorManager.createError(ErrorStatus.inferenceProcessingFailedError, err.message);
        }
    }
}
