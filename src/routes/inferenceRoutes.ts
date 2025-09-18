import { Router } from "express";
import { InferenceController } from "../controllers/inferenceController";
import { authenticateToken } from "../middleware/authMiddleware";
import { TokenMiddleware } from "../middleware/tokenMiddleware";

const router = Router();

// Route for creating a new inference on a dataset (protected with token validation and cost injection)
router.post(
  "/create",
  ...authenticateToken,
  TokenMiddleware.validateTokenBalance,
  TokenMiddleware.injectTokenCostInResponse,
  InferenceController.createInference,
  TokenMiddleware.finalizeTokenUsage
);

// Route for getting job status by job ID (protected)
router.get("/job/:jobId/status", ...authenticateToken, InferenceController.getJobStatus);

// Route for getting all user inferences (protected)
router.get("/", ...authenticateToken, InferenceController.getUserInferences);

// Route for getting a specific inference by ID (protected)
router.get("/:id", ...authenticateToken, InferenceController.getInference);

// Route for getting inference results with download links (protected)
router.get("/:id/results", ...authenticateToken, InferenceController.getInferenceResults);

// Route for serving inference output files (uses temporary token)
router.get("/output/:token", InferenceController.serveOutputFile);

export default router;
