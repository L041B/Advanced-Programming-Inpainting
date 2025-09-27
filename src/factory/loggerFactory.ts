// Import necessary modules from LoggerDecorator.
import { ApiRouteLogger, ErrorRouteLogger, UserRouteLogger, AuthRouteLogger, DatasetRouteLogger, InferenceRouteLogger, LoggerDecorator } from "../utils/loggerDecorator";

// Factory for creating logger decorators
export class LoggerFactory {
    private static instance: LoggerFactory;

    private constructor() {}

    // Get the singleton instance of the LoggerFactory
    public static getInstance(): LoggerFactory {
        if (!LoggerFactory.instance) {
            LoggerFactory.instance = new LoggerFactory();
        }
        return LoggerFactory.instance;
    }

    // Create specific logger instances
    public createApiLogger(wrappedLogger?: LoggerDecorator): ApiRouteLogger {
        return new ApiRouteLogger(wrappedLogger);
    }

    // Create an error logger instance
    public createErrorLogger(wrappedLogger?: LoggerDecorator): ErrorRouteLogger {
        return new ErrorRouteLogger(wrappedLogger);
    }

    // Create a user logger instance
    public createUserLogger(wrappedLogger?: LoggerDecorator): UserRouteLogger {
        return new UserRouteLogger(wrappedLogger);
    }

    // Create an auth logger instance
    public createAuthLogger(wrappedLogger?: LoggerDecorator): AuthRouteLogger {
        return new AuthRouteLogger(wrappedLogger);
    }

    // Create a dataset logger instance
    public createDatasetLogger(wrappedLogger?: LoggerDecorator): DatasetRouteLogger {
        return new DatasetRouteLogger(wrappedLogger);
    }

    // Create an inference logger instance
    public createInferenceLogger(wrappedLogger?: LoggerDecorator): InferenceRouteLogger {
        return new InferenceRouteLogger(wrappedLogger);
    }
}

// Export singleton instance
export const loggerFactory = LoggerFactory.getInstance();

// Export classes for type imports
export {
    ApiRouteLogger,
    ErrorRouteLogger,
    UserRouteLogger,
    AuthRouteLogger,
    DatasetRouteLogger,
    InferenceRouteLogger
};
