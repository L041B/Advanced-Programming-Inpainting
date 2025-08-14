// Import necessary modules from bullmq, ioredis, and project files.
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { BlackBoxService } from '../services/blackBox';
import { ExecutionRepository } from '../repository/executionRepository';
import { InpaintingJobData } from '../queue/inpaintingQueue';
import { loggerFactory, ExecutionRouteLogger, ErrorRouteLogger } from '../factory/loggerFactory';
import { DbConnection } from '../config/database';

// The InpaintingWorker class is responsible for processing jobs from the 'inpainting-queue'.
export class InpaintingWorker {
    private readonly worker: Worker;
    private readonly blackBoxService: BlackBoxService;
    private readonly executionRepository: ExecutionRepository;
    private readonly redis: Redis;
    private readonly executionLogger: ExecutionRouteLogger;
    private readonly errorLogger: ErrorRouteLogger;

    constructor() {
        try {
            console.log('InpaintingWorker: Initializing dependencies...');
            // Initialize all necessary singletons and configurations.
            this.executionLogger = loggerFactory.createExecutionLogger();
            this.errorLogger = loggerFactory.createErrorLogger();
            this.blackBoxService = BlackBoxService.getInstance();
            this.executionRepository = ExecutionRepository.getInstance();

            // Initialize Redis connection
            this.redis = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                maxRetriesPerRequest: null, 
            });
            console.log('InpaintingWorker: Dependencies initialized.');

            console.log('InpaintingWorker: Creating BullMQ worker...');

            // Create the worker
            this.worker = new Worker('inpainting-queue', this.processJob.bind(this), {
                connection: this.redis,
                // Concurrency determines how many jobs this worker can process in parallel.
                concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
            });
            console.log('InpaintingWorker: Worker created.');

