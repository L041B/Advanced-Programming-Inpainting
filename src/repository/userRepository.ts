// Import the Sequelize User model and the User Data Access Object (DAO).
import { User } from "../models/User";
import { UserDao } from "../dao/userDao";
// Import custom logger utilities.
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";

// Define a simple interface for user data.
export interface UserData {
    name: string;
    surname: string;
    email: string;
    password: string;
    // Remove tokens and role from interface - they should be set automatically
}

// UserRepository provides an abstraction layer over UserDao for user-related operations.
export class UserRepository {
    private static instance: UserRepository;
    private readonly userDao: UserDao;
    private readonly userLogger: UserRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    private constructor() {
        this.userDao = UserDao.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Get the singleton instance of UserRepository.
    public static getInstance(): UserRepository {
        if (!UserRepository.instance) {
            UserRepository.instance = new UserRepository();
        }
        return UserRepository.instance;
    }

    // Creates a new user in the database.
    public async createUser(data: UserData): Promise<User> {
        this.userLogger.log("Creating new user", { 
            email: data.email,
            operation: "CREATE_USER" 
        });

        try {
            const newUser = await this.userDao.create({
                ...data,
                tokens: 100.00, // Ensure 100 tokens default
                role: "user" // Force user role
            });
            this.userLogger.logUserCreation(newUser.id, newUser.email);
            return newUser;
        } catch (error) {
            this.errorLogger.logDatabaseError("CREATE_USER", "users", (error as Error).message);
            throw error;
        }
    }

    // Validates user login credentials.
    public async validateLogin(email: string, password: string): Promise<User | null> {
        this.userLogger.log("Validating user login", { email, operation: "VALIDATE_LOGIN" });

        try {
            const user = await this.userDao.validateLogin(email, password);
            this.userLogger.logUserLogin(email, !!user);
            return user;
        } catch (error) {
            this.errorLogger.logDatabaseError("VALIDATE_LOGIN", "users", (error as Error).message);
            throw error;
        }
    }

    // Retrieves a user by their ID.
    public async getUserById(id: string): Promise<User | null> {
        this.userLogger.log("Retrieving user by ID", { userId: id, operation: "GET_USER_BY_ID" });
        return await this.userDao.findById(id);
    }

    // Retrieves a user by their email.
    public async getUserByEmail(email: string): Promise<User | null> {
        this.userLogger.log("Retrieving user by email", { email, operation: "GET_USER_BY_EMAIL" });
        return await this.userDao.findByEmail(email);
    }

    // Check if user has admin role
    public async isAdmin(userId: string): Promise<boolean> {
        try {
            const user = await this.userDao.findById(userId);
            return user?.role === "admin" || false;
        } catch (error) {
            this.errorLogger.logDatabaseError("CHECK_ADMIN", "users", (error as Error).message);
            return false;
        }
    }

    // Updates an existing user in the database.
    public async updateUser(id: string, data: Partial<UserData>): Promise<User> {
        this.userLogger.log("Updating user", { userId: id, operation: "UPDATE_USER" });

        try {
            const user = await this.userDao.update(id, data);
            const updatedFields = Object.keys(data);
            this.userLogger.logUserUpdate(id, updatedFields);
            return user;
        } catch (error) {
            this.errorLogger.logDatabaseError("UPDATE_USER", "users", (error as Error).message);
            throw error;
        }
    }

    // Update user token balance
    public async updateUserTokens(id: string, tokens: number): Promise<User> {
        this.userLogger.log("Updating user tokens", { userId: id, tokens, operation: "UPDATE_TOKENS" });

        try {
            const user = await this.userDao.updateTokens(id, tokens);
            this.userLogger.logTokenUpdate(id, tokens);
            return user;
        } catch (error) {
            this.errorLogger.logDatabaseError("UPDATE_TOKENS", "users", (error as Error).message);
            throw error;
        }
    }

    // Deletes a user from the database.
    public async deleteUser(id: string): Promise<boolean> {
        this.userLogger.log("Deleting user", { userId: id, operation: "DELETE_USER" });

        try {
            const success = await this.userDao.delete(id);
            if (success) {
                this.userLogger.logUserDeletion(id);
            } else {
                this.errorLogger.logDatabaseError("DELETE_USER", "users", "User not found");
            }
            return success;
        } catch (error) {
            this.errorLogger.logDatabaseError("DELETE_USER", "users", (error as Error).message);
            throw error;
        }
    }

    // Checks if a user exists by their email.
    public async emailExists(email: string): Promise<boolean> {
        return await this.userDao.existsByEmail(email);
    }

}