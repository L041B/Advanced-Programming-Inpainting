// Import necessary modules and models
import { User } from "../models/User";
import { Sequelize } from "sequelize";
import { DbConnection } from "../config/database";
import bcrypt from "bcrypt";

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

    private constructor() {
        this.sequelize = DbConnection.getSequelizeInstance();
    }

    public static getInstance(): UserDao {
        if (!UserDao.instance) {
            UserDao.instance = new UserDao();
        }
        return UserDao.instance;
    }

    // Creates a new user in the database.
    public async create(userData: Required<UserMutationData>): Promise<User> {
        return await this.sequelize.transaction(async (t) => {
            const existingUser = await User.findOne({ where: { email: userData.email }, transaction: t });
            if (existingUser) {
                throw new Error("User with this email already exists");
            }

            const hashedPassword = await bcrypt.hash(userData.password, 10);

            return await User.create({
                ...userData,
                password: hashedPassword,
                tokens: 100.00, // Force 100 tokens for all new users
                role: "user" // Force user role for all new user creations
            }, { transaction: t });
        });
    }

    // Updates an existing user's data.
    public async update(id: string, userData: Partial<UserMutationData>): Promise<User> {
        return await this.sequelize.transaction(async (t) => {
            const user = await User.findByPk(id, { transaction: t });
            if (!user) {
                throw new Error("User not found");
            }

            // If the email is being changed, check if the new email is already taken.
            if (userData.email && userData.email !== user.email) {
                const existingUser = await User.findOne({ where: { email: userData.email }, transaction: t });
                if (existingUser) {
                    throw new Error("Email already in use by another account");
                }
            }

            // If a new password is provided, hash it before updating.
            if (userData.password) {
                userData.password = await bcrypt.hash(userData.password, 10);
            }

            // Update the user instance with the new data.
            await user.update(userData, { transaction: t });
            return user;
        });
    }

    // Deletes a user from the database after verifying their existence.
    public async delete(id: string): Promise<boolean> {
        return await this.sequelize.transaction(async (t) => {
            const user = await User.findByPk(id, { transaction: t });
            if (!user) {
                throw new Error("User not found");
            }
            await user.destroy({ transaction: t });
            return true;
        });
    }

    // Finds a user by their ID.
    public async findById(id: string): Promise<User | null> {
        return await User.findByPk(id, {
            attributes: { exclude: ["password"] }
        });
    }

    // Finds a user by their email address.
    public async findByEmail(email: string): Promise<User | null> {
        return await User.findOne({ where: { email } });
    }
    
    // Checks if a user exists by their email address.
    public async existsByEmail(email: string): Promise<boolean> {
        const user = await User.findOne({ where: { email }, attributes: ["id"] });
        return !!user;
    }

    // Validates user login credentials by finding the user and comparing the password hash.
    public async validateLogin(email: string, password: string): Promise<User | null> {
        const user = await this.findByEmail(email);
        if (!user) {
            return null; 
        }

        // Compares the provided password with the stored hashed password.
        const isValid = await bcrypt.compare(password, user.password);
        return isValid ? user : null; 
    }

    // Update user tokens
    public async updateTokens(id: string, tokens: number): Promise<User> {
        return await this.sequelize.transaction(async (t) => {
            const user = await User.findByPk(id, { transaction: t });
            if (!user) {
                throw new Error("User not found");
            }

            await user.update({ tokens }, { transaction: t });
            return user;
        });
    }

    // Find user by email (including password for admin operations)
    public async findByEmailWithPassword(email: string): Promise<User | null> {
        return await User.findOne({ where: { email } });
    }
}