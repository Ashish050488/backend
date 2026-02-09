import { Request, Response, NextFunction } from 'express';
import { logger } from '@utils/logger';
import { 
  TamperedDataError, 
  EncryptionError, 
  DeploymentError,
  PortAllocationError 
} from '../types';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'CONFLICT', message);
    this.name = 'ConflictError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
  });

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  if (err instanceof TamperedDataError) {
    res.status(500).json({
      success: false,
      error: {
        code: 'DATA_INTEGRITY_ERROR',
        message: 'Data integrity check failed. Please contact support.',
      },
    });
    return;
  }

  if (err instanceof EncryptionError) {
    res.status(500).json({
      success: false,
      error: {
        code: 'ENCRYPTION_ERROR',
        message: 'Security operation failed. Please try again.',
      },
    });
    return;
  }

  if (err instanceof DeploymentError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
    });
    return;
  }

  if (err instanceof PortAllocationError) {
    res.status(503).json({
      success: false,
      error: {
        code: 'RESOURCE_EXHAUSTED',
        message: 'Server resources exhausted. Please try again later.',
      },
    });
    return;
  }

  if (err.name === 'ValidationError') {
    const validationError = err as any;
    const messages = Object.values(validationError.errors).map(
      (e: any) => e.message
    );
    
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: messages,
      },
    });
    return;
  }

  if (err.name === 'MongoServerError' && (err as any).code === 11000) {
    const key = Object.keys((err as any).keyValue)[0];
    res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_ERROR',
        message: `${key} already exists`,
      },
    });
    return;
  }

  if (err.name === 'CastError') {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_ID',
        message: 'Invalid identifier format',
      },
    });
    return;
  }

  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
      },
    });
    return;
  }

  if (err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token expired',
      },
    });
    return;
  }

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' 
        ? 'An unexpected error occurred' 
        : err.message,
    },
  });
}

export function notFoundHandler(
  req: Request,
  res: Response
): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

export default errorHandler;