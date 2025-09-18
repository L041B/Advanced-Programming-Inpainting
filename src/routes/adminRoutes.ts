import { Router } from "express";
import { AdminController } from "../controllers/adminController";
import { authenticateToken } from "../middleware/authMiddleware";
import { TokenMiddleware } from "../middleware/tokenMiddleware";

const router = Router();

// All admin routes require authentication and admin privileges
const adminAuth = [...authenticateToken, TokenMiddleware.validateAdminRole];

// Route for recharging user tokens
router.post("/recharge-tokens", ...adminAuth, AdminController.rechargeUserTokens);

// Route for getting user token balance and transaction history
router.get("/users/:email/tokens", ...adminAuth, AdminController.getUserTokenInfo);

export default router;
