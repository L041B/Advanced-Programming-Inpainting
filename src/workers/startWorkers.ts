// import necessary modules and configurations
import dotenv from "dotenv";
import { DbConnection } from "../config/database";
import { InferenceWorker } from "./inferenceWorker";
import { InferenceQueue } from "../queue/inferenceQueue";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Load environment variables
dotenv.config();

// Main function to start all workers
async function startWorkers() {
    try {
        inferenceLogger.log("Starting worker initialization");

        // Connect to database
        await DbConnection.connect();
        inferenceLogger.log("Database connected for workers");

        // Start inference worker
        const inferenceWorker = InferenceWorker.getInstance();
        inferenceWorker.start();

        inferenceLogger.log("All workers started successfully");

        // Graceful shutdown function
        const gracefulShutdown = async (signal: string) => {
            inferenceLogger.log(`Received ${signal}, shutting down workers gracefully`);
            try {
                // Close the queue to stop accepting new jobs and wait for current jobs to finish
                await InferenceQueue.getInstance().close();
                inferenceLogger.log("Inference queue closed successfully");

                // Close the database connection
                await DbConnection.close();
                inferenceLogger.log("Database connection closed successfully");
                
                // Log successful shutdown
                inferenceLogger.log("Workers shut down gracefully");
                process.exit(0);
            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logDatabaseError("GRACEFUL_SHUTDOWN", "workers", err.message);
                process.exit(1);
            }
        };

        // Handle graceful shutdown signals
        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
        process.on("SIGINT", () => gracefulShutdown("SIGINT"));

        // Handle uncaught exceptions
        process.on("uncaughtException", (error) => {
            errorLogger.logDatabaseError("UNCAUGHT_EXCEPTION", "workers", error.message);
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on("unhandledRejection", (reason) => {
            const errorMessage = reason instanceof Error ? reason.message : String(reason);
            errorLogger.logDatabaseError("UNHANDLED_REJECTION", "workers", errorMessage);
            process.exit(1);
        });

    } catch (error) {
        const err = error instanceof Error ? error : new Error("Unknown error");
        errorLogger.logDatabaseError("START_WORKERS", "workers", err.message);
        process.exit(1);
    }
}

// Start workers if this file is run directly
if (require.main === module) {
    startWorkers();
}

export { startWorkers };
