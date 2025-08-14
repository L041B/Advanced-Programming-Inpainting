// Import necessary modules from Express and custom middleware/controllers
import { Router } from 'express';
import { ExecutionController } from '../controllers/executionController';
import { 
    validateExecutionCreation, 
    validateExecutionId, 
    validateExecutionUpdate,
    validateJobId,
    uploadImagePair,
    validateExecutionUUID,
    authorizeExecution
} from '../middleware/executionMiddleware';
import { authenticateToken} from '../middleware/authMiddleware';

// Create a new router instance.
const router = Router();

// Instantiate the controller for execution logic.
const executionController = new ExecutionController();

// CREATE - Perform inpainting, creating a new execution record.
router.post('/', 
    ...authenticateToken,
    uploadImagePair,
    ...validateExecutionCreation,
    executionController.performInpainting
);

// CREATE - Generate an inpainting preview
router.post('/preview',
    ...authenticateToken,
    uploadImagePair,
    executionController.generateInpainting
);

// READ - Get preview status and result by job ID (returns image when completed)
router.get('/preview/:jobId',
    ...authenticateToken,
    ...validateJobId,
    executionController.getPreviewStatus
);

// READ - Get all executions for authenticated user 
router.get('/user', 
    ...authenticateToken, 
    executionController.getUserExecutions
);

// Get the status of an asynchronous job by its jobId.
router.get('/job/:jobId/status', 
    ...authenticateToken,
    ...validateJobId,
    executionController.getJobStatus
);

// READ - Get a specific execution by its ID.
router.get('/:id', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    executionController.getExecution
);

// UPDATE - Update execution (modify one or both images)
router.put('/:id', 
    validateExecutionUUID,
    ...authenticateToken,
    ...validateExecutionId,
    ...authorizeExecution,
    uploadImagePair,
    ...validateExecutionUpdate,
    executionController.updateExecution
);

// DELETE - Delete a specific execution
router.delete('/:id', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    executionController.deleteExecution
);

// Download the resulting inpainted image.
router.get('/:id/download', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    executionController.downloadResult
);

// Get the status of a specific execution.
router.get('/:id/status', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    executionController.getExecutionStatus
);

// Export the router to be used in the main app file.
export default router;