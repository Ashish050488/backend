/**
 * Logger Utility - Winston-based structured logging
 */

import winston from 'winston';
import { config } from '@config/index';

// ============================================================================
// Format Configuration
// ============================================================================

const { combine, timestamp, json, printf, colorize, errors } = winston.format;

// Development format with colors
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Production format (structured JSON)
const prodFormat = combine(
  timestamp(),
  json(),
  errors({ stack: true })
);

// ============================================================================
// Logger Configuration
// ============================================================================

const loggerConfig: winston.LoggerOptions = {
  level: config.logging.level,
  defaultMeta: {
    service: 'simpleclaw-saas',
    environment: config.server.env,
  },
  transports: [
    // Console transport
    new winston.transports.Console({
      format: config.server.isDevelopment
        ? combine(
            colorize(),
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            devFormat
          )
        : prodFormat,
    }),
  ],
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.Console({
      format: prodFormat,
    }),
  ],
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.Console({
      format: prodFormat,
    }),
  ],
};

// ============================================================================
// Create Logger
// ============================================================================

export const logger = winston.createLogger(loggerConfig);

// ============================================================================
// Stream for Morgan HTTP logging
// ============================================================================

export const logStream = {
  write: (message: string): void => {
    logger.info(message.trim());
  },
};

// ============================================================================
// Child Logger Factory
// ============================================================================

export function createChildLogger(meta: Record<string, unknown>): winston.Logger {
  return logger.child(meta);
}

export default logger;
