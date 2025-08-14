// Import necessary modules.
import winston from 'winston';

// Singleton Logger using Winston
export class Logger {
    private static instance: winston.Logger;

    private constructor() {}

    // Get the singleton instance of the logger
    public static getInstance(): winston.Logger {
        if (!Logger.instance) {
            Logger.instance = Logger.createWinstonLogger();
        }
        return Logger.instance;
    }

    // Create a new Winston logger instance
    private static createWinstonLogger(): winston.Logger {
        const isProduction = process.env.NODE_ENV === 'production';

        // Create a new Winston logger instance
        const logger = winston.createLogger({
            level: 'info',
            transports: [
                new winston.transports.Console({
                    format: isProduction
                        ? winston.format.combine(
                            winston.format.timestamp(),
                            winston.format.json()
                          )
                        : winston.format.combine(
                            winston.format.colorize(),
                            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                            winston.format.printf((info) => {
                                const { timestamp, level, message, ...meta } = info;
                                const metaString = Object.keys(meta).length > 0 ? ` | ${JSON.stringify(meta)}` : '';
                                return `[${String(timestamp)}] ${level}: ${String(message)}${metaString}`;
                            })
                          )
                })
            ]
        });

        return logger;
    }
}

// Export singleton instance
const logger = Logger.getInstance();
export default logger;