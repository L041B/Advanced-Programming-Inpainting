// Import the Router from Express to create modular route handlers.
import { Router } from 'express';
// Import the controller that contains the logic for user operations.
import { UserController } from '../controllers/userController';
// Import all the necessary middleware functions.
import { 
    validateUserCreation, 
    validateLogin, 
    validateUserUpdate, 
    validateUUIDFormat 
} from '../middleware/userMiddleware';
import { authenticateToken, authorizeUser } from '../middleware/authMiddleware';

// Create a new router instance.
const router = Router();

// Instantiate the user controller.
const userController = new UserController();

//This routes use spread syntax to apply multiple middleware functions.

// CREATE - Register a new user.
router.post('/register', ...validateUserCreation, userController.createUser);

// LOGIN - Authenticate a user and return a token.
router.post('/login', ...validateLogin, userController.login);

// This routes require the requester to be authenticated (`authenticateToken`).

// READ - Get the profile of the currently authenticated user.
router.get('/profile', ...authenticateToken, userController.getUser);

// UPDATE - Update a specific user's data.
router.put('/:userId', validateUUIDFormat, ...authenticateToken, ...authorizeUser, 
    ...validateUserUpdate, userController.updateUser);

// DELETE - Delete a specific user.
router.delete('/:userId', validateUUIDFormat, ...authenticateToken, ...authorizeUser, userController.deleteUser);

// Export the router to be mounted in the main application file.
export default router;