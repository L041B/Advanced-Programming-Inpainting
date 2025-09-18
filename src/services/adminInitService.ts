import { UserRepository } from "../repository/userRepository";
import { User } from "../models/User";
import { loggerFactory, ErrorRouteLogger } from "../factory/loggerFactory";
import bcrypt from "bcrypt";

const errorLogger: ErrorRouteLogger = loggerFactory.createErrorLogger();

export class AdminInitService {
    private static userRepository = UserRepository.getInstance();

    public static async initializeAdminUser(): Promise<void> {
        try {
            const adminEmail = process.env.ADMIN_EMAIL;
            const adminPassword = process.env.ADMIN_PASSWORD;
            const adminName = process.env.ADMIN_NAME;
            const adminSurname = process.env.ADMIN_SURNAME;

            if (!adminEmail || !adminPassword || !adminName || !adminSurname) {
                console.warn("Admin environment variables not found. Skipping admin user creation.");
                return;
            }

            // Check if admin user already exists
            const existingAdmin = await AdminInitService.userRepository.getUserByEmail(adminEmail);
            if (existingAdmin) {
                console.log("Admin user already exists. Skipping creation.");
                return;
            }

            // Create admin user directly in database (bypassing repository restrictions)
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            
            const adminUser = await User.create({
                name: adminName,
                surname: adminSurname,
                email: adminEmail,
                password: hashedPassword,
                tokens: 1000.00, // Admin gets 1000 tokens
                role: "admin"
            });

            console.log(`Admin user created successfully with email: ${adminEmail}`);
            console.log(`Admin user ID: ${adminUser.id}`);
            
        } catch (error) {
            const err = error instanceof Error ? error : new Error("Unknown error");
            errorLogger.logDatabaseError("INIT_ADMIN", "users", err.message);
            console.error("Failed to initialize admin user:", err.message);
        }
    }
}