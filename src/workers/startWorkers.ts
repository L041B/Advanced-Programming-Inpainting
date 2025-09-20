import dotenv from "dotenv";
import { DbConnection } from "../config/database";
import { InferenceWorker } from "./inferenceWorker";
import { loggerFactory, InferenceRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Initialize loggers
const inferenceLogger: InferenceRouteLogger = loggerFactory.createInferenceLogger();
const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

// Load environment variables
dotenv.config();

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

        // Graceful shutdown
        process.on("SIGTERM", async () => {
            inferenceLogger.log("Received SIGTERM, shutting down workers");
            try {
                await DbConnection.close();
                inferenceLogger.log("Workers shut down gracefully");
                process.exit(0);
            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logDatabaseError("GRACEFUL_SHUTDOWN", "workers", err.message);
                process.exit(1);
            }
        });

        process.on("SIGINT", async () => {
            inferenceLogger.log("Received SIGINT, shutting down workers");
            try {
                await DbConnection.close();
                inferenceLogger.log("Workers shut down gracefully");
                process.exit(0);
            } catch (error) {
                const err = error instanceof Error ? error : new Error("Unknown error");
                errorLogger.logDatabaseError("GRACEFUL_SHUTDOWN", "workers", err.message);
                process.exit(1);
            }
        });
        // Handle uncaught exceptions
        process.on("uncaughtException", (error) => {
            errorLogger.logDatabaseError("UNCAUGHT_EXCEPTION", "workers", error.message);
            process.exit(1);
        });

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
