// Import the Sequelize User model and the User Data Access Object (DAO).
import { User } from "../models/User";
import { UserDao } from "../dao/userDao";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, UserRouteLogger } from "../factory/loggerFactory";

// Define a simple interface for user data.
export interface UserData {
    name: string;
    surname: string;
    email: string;
    password: string;
}

// UserRepository provides an abstraction layer over UserDao for user-related operations.
export class UserRepository {
    private static instance: UserRepository;
    private readonly userDao: UserDao;
    private readonly logger: UserRouteLogger;

    private constructor() {
        this.userDao = UserDao.getInstance();
        this.logger = loggerFactory.createUserLogger();
    }

    // Get the singleton instance of UserRepository
    public static getInstance(): UserRepository {
        if (!UserRepository.instance) {
            UserRepository.instance = new UserRepository();
        }
        return UserRepository.instance;
    }

    // Creates a new user in the database
    public async createUser(data: UserData): Promise<User> {
        return await this.userDao.create({
            ...data,
            tokens: 100.00,
            role: "user"
        });
    }

    // Validates user login credentials
    public async validateLogin(email: string, password: string): Promise<User | null> {
        return await this.userDao.validateLogin(email, password);
    }

    // Retrieves a user by their ID.
    public async getUserById(id: string): Promise<User | null> {
        return await this.userDao.findById(id);
    }

    // Retrieves a user by their email.
    public async getUserByEmail(email: string): Promise<User | null> {
        return await this.userDao.findByEmail(email);
    }

    // Check if user has admin role
    public async isAdmin(userId: string): Promise<boolean> {
        const user = await this.userDao.findById(userId);
        // If user not found, log and throw error
        if (!user) {
            this.logger.log("User not found during admin check", { userId });
            throw ErrorManager.getInstance().createError(
                ErrorStatus.userNotFoundError,
                `User with ID ${userId} not found`
            );
        }
        // Check if user is admin
        const isAdmin = user.role === "admin";
        this.logger.log("Admin role check completed", { userId, isAdmin });
        
        return isAdmin;
    }

    // Updates an existing user in the database.
    public async updateUser(id: string, data: Partial<UserData>): Promise<User> {
        return await this.userDao.update(id, data);
    }

    // Update user token balance
    public async updateUserTokens(id: string, tokens: number): Promise<User> {       
        return await this.userDao.updateTokens(id, tokens);
    }

    // Deletes a user from the database.
    public async deleteUser(id: string): Promise<boolean> {
        return await this.userDao.delete(id);
    }

    // Checks if a user exists by their email.
    public async emailExists(email: string): Promise<boolean> {
        return await this.userDao.existsByEmail(email);
    }
}