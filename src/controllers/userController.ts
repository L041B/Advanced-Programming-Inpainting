// Import necessary modules from Node.js, Express, jwt and project files
import { Request, Response } from 'express';
import { UserRepository } from '../repository/userRepository';
import jwt from 'jsonwebtoken';
import { loggerFactory, UserRouteLogger, ApiRouteLogger, ErrorRouteLogger } from '../factory/loggerFactory';

// Define a custom Request interface to provide type safety for the `user` property added by auth middleware.
interface AuthenticatedRequest extends Request {
    user?: {
        userId: string;
        email: string;
    };
}

// Controller responsible for handling all user-related HTTP requests.
export class UserController {
    private readonly userRepository: UserRepository;
    private readonly userLogger: UserRouteLogger;
    private readonly apiLogger: ApiRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    constructor() {
        this.userRepository = UserRepository.getInstance();
        this.userLogger = loggerFactory.createUserLogger();
        this.apiLogger = loggerFactory.createApiLogger();
        this.errorLogger = loggerFactory.createErrorLogger();
    }

    // Handles new user registration.
    public createUser = async (req: Request, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);

        try {
            // Validate that all required fields are present in the request body.
            const { name, surname, email, password } = req.body as { name: string; surname: string; email: string; password: string };
            const user = await this.userRepository.createUser({ name, surname, email, password });

            this.userLogger.logUserCreation(user.id, user.email);

            // Respond with 201 Created for successful resource creation.
            res.status(201).json({
                success: true,
                message: 'User created successfully',
                data: { id: user.id, name: user.name, surname: user.surname, email: user.email }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            // A 400 Bad Request is appropriate if user data is invalid (e.g., duplicate email).
            res.status(400).json({ success: false, message: err.message });
            this.errorLogger.logDatabaseError('CREATE_USER', 'users', err.message);
            this.apiLogger.logError(req, err);
        }
    }

    // Handles user login, validating credentials and issuing a JWT on success.
    public login = async (req: Request, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);

        try {
            const { email, password } = req.body as { email: string; password: string };
            const user = await this.userRepository.validateLogin(email, password);

            if (!user) {
                this.userLogger.logUserLogin(email, false);
                this.errorLogger.logAuthenticationError(email, 'Invalid credentials');
                // Respond with 401 Unauthorized for failed login attempts.
                res.status(401).json({ success: false, message: 'Invalid credentials' });
                return;
            }

            // Ensure the JWT secret is defined in environment variables.
            const secret = process.env.JWT_SECRET;
            if (!secret) {
                this.errorLogger.log('FATAL: JWT_SECRET is not defined in environment variables.', { component: 'UserController' });
                // Do not proceed with login if the server is insecurely configured.
                res.status(500).json({ success: false, message: 'Server security configuration error.' });
                return;
            }

            // Generate a JWT token for the authenticated user.
            const token = jwt.sign(
                { userId: user.id, email: user.email },
                secret,
                { expiresIn: '24h' }
            );

            // Log the successful login.
            this.userLogger.logUserLogin(email, true);
            res.status(200).json({
                success: true,
                message: 'Login successful',
                data: { token, user: { id: user.id, name: user.name, email: user.email } }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('An unexpected error occurred during login');
            res.status(500).json({ success: false, message: err.message });
            this.errorLogger.logDatabaseError('USER_LOGIN', 'users', err.message);
            this.apiLogger.logError(req, err);
        }
    }

    /** Retrieves a user's profile. This method handles two routes:
     * 1. `GET /profile`: Gets the authenticated user's own data.
     * 2. `GET /:userId`: Gets a specific user's data.
     */
    public getUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);

        try {
            // Determine the target user ID from URL params or the authenticated user's token.
            const userId = req.params.userId || (req.user ? req.user.userId : undefined);
            if (!userId) {
                res.status(400).json({ success: false, message: 'User ID not provided' });
                return;
            }
            const user = await this.userRepository.getUserById(userId);

            if (!user) {
                this.errorLogger.logDatabaseError('GET_USER', 'users', 'User not found');
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            // Log the user retrieval action.
            this.userLogger.logUserRetrieval(userId);
            res.status(200).json({
                success: true,
                data: { id: user.id, name: user.name, surname: user.surname, email: user.email }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Error retrieving user');
            res.status(500).json({ success: false, message: err.message });
            this.errorLogger.logDatabaseError('GET_USER', 'users', err.message);
            this.apiLogger.logError(req, err);
        }
    }

    // Updates an existing user's data.
    public updateUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);

        try {
            const userId = req.params.userId;
            const { name, surname, email, password } = req.body as { name: string; surname: string; email: string; password?: string };
            
            const updatedUser = await this.userRepository.updateUser(userId, { name, surname, email, password });

            // Log which fields were part of the update request payload.
            const updatedFields = Object.keys(req.body as Record<string, unknown>).filter(key => ['name', 'surname', 'email', 'password'].includes(key));
            this.userLogger.logUserUpdate(userId, updatedFields);

            res.status(200).json({
                success: true,
                message: 'User updated successfully',
                data: { id: updatedUser.id, name: updatedUser.name, surname: updatedUser.surname, email: updatedUser.email }
            });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Error updating user');
            // A 400 Bad Request is appropriate if the update fails due to invalid data.
            res.status(400).json({ success: false, message: err.message });
            this.errorLogger.logDatabaseError('UPDATE_USER', 'users', err.message);
            this.apiLogger.logError(req, err);
        }
    }

    // Deletes a user from the database.
    public deleteUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        const startTime = Date.now();
        this.apiLogger.logRequest(req);

        try {
            const userId = req.params.userId;
            const deleted = await this.userRepository.deleteUser(userId);

            if (!deleted) {
                this.errorLogger.logDatabaseError('DELETE_USER', 'users', 'User not found');
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            this.userLogger.logUserDeletion(userId);
            res.status(200).json({ success: true, message: 'User deleted successfully' });
            this.apiLogger.logResponse(req, res, Date.now() - startTime);
        } catch (error) {
            const err = error instanceof Error ? error : new Error('Error deleting user');
            res.status(400).json({ success: false, message: err.message });
            this.errorLogger.logDatabaseError('DELETE_USER', 'users', err.message);
            this.apiLogger.logError(req, err);
        }
    }
}