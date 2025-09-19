import { Router } from "express";
import { AdminController } from "../controllers/adminController";
import { authenticateToken } from "../middleware/authMiddleware";
import { TokenMiddleware } from "../middleware/tokenMiddleware";

const router = Router();

// All admin routes require authentication and admin privileges
const adminAuth = [...authenticateToken, TokenMiddleware.validateAdminRole];

// Route for recharging user tokens
router.post("/user-tokens", ...adminAuth, AdminController.rechargeUserTokens);

// Route for getting user token balance and transaction history
router.get("/users/:email/tokens", ...adminAuth, AdminController.getUserTokenInfo);

// Route for getting all transactions with user details (admin only)
router.get("/transactions", ...adminAuth, AdminController.getAllTransactions);

// Route for getting all datasets with user details (admin only)
router.get("/datasets", ...adminAuth, AdminController.getAllDatasets);

export default router;
