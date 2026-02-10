/**
 * Centralized Error Classes
 * All custom error types in one place for easy management
 */

// ============================================================================
// Base Error Classes
// ============================================================================

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// ============================================================================
// HTTP Error Classes
// ============================================================================

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

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
    this.name = 'ForbiddenError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, 'BAD_REQUEST', message);
    this.name = 'BadRequestError';
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error') {
    super(500, 'INTERNAL_ERROR', message);
    this.name = 'InternalServerError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable') {
    super(503, 'SERVICE_UNAVAILABLE', message);
    this.name = 'ServiceUnavailableError';
  }
}

// ============================================================================
// Security Error Classes
// ============================================================================

export class TamperedDataError extends Error {
  constructor(message: string = 'Data integrity check failed') {
    super(message);
    this.name = 'TamperedDataError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class EncryptionError extends Error {
  constructor(message: string = 'Encryption operation failed') {
    super(message);
    this.name = 'EncryptionError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// ============================================================================
// Business Logic Error Classes
// ============================================================================

export class DeploymentError extends Error {
  constructor(
    message: string, 
    public code: string = 'DEPLOYMENT_ERROR', 
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'DeploymentError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class PortAllocationError extends Error {
  constructor(message: string = 'Failed to allocate port') {
    super(message);
    this.name = 'PortAllocationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ContainerError extends Error {
  constructor(message: string, public operation: string) {
    super(message);
    this.name = 'ContainerError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class StateTransitionError extends Error {
  constructor(
    public currentState: string,
    public targetState: string
  ) {
    super(`Invalid state transition from ${currentState} to ${targetState}`);
    this.name = 'StateTransitionError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ResourceExhaustedError extends AppError {
  constructor(message: string = 'Server resources exhausted') {
    super(503, 'RESOURCE_EXHAUSTED', message);
    this.name = 'ResourceExhaustedError';
  }
}

// ============================================================================
// Payment Error Classes
// ============================================================================

export class PaymentError extends AppError {
  constructor(message: string, code: string = 'PAYMENT_ERROR') {
    super(400, code, message);
    this.name = 'PaymentError';
  }
}

export class SubscriptionError extends AppError {
  constructor(message: string) {
    super(403, 'SUBSCRIPTION_ERROR', message);
    this.name = 'SubscriptionError';
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if error is an instance of AppError
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Check if error is operational (expected) vs programming error
 */
export function isOperationalError(error: unknown): boolean {
  if (error instanceof AppError) {
    return true;
  }
  
  const operationalErrors = [
    'ValidationError',
    'NotFoundError',
    'ConflictError',
    'UnauthorizedError',
    'ForbiddenError',
    'DeploymentError',
    'PortAllocationError',
    'PaymentError',
    'SubscriptionError',
  ];
  
  return error instanceof Error && operationalErrors.includes(error.name);
}

/**
 * Extract error message safely
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return 'An unknown error occurred';
}

/**
 * Extract error code safely
 */
export function getErrorCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.code;
  }
  
  if (error instanceof Error) {
    return error.name;
  }
  
  return 'UNKNOWN_ERROR';
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Create appropriate error from Docker error
 */
export function createDockerError(error: any): ContainerError | Error {
  const message = error.message || 'Docker operation failed';
  
  if (error.statusCode === 404) {
    return new ContainerError('Container not found', 'find');
  }
  
  if (error.statusCode === 304) {
    return new ContainerError('Container already in desired state', 'state');
  }
  
  if (message.includes('port is already allocated')) {
    return new PortAllocationError('Port is already allocated');
  }
  
  return new ContainerError(message, 'unknown');
}

/**
 * Create appropriate error from MongoDB error
 */
export function createMongoError(error: any): Error {
  if (error.name === 'ValidationError') {
    const messages = Object.values(error.errors).map((e: any) => e.message);
    return new ValidationError('Validation failed', messages);
  }
  
  if (error.name === 'MongoServerError' && error.code === 11000) {
    const key = Object.keys(error.keyValue)[0];
    return new ConflictError(`${key} already exists`);
  }
  
  if (error.name === 'CastError') {
    return new ValidationError('Invalid identifier format');
  }
  
  return new InternalServerError(error.message);
}

export default {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BadRequestError,
  InternalServerError,
  ServiceUnavailableError,
  TamperedDataError,
  EncryptionError,
  DeploymentError,
  PortAllocationError,
  ContainerError,
  StateTransitionError,
  ConfigurationError,
  ResourceExhaustedError,
  PaymentError,
  SubscriptionError,
  isAppError,
  isOperationalError,
  getErrorMessage,
  getErrorCode,
  createDockerError,
  createMongoError,
};