// Import necessary modules and models
import { User } from "../models/User";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";
import bcrypt from "bcrypt";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Define a interface for user data used in mutations.
interface UserMutationData {
    name: string;
    surname: string;
    email: string;
    password?: string; 
    tokens?: number;
    role?: "user" | "admin";
}

/** A Data Access Object (DAO) for the User model.
 * It abstracts all database interactions for users into a clean, reusable, and testable interface.
 * Implemented as a Singleton to ensure a single, shared instance throughout the application.
 */
export class UserDao {
    private static instance: UserDao;
    private readonly sequelize: Sequelize;
    private readonly errorManager: ErrorManager;
    private readonly userLogger: UserRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    // Private constructor to enforce Singleton pattern.
    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
        this.errorManager = ErrorManager.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Provides access to the single instance of UserDao.
    public static getInstance(): UserDao {
        if (!UserDao.instance) {
            UserDao.instance = new UserDao();
        }
        return UserDao.instance;
    }

    // Creates a new user in the database.
    public async create(userData: Required<UserMutationData>): Promise<User> {
        return await this.sequelize.transaction(async (t) => {
            try {
                const existingUser = await User.findOne({ where: { email: userData.email }, transaction: t });
                if (existingUser) {
                    this.errorLogger.logValidationError("email", userData.email, "User with this email already exists");
                    throw this.errorManager.createError(ErrorStatus.userAlreadyExistsError);
                }

                // Hash the password before saving
                const hashedPassword = await bcrypt.hash(userData.password, 10);

                // Create the user with hashed password
                const user = await User.create({
                    ...userData,
                    password: hashedPassword,
                    tokens: 100.00,
                    role: "user"
                }, { transaction: t });

                return user;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                if (error instanceof Error && error.message.includes("hash")) {
                    this.errorLogger.logDatabaseError("password_hashing", "User", error.message);
                    throw this.errorManager.createError(ErrorStatus.passwordHashingFailedError);
                }
                this.errorLogger.logDatabaseError("create", "User", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.userCreationFailedError);
            }
        });
    }

    // Updates an existing user's data.
    public async update(id: string, userData: Partial<UserMutationData>): Promise<User> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Find the user by primary key
                const user = await User.findByPk(id, { transaction: t });
                if (!user) {
                    this.errorLogger.logDatabaseError("findByPk", "User", `User not found: ${id}`);
                    throw this.errorManager.createError(ErrorStatus.userNotFoundError);
                }

                // If email is being updated, check for uniqueness
                if (userData.email && userData.email !== user.email) {
                    // Check if the new email is already in use
                    const existingUser = await User.findOne({ where: { email: userData.email }, transaction: t });
                    if (existingUser) {
                        this.errorLogger.logValidationError("email", userData.email, "Email already in use by another account");
                        throw this.errorManager.createError(ErrorStatus.userAlreadyExistsError, "Email already in use by another account");
                    }
                }

                // If password is being updated, hash the new password
                if (userData.password) {
                    userData.password = await bcrypt.hash(userData.password, 10);
                }

                // Update the user with new data
                await user.update(userData, { transaction: t });
                return user;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                if (error instanceof Error && error.message.includes("hash")) {
                    this.errorLogger.logDatabaseError("password_hashing", "User", error.message);
                    throw this.errorManager.createError(ErrorStatus.passwordHashingFailedError);
                }
                this.errorLogger.logDatabaseError("update", "User", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.userUpdateFailedError);
            }
        });
    }

    // Deletes a user from the database after verifying their existence.
    public async delete(id: string): Promise<boolean> {
        return await this.sequelize.transaction(async (t) => {
            try {
                // Find the user by primary key
                const user = await User.findByPk(id, { transaction: t });
                // If user does not exist, log and throw an error
                if (!user) {
                    this.errorLogger.logDatabaseError("findByPk", "User", `User not found: ${id}`);
                    throw this.errorManager.createError(ErrorStatus.userNotFoundError);
                }
                await user.destroy({ transaction: t });
                return true;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                this.errorLogger.logDatabaseError("delete", "User", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.userDeletionFailedError);
            }
        });
    }

    // Finds a user by their ID.
    public async findById(id: string): Promise<User | null> {
        try {
            const user = await User.findByPk(id, {
                attributes: { exclude: ["password"] }
            });
            
            return user;
        } catch (error) {
            this.errorLogger.logDatabaseError("findById", "User", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Finds a user by their email address.
    public async findByEmail(email: string): Promise<User | null> {
        try {
            return await User.findOne({ where: { email } });
        } catch (error) {
            this.errorLogger.logDatabaseError("findByEmail", "User", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
    
    // Checks if a user exists by their email address.
    public async existsByEmail(email: string): Promise<boolean> {
        try {
            const user = await User.findOne({ where: { email }, attributes: ["id"] });
            return !!user;
        } catch (error) {
            this.errorLogger.logDatabaseError("existsByEmail", "User", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Validates user login credentials by finding the user and comparing the password hash.
    public async validateLogin(email: string, password: string): Promise<User | null> {
        try {
            const user = await this.findByEmail(email);
            if (!user) {
                return null; 
            }

            // Compare the provided password with the stored hash
            const isValid = await bcrypt.compare(password, user.password);
            const result = isValid ? user : null;
            
            return result;
        } catch (error) {
            this.errorLogger.logDatabaseError("validateLogin", "User", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }

    // Update user tokens
    public async updateTokens(id: string, tokens: number): Promise<User> {
        return await this.sequelize.transaction(async (t) => {
            try {
                const user = await User.findByPk(id, { transaction: t });
                if (!user) {
                    this.errorLogger.logDatabaseError("findByPk", "User", `User not found: ${id}`);
                    throw this.errorManager.createError(ErrorStatus.userNotFoundError);
                }

                await user.update({ tokens }, { transaction: t });
                return user;
            } catch (error) {
                if (error instanceof Error && "errorType" in error) {
                    throw error;
                }
                this.errorLogger.logDatabaseError("updateTokens", "User", (error as Error).message);
                throw this.errorManager.createError(ErrorStatus.userUpdateFailedError);
            }
        });
    }

    // Find user by email 
    public async findByEmailWithPassword(email: string): Promise<User | null> {
        try {
            return await User.findOne({ where: { email } });
        } catch (error) {
            this.errorLogger.logDatabaseError("findByEmailWithPassword", "User", (error as Error).message);
            throw this.errorManager.createError(ErrorStatus.readInternalServerError);
        }
    }
}