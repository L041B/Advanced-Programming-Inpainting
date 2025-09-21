// import necessary modules and types
import { UserRepository } from "../repository/userRepository";
import { User } from "../models/User";
import { ErrorManager } from "../factory/errorManager";
import { ErrorStatus } from "../factory/status";
import { loggerFactory, UserRouteLogger, ErrorRouteLogger } from "../factory/loggerFactory";
import bcrypt from "bcrypt";

// Service to initialize the admin user at application startup
export class AdminInitService {
    private static readonly userRepository = UserRepository.getInstance();
    private static readonly errorManager = ErrorManager.getInstance();
    private static readonly userLogger: UserRouteLogger = loggerFactory.createUserLogger();
    private static readonly errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

    // Initializes the admin user if not already present
    public static async initializeAdminUser(): Promise<void> {
        try {
            const adminEmail = process.env.ADMIN_EMAIL;
            const adminPassword = process.env.ADMIN_PASSWORD;
            const adminName = process.env.ADMIN_NAME;
            const adminSurname = process.env.ADMIN_SURNAME;

            // Ensure all necessary environment variables are set
            if (!adminEmail || !adminPassword || !adminName || !adminSurname) {
                AdminInitService.userLogger.log("Admin environment variables not found. Skipping admin user creation.", {
                    operation: "INIT_ADMIN_SKIP",
                    reason: "missing_env_vars"
                });
                return;
            }

            // Check if admin user already exists
            const existingAdmin = await AdminInitService.userRepository.getUserByEmail(adminEmail);
            if (existingAdmin) {
                AdminInitService.userLogger.log("Admin user already exists. Skipping creation.", {
                    operation: "INIT_ADMIN_SKIP",
                    reason: "already_exists",
                    adminEmail
                });
                return;
            }

            // Create admin user directly in database 
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            
            // Directly use the User model to bypass repository restrictions
            const adminUser = await User.create({
                name: adminName,
                surname: adminSurname,
                email: adminEmail,
                password: hashedPassword,
                tokens: 10000.00, // Admin gets 10000 tokens
                role: "admin"
            });

            // Log the successful creation
            AdminInitService.userLogger.logUserCreation(adminUser.id, adminEmail);
            AdminInitService.userLogger.log("Admin user initialized successfully", {
                operation: "INIT_ADMIN_SUCCESS",
                adminUserId: adminUser.id,
                adminEmail,
                initialTokens: 10000
            });
            
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            AdminInitService.errorLogger.logDatabaseError("INIT_ADMIN", "users", err.message);
            
            // Re-throw as standardized error
            throw AdminInitService.errorManager.createError(
                ErrorStatus.userCreationFailedError,
                `Failed to initialize admin user: ${err.message}`
            );
        }
    }
}