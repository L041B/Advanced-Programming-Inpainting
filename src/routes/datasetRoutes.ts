import { Router } from "express";
import multer from "multer";
import path from "path";
import { DatasetController } from "../controllers/datasetController";
import { authenticateToken } from "../middleware/authMiddleware";
import { TokenMiddleware } from "../middleware/tokenMiddleware";

const router = Router();

// Custom storage configuration for handling uploads
const fileStorageConfig = multer.diskStorage({
    destination: (request, uploadedFile, callback) => {
        const tempStoragePath = path.join(process.cwd(), "uploads", "temp");
        callback(null, tempStoragePath);
    },
    filename: (request, uploadedFile, callback) => {
        const timestamp = new Date().getTime();
        const randomSuffix = Math.floor(Math.random() * 999999);
        const fileExtension = path.extname(uploadedFile.originalname);
        const generatedName = `upload_${timestamp}_${randomSuffix}${fileExtension}`;
        callback(null, generatedName);
    }
});

const fileUploadHandler = multer({ 
    storage: fileStorageConfig,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter: (request, uploadedFile, callback) => {
        const supportedExtensions = /jpeg|jpg|png|mp4|avi|mov|zip/;
        const extensionCheck = supportedExtensions.test(path.extname(uploadedFile.originalname).toLowerCase());
        const mimeTypeCheck = supportedExtensions.test(uploadedFile.mimetype);
        
        if (mimeTypeCheck && extensionCheck) {
            return callback(null, true);
        } else {
            callback(new Error("File type not supported"));
        }
    }
});

// Route for creating an empty dataset (protected)
router.post("/create-empty", ...authenticateToken, DatasetController.createEmptyDataset);

// Route for uploading data to dataset (protected with token validation and cost injection)
router.post("/upload-data", 
    ...authenticateToken,
    TokenMiddleware.validateTokenBalance,
    TokenMiddleware.injectTokenCostInResponse,
    fileUploadHandler.fields([
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

export default router;
