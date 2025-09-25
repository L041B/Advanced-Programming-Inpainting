import { Router } from "express";
import { InferenceController } from "../controllers/inferenceController";
import { authenticateToken } from "../middleware/authMiddleware";
import { validateInferenceCreation, validateInferenceAccess } from "../middleware/inferenceMiddleware";

const router = Router();

// Route for creating a new inference on a dataset (simplified - only auth required)
router.post(
  "/",
  ...authenticateToken,
  ...validateInferenceCreation,
  InferenceController.createInference
);

// Route for getting job status by job ID (protected)
router.get("/job/:jobId/status", ...authenticateToken, InferenceController.getJobStatus);

// Route for getting all user inferences (protected)
router.get("/", ...authenticateToken, InferenceController.getUserInferences);

// Route for getting a specific inference by ID (protected)
router.get("/:id", ...authenticateToken, ...validateInferenceAccess, InferenceController.getInference);

// Route for getting inference results with download links (protected)
router.get("/:id/results", ...authenticateToken, ...validateInferenceAccess, InferenceController.getInferenceResults);

// Route for serving inference output files (protected by JWT, no token needed)
router.get("/:id/download/:filename", ...authenticateToken, InferenceController.serveOutputFile);

export default router;

