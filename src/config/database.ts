// Import necessary modules
import { Sequelize } from "sequelize";
import logger from "../utils/logger";

// A configuration function to centralize environment variable checks.
function getDatabaseConfig() {
    // Ensure all required environment variables are set.
    const requiredEnvVars = ["DB_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DB_PORT"];
    for (const v of requiredEnvVars) {
        if (!process.env[v]) {
            throw new Error(`FATAL: Missing required environment variable: ${v}`);
        }
    }

    return {
        dialect: "postgres" as const,
        host: process.env.DB_HOST!,
        port: parseInt(process.env.DB_PORT!),
        username: process.env.POSTGRES_USER!,
        password: process.env.POSTGRES_PASSWORD!,
        database: process.env.POSTGRES_DB!,
        logging: process.env.NODE_ENV === "development" 
            ? (sql: string) => logger.debug("Database Query", { sql }) 
            : false,
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    };
}

// Database connection manager
export class DbConnection {
    private static instance: DbConnection | null = null;
    public readonly sequelize: Sequelize;
    private readonly config: ReturnType<typeof getDatabaseConfig>;

    // The private constructor is key to the Singleton pattern.
    private constructor() {
        this.config = getDatabaseConfig();
        this.sequelize = new Sequelize(this.config);
    }

    // Gets the existing instance or creates one if it doesn't exist.
    private static getInstance(): DbConnection {
        DbConnection.instance ??= new DbConnection();
        return DbConnection.instance;
    }

    // Provides public access to the raw Sequelize instance for other parts of the application.
    public static getSequelizeInstance(): Sequelize {
        return DbConnection.getInstance().sequelize;
    }

    // Establishes and authenticates the database connection.
    public static async connect(): Promise<void> {
        try {
            const connection = DbConnection.getInstance();
            await connection.sequelize.authenticate();

            // Log the successful connection details.
            logger.info("Database connection established successfully.", {
                database: connection.config.database,
                host: connection.config.host,
                port: connection.config.port
            });
        } catch (error) {
            // Log the error details.
            const err = error instanceof Error ? error : new Error("Unknown database error");
            logger.error("CRITICAL: Unable to connect to the database.", { errorMessage: err.message });
            throw err;
        }
    }

    // Synchronizes all defined models with the database.
    public static async sync(): Promise<void> {
        try {
            await DbConnection.getInstance().sequelize.sync();
            logger.info("Database synchronized successfully.");
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown sync error");
            logger.error("Database synchronization failed.", { errorMessage: err.message });
            throw err;
        }
    }

    // Closes the database connection.
    public static async close(): Promise<void> {
        const instance = DbConnection.instance;
        if (instance) {
            await instance.sequelize.close();
            DbConnection.instance = null;
            logger.info("Database connection closed.");
        }
    }
}