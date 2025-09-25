// Import the Router from Express to create modular route handlers.
import { Router, Request, Response, NextFunction } from "express";
// Import the controller that contains the logic for user operations.
import { UserController } from "../controllers/userController";
// Import all the necessary middleware functions.
import { 
    validateUserCreation, 
    validateLogin, 
    validateUserUpdate, 
    validateUUIDFormat 
} from "../middleware/userMiddleware";
import { authenticateToken, authorizeUser } from "../middleware/authMiddleware";

// Create a new router instance.
const router = Router();

// Instantiate the user controller.
const userController = new UserController();

//Wrap async controller calls in a function that catches errors, so that a void is returned.
function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
    return (req: Request, res: Response, next: NextFunction) => {
        void Promise.resolve(fn(req, res, next)).catch(next);
    };
}

//This routes use spread syntax to apply multiple middleware functions.

// CREATE - Register a new user.
router.post("/user", ...validateUserCreation, asyncHandler(userController.createUser));

// LOGIN - Authenticate a user and return a token.
router.post("/login", ...validateLogin, asyncHandler(userController.login));

// This routes require the requester to be authenticated (`authenticateToken`).

// READ - Get the profile of the currently authenticated user.
router.get("/profile", ...authenticateToken, asyncHandler(userController.getUser));

// READ - Get current user's token balance
router.get("/tokens", ...authenticateToken, asyncHandler(userController.getUserTokens));

// UPDATE - Update a specific user's data.
router.put("/:userId", validateUUIDFormat, ...authenticateToken, ...authorizeUser, 
    ...validateUserUpdate, asyncHandler(userController.updateUser));

// DELETE - Delete a specific user.
router.delete("/:userId", validateUUIDFormat, ...authenticateToken, ...authorizeUser, asyncHandler(userController.deleteUser));

// Export the router to be mounted in the main application file.
export default router;