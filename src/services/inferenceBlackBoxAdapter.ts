import axios from "axios";
import logger from "../utils/logger";

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
    }

    async processDataset(
        userId: string, 
        datasetData: Record<string, unknown>, 
        parameters: Record<string, unknown>
    ): Promise<ProcessingResponse> {
        try {
            logger.info("Starting dataset processing", { userId });

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
                logger.info("Dataset processing completed successfully", { 
                    userId, 
                    imageCount: response.data.images?.length || 0,
                    videoCount: response.data.videos?.length || 0
                });
                return response.data;
            } else {
                throw new Error(response.data.error || "Processing failed");
            }
        } catch (error) {
            logger.error("Dataset processing failed", { 
                userId, 
                error: error instanceof Error ? error.message : "Unknown error" 
            });
            
            if (axios.isAxiosError(error)) {
                throw new Error(`Python service error: ${error.message}`);
            }
            
            throw error;
        }
    }
}
