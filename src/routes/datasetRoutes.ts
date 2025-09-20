import { Router } from "express";
import { DatasetController } from "../controllers/datasetController";
import { authenticateToken } from "../middleware/authMiddleware";
import { TokenMiddleware } from "../middleware/tokenMiddleware";
import { DatasetMiddleware } from "../middleware/datasetMiddleware";

const router = Router();

// Route for creating an empty dataset (protected)
router.post("/empty-dataset", ...authenticateToken, DatasetController.createEmptyDataset);

// Route for uploading data to dataset (protected with token validation and cost injection)
router.post("/data", 
    ...authenticateToken,
    TokenMiddleware.validateTokenBalance,
    TokenMiddleware.injectTokenCostInResponse,
    DatasetMiddleware.fileUploadHandler.fields([
        { name: "image", maxCount: 1 },
        { name: "mask", maxCount: 1 }
    ]), 
    DatasetController.uploadDataToDataset,
    TokenMiddleware.finalizeTokenUsage
);

// Route for getting all user datasets (protected)
router.get("/", ...authenticateToken, DatasetController.getUserDatasets);

// Route for getting a specific dataset by name (protected)
router.get("/:name", ...authenticateToken, DatasetController.getDataset);

// Route for getting dataset contents/data with image URLs (protected)
router.get("/:name/data", ...authenticateToken, DatasetController.getDatasetData);

// Route for serving individual images from dataset (uses temporary token, no auth required)
router.get("/image/:imagePath", DatasetController.serveImage);

// Route for deleting a dataset (protected)
router.delete("/:name", ...authenticateToken, DatasetController.deleteDataset);

// Route for updating dataset metadata (protected)
router.put("/:name", ...authenticateToken, DatasetController.updateDataset);

export default router;