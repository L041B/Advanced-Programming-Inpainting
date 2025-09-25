import { Router } from "express";
import { DatasetController } from "../controllers/datasetController";
import { authenticateToken } from "../middleware/authMiddleware";
import { TokenMiddleware } from "../middleware/tokenMiddleware";
import { DatasetMiddleware, validateDatasetCreation, validateDatasetUpload, validateDatasetUpdate, validateDatasetAccess } from "../middleware/datasetMiddleware";

const router = Router();

// Route for creating an empty dataset (protected)
router.post("/", 
    ...authenticateToken, 
    ...validateDatasetCreation,
    DatasetController.createEmptyDataset
);

// Route for uploading data to dataset (protected with simplified token validation)
router.post("/data", 
    ...authenticateToken,
    TokenMiddleware.validateTokenBalance,  // Simple balance check only
    TokenMiddleware.injectTokenCostInResponse,  // Response enhancement
    DatasetMiddleware.fileUploadHandler.fields([
        { name: "image", maxCount: 1 },
        { name: "mask", maxCount: 1 }
    ]),
    DatasetMiddleware.handleMulterErrors,  // Handle multer errors before validation
    ...validateDatasetUpload,
    DatasetController.uploadDataToDataset,
    TokenMiddleware.finalizeTokenUsage  // Simple cleanup attempt
);

// Route for getting all user datasets (protected)
router.get("/", ...authenticateToken, DatasetController.getUserDatasets);

// Route for getting a specific dataset by name (protected)
router.get("/:name", 
    ...authenticateToken, 
    ...validateDatasetAccess,
    DatasetController.getDataset
);

// Route for getting dataset contents/data with image URLs (protected)
router.get("/:name/data", 
    ...authenticateToken, 
    ...validateDatasetAccess,
    DatasetController.getDatasetData
);

// Route for serving individual images from dataset (uses temporary token, no auth required)
router.get("/image/:imagePath", DatasetController.serveImage);

// Route for deleting a dataset (protected)
router.delete("/:name", 
    ...authenticateToken, 
    ...validateDatasetAccess,
    DatasetController.deleteDataset
);

// Route for updating dataset metadata (protected)
router.put("/:name", 
    ...authenticateToken, 
    ...validateDatasetUpdate,
    DatasetController.updateDataset
);

export default router;