            this.setupEventListeners();
        } catch (error) {
            console.error('InpaintingWorker: Failed to initialize.', error);
            throw error;
        }
    }

    // Helper method to reconstruct buffers that may have been serialized by BullMQ
    private reconstructBuffer(data: unknown): Buffer {
        if (Buffer.isBuffer(data)) {
            return data;
        }
        
        // Handle case where buffer was serialized/deserialized by Redis/BullMQ
        if (data && typeof data === 'object' && 'data' in data && Array.isArray((data as { data: unknown }).data)) {
            return Buffer.from((data as { data: number[] }).data);
        }
        
        // Handle case where buffer is a plain object with a 'length' property
        if (data && typeof data === 'object' && 'length' in data) {
            return Buffer.from(data as ArrayLike<number>);
        }
        
        throw new Error('Invalid buffer data format');
    }

    // The processJob method is responsible for handling the inpainting job.
    private async processJob(job: Job<InpaintingJobData>) {
        const { executionId, userId, originalImage: rawOriginalImage, maskImage: rawMaskImage, isPreview = false } = job.data;
        
        this.executionLogger.log('Processing inpainting job', {
            component: 'InpaintingWorker',
            jobId: job.id,
            executionId,
            isPreview
        });

        try {
            // Reconstruct buffers in case they were serialized by BullMQ/Redis
            let originalImage: Buffer;
            let maskImage: Buffer;

            try {
                // Reconstruct the original and mask images
                originalImage = this.reconstructBuffer(rawOriginalImage);
                maskImage = this.reconstructBuffer(rawMaskImage);
                
                // Validate that we have non-empty buffers
                if (originalImage.length === 0 || maskImage.length === 0) {
                    throw new Error('Reconstructed buffers are empty');
                }
                
                this.executionLogger.log('Buffers reconstructed successfully', { 
                    component: 'InpaintingWorker', 
                    jobId: job.id,
                    originalImageSize: originalImage.length,
                    maskImageSize: maskImage.length
                });
            } catch (bufferError) {
                throw new Error(`Failed to reconstruct image buffers: ${(bufferError as Error).message}`);
            }

            // Update job progress
            await job.updateProgress(10);

            // Only update database for non-preview jobs
            if (!isPreview) {
                // Update the execution status in the database to 'processing'.
                await this.executionRepository.updateExecutionStatus(executionId, userId, 'processing');
            }

            // Update job progress
            await job.updateProgress(25);

            // Call the BlackBox service for inpainting
            this.executionLogger.log('Calling BlackBox service', { component: 'InpaintingWorker', jobId: job.id });
            const inpaintingResult = await this.blackBoxService.processInpainting(originalImage, maskImage);

            // Update job progress
            await job.updateProgress(75);

            // Check if the inpainting result is valid
            if (!inpaintingResult.success || !inpaintingResult.outputImage) {
                throw new Error(inpaintingResult.error || 'Inpainting process failed in BlackBoxService');
            }

            // Log the successful inpainting result
            this.executionLogger.log('BlackBox service succeeded', { component: 'InpaintingWorker', jobId: job.id });
            
            if (!isPreview) {
                // Update the execution record with the output image and set status to 'completed'.
                await this.executionRepository.updateExecution(
                    executionId,
                    userId,
                    { outputImage: inpaintingResult.outputImage, status: 'completed' }
                );
            }
            await job.updateProgress(100);

            // Log the successful completion of the job
            this.executionLogger.log('Job completed successfully', { component: 'InpaintingWorker', jobId: job.id });
            
            // Return the result with success flag and output image
            return { 
                success: true, 
                executionId,
                outputImage: inpaintingResult.outputImage,
                isPreview
            };

        } catch (error) {
            // Log the error
            const err = error instanceof Error ? error : new Error('Unknown error');
            this.errorLogger.log('Job processing failed', {
                component: 'InpaintingWorker',
                jobId: job.id,
                executionId,
                errorMessage: err.message,
                isPreview
            });
            
            if (!isPreview) {
                try {
                    // Attempt to mark the execution as 'failed' in the database.
                    await this.executionRepository.updateExecutionStatus(executionId, userId, 'failed');
                } catch (updateError) {
                    this.errorLogger.logDatabaseError('UPDATE_STATUS_ON_FAIL', 'executions', (updateError as Error).message);
                }
            }

            // Re-throw the error to let BullMQ handle it
            throw err;
        }
    }

    // Sets up event listeners for the worker to log key lifecycle events.
    private setupEventListeners() {
        // Log when a job is completed
        this.worker.on('completed', (job: Job) => {
            this.executionLogger.log('Worker job completed', { component: 'InpaintingWorker', jobId: job.id });
        });

        // Log when a job fails
        this.worker.on('failed', (job, err) => {
            this.errorLogger.log('Worker job failed after retries', {
                component: 'InpaintingWorker',
                jobId: job?.id,
                errorMessage: err.message
            });
        });

        // Log when a worker encounters an error
        this.worker.on('error', (err) => {
            this.errorLogger.log('Worker encountered an error', { component: 'InpaintingWorker', errorMessage: err.message });
        });
    }

    // Closes the worker and its Redis connection.
    public async close(): Promise<void> {
        console.log('InpaintingWorker: Shutting down...');
        await this.worker.close();
        await this.redis.quit();
        console.log('InpaintingWorker: Shutdown complete');
    }
}

// Ensures the worker starts only when the script is executed directly.
async function startWorker() {
    try {
        console.log('Starting inpainting worker process...');
        
        // Ensure database connection is established before starting the worker.
        await DbConnection.connect();
        console.log('Database connected');

        // Initialize the worker
        const worker = new InpaintingWorker();

        // Ensure graceful shutdown on process termination signals
        const gracefulShutdown = async (signal: string) => {
            console.log(`Received ${signal}, shutting down gracefully...`);
            await worker.close();
            await DbConnection.close();
            console.log('Graceful shutdown completed');
            process.exit(0);
        };

        // Listen for termination signals
        process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
        process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

        console.log('Worker is ready and listening for jobs on the "inpainting-queue".');

    } catch (error) {
        // Log critical errors during worker startup
        console.error('CRITICAL: Failed to start the worker process.', error);
        process.exit(1);
    }
}

// Ensures the worker starts only when the script is executed directly.
if (require.main === module) {
    void startWorker();
}