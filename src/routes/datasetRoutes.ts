import { Router } from "express";
import multer from "multer";
import path from "path";
import { DatasetController } from "../controllers/datasetController";
import { authenticateToken } from "../middleware/authMiddleware";

const router = Router();

// Configure disk storage for multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(process.cwd(), "uploads", "temp");
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|mp4|avi|mov|zip/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        
        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error("Invalid file type"));
        }
    }
});

// Route for creating an empty dataset (protected)
router.post("/create-empty", ...authenticateToken, DatasetController.createEmptyDataset);

// Route for uploading data to dataset (protected)
router.post("/upload-data", 
    ...authenticateToken,
    upload.fields([
        { name: "image", maxCount: 1 },
        { name: "mask", maxCount: 1 }
    ]), 
    DatasetController.uploadDataToDataset
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
