// Import necessary modules from Express and custom middleware/controllers
import { Router, Request, Response, NextFunction } from 'express';
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

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
    return (req: Request, res: Response, next: NextFunction) => {
        void Promise.resolve(fn(req, res, next)).catch(next);
    };
}

// CREATE - Perform inpainting, creating a new execution record.
router.post('/', 
    ...authenticateToken,
    uploadImagePair,
    ...validateExecutionCreation,
    asyncHandler(executionController.performInpainting)
);

// CREATE - Generate an inpainting preview
router.post('/preview',
    ...authenticateToken,
    uploadImagePair,
    asyncHandler(executionController.generateInpainting)
);

// READ - Get preview status and result by job ID (returns image when completed)
router.get('/preview/:jobId',
    ...authenticateToken,
    ...validateJobId,
    asyncHandler(executionController.getPreviewStatus)
);

// READ - Get all executions for authenticated user 
router.get('/user', 
    ...authenticateToken, 
    asyncHandler(executionController.getUserExecutions)
);

// Get the status of an asynchronous job by its jobId.
router.get('/job/:jobId/status', 
    ...authenticateToken,
    ...validateJobId,
    asyncHandler(executionController.getJobStatus)
);

// READ - Get a specific execution by its ID.
router.get('/:id', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    asyncHandler(executionController.getExecution)
);

// UPDATE - Update execution (modify one or both images)
router.put('/:id', 
    validateExecutionUUID,
    ...authenticateToken,
    ...validateExecutionId,
    ...authorizeExecution,
    uploadImagePair,
    ...validateExecutionUpdate,
    asyncHandler(executionController.updateExecution)
);

// DELETE - Delete a specific execution
router.delete('/:id', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    asyncHandler(executionController.deleteExecution)
);

// Download the resulting inpainted image.
router.get('/:id/download', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    asyncHandler(executionController.downloadResult)
);

// Get the status of a specific execution.
router.get('/:id/status', 
    validateExecutionUUID,
    ...authenticateToken, 
    ...validateExecutionId,
    ...authorizeExecution,
    asyncHandler(executionController.getExecutionStatus)
);

// Export the router to be used in the main app file.
export default router;