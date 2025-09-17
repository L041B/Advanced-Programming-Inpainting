import dotenv from "dotenv";
import { DbConnection } from "../config/database";
import { InferenceWorker } from "./inferenceWorker";
import logger from "../utils/logger";

// Load environment variables
dotenv.config();

async function startWorkers() {
    try {
        // Connect to database
        await DbConnection.connect();
        logger.info("Database connected for workers");

        // Start inference worker
        const inferenceWorker = InferenceWorker.getInstance();
        inferenceWorker.start();

        logger.info("All workers started successfully");

        // Graceful shutdown
        process.on("SIGTERM", async () => {
            logger.info("Received SIGTERM, shutting down workers...");
            await inferenceWorker.stop();
            await DbConnection.close();
            process.exit(0);
        });

        process.on("SIGINT", async () => {
            logger.info("Received SIGINT, shutting down workers...");
            await inferenceWorker.stop();
            await DbConnection.close();
            process.exit(0);
        });

    } catch (error) {
        logger.error("Failed to start workers", { 
            error: error instanceof Error ? error.message : "Unknown error" 
        });
        process.exit(1);
    }
}

// Start workers if this file is run directly
if (require.main === module) {
    startWorkers();
}

export { startWorkers };
