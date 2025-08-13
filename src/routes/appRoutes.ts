// Import the Router from Express to create modular route handlers.
import { Router } from 'express';

// Create a new router instance.
const router = Router();

// A route for the API root.
router.get('/', (req, res) => {
    res.json({
        message: 'Advanced Programming - Inpainting API',
        version: '1.0.0',
        status: 'running'
    });
});

// A route for health checks.
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});


// Export the router to be mounted in the main application file.
export default router;
