// Import necessary modules from LoggerDecorator.
import { ApiRouteLogger, ExecutionRouteLogger, ErrorRouteLogger, UserRouteLogger, AuthRouteLogger } from '../utils/loggerDecorator';

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
    public createApiLogger(): ApiRouteLogger {
        return new ApiRouteLogger();
    }

    // Create an execution logger instance
    public createExecutionLogger(): ExecutionRouteLogger {
        return new ExecutionRouteLogger();
    }

    // Create an error logger instance
    public createErrorLogger(): ErrorRouteLogger {
        return new ErrorRouteLogger();
    }

    // Create a user logger instance
    public createUserLogger(): UserRouteLogger {
        return new UserRouteLogger();
    }

    // Create an auth logger instance
    public createAuthLogger(): AuthRouteLogger {
        return new AuthRouteLogger();
    }
}

// Export singleton instance
export const loggerFactory = LoggerFactory.getInstance();

// Export classes for type imports
export {
    ExecutionRouteLogger,
    ApiRouteLogger,
    ErrorRouteLogger,
    UserRouteLogger,
    AuthRouteLogger
};
