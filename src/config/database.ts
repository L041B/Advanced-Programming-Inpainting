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
            logger.info("Connecting to database...");

            // Set environment variables as PostgreSQL settings for admin creation
            if (process.env.ADMIN_NAME) {
                await DbConnection.getSequelizeInstance().query(`SET app.admin_name = '${process.env.ADMIN_NAME}'`);
            }
            if (process.env.ADMIN_SURNAME) {
                await DbConnection.getSequelizeInstance().query(`SET app.admin_surname = '${process.env.ADMIN_SURNAME}'`);
            }
            if (process.env.ADMIN_EMAIL) {
                await DbConnection.getSequelizeInstance().query(`SET app.admin_email = '${process.env.ADMIN_EMAIL}'`);
            }
            if (process.env.ADMIN_PASSWORD_HASH) {
                await DbConnection.getSequelizeInstance().query(`SET app.admin_password_hash = '${process.env.ADMIN_PASSWORD_HASH}'`);
            }

            await DbConnection.getSequelizeInstance().authenticate();
            await DbConnection.getSequelizeInstance().sync({ alter: true });
            logger.info("Database connected and synchronized successfully");
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown database error");
            logger.error("Unable to connect to database:", { error: err.message, stack: err.stack });
            throw error;
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