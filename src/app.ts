import express from "express"; // Framework for building the web server.
import cors from "cors";       // Middleware to enable Cross-Origin Resource Sharing.
import helmet from "helmet";     // Middleware to help secure the app by setting various HTTP headers.
import dotenv from "dotenv";     // Module to load environment variables from a .env file.
import path from "path";       // Node.js module for working with file and directory paths.
import fs from "fs";           // Node.js module for interacting with the file system.

import { DbConnection } from "./config/database"; // The database connection handler.
import userRoutes from "./routes/userRoutes";         // Router for user-related endpoints.
import appRoutes from "./routes/appRoutes";         // Router for application-level endpoints.
import datasetRoutes from "./routes/datasetRoutes";
import inferenceRoutes from "./routes/inferenceRoutes";
import adminRoutes from "./routes/adminRoutes";     // Router for admin endpoints
import logger from "./utils/logger";                  // A custom logger utility for structured logging.
import { routeNotFoundHandler, errorHandlingChain } from "./middleware/errorHandler";  // Error handling middleware
import { FileStorage } from "./utils/fileStorage";

// Import all models and their associations
import "./models";

import { AdminInitService } from "./services/adminInitService";

dotenv.config();

// Initialize the Express application.
const app = express();
// Define the port the server will run on.
const PORT = process.env.PORT || 3000;

// Use Helmet to set security-related HTTP response headers to protect against common vulnerabilities.
app.use(helmet());

// Use CORS to allow cross-origin requests.
app.use(cors());

// Middleware to parse incoming JSON payloads.
app.use(express.json({ limit: "10mb" }));

// Middleware to parse incoming URL-encoded payloads.
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Define the absolute path to the 'uploads' directory.
const uploadsDir = path.join(__dirname, "../uploads");

// Check if the 'uploads' directory exists. If not, create it.
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true }); // 'recursive: true' allows creating parent directories if they don't exist.
    logger.info("Created uploads directory", { directory: uploadsDir });
}

// Mount the application-level routes.
app.use("/", appRoutes);
// Mount the user-related routes under the '/api/users' path.
app.use("/api/users", userRoutes); 

app.use("/api/datasets", datasetRoutes);
app.use("/api/inferences", inferenceRoutes);
app.use("/api/admin", adminRoutes);              // Mount admin routes

// Mount the error handler
app.use(routeNotFoundHandler);

// Mount the error handling middleware chain.
app.use(...errorHandlingChain);

// Initialize database connection, file storage, and admin user
Promise.all([
    DbConnection.connect(),
    FileStorage.init()
])
    .then(async () => {
        logger.info("Database connected and file storage initialized successfully");
        
        // Initialize admin user from environment variables
        await AdminInitService.initializeAdminUser();
        
        // Start the Express server only after all initialization is complete
        app.listen(PORT, () => {
            logger.info("Server started successfully", {
                port: PORT,
                healthCheckUrl: `http://localhost:${PORT}/health`,
                apiBaseUrl: `http://localhost:${PORT}/api`,
                uploadsDirectory: uploadsDir
            });
        });
    })
    .catch((error) => {
        // This block executes if initialization fails
        const err = error instanceof Error ? error : new Error("Unknown initialization error");
        logger.error("Failed to initialize application - Application will exit", {
            errorMessage: err.message,
            stack: err.stack
        });
        // Exit the process with a non-zero exit code to indicate failure.
        process.exit(1);
    });

export default app; // Export the Express app instance for testing or further configuration.