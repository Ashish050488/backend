/**
 * Validation Utilities
 * Reusable validation functions across the application
 */

import { MODEL_MAPPINGS, ENCRYPTED_FIELDS } from './constants';
import { ValidationError } from './errors';

// ============================================================================
// Format Validators
// ============================================================================

/**
 * Check if value is valid hex string
 */
export function isValidHex(str: string): boolean {
  return /^[a-f0-9]*$/i.test(str);
}

/**
 * Check if value is valid ObjectId
 */
export function isValidObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Check if value is valid subdomain
 */
export function isValidSubdomain(subdomain: string): boolean {
  return /^[a-z0-9][a-z0-9-_]*[a-z0-9]$/.test(subdomain);
}

/**
 * Check if value is valid email
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Check if string is in encrypted format (iv:authTag:ciphertext)
 */
export function isEncryptedFormat(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p));
}

/**
 * Check if port is in valid range
 */
export function isValidPort(port: number, min: number, max: number): boolean {
  return Number.isInteger(port) && port >= min && port <= max;
}

// ============================================================================
// API Key Validators
// ============================================================================

/**
 * Validate Google API key format
 */
export function isValidGoogleApiKey(key: string): boolean {
  return /^AIza[0-9A-Za-z\-_]{35}$/.test(key);
}

/**
 * Validate OpenAI API key format
 */
export function isValidOpenAIApiKey(key: string): boolean {
  return /^sk-[a-zA-Z0-9]{48,}$/.test(key);
}

/**
 * Validate Anthropic API key format
 */
export function isValidAnthropicApiKey(key: string): boolean {
  return /^sk-ant-[a-zA-Z0-9\-_]{95,}$/.test(key);
}

/**
 * Validate Telegram bot token format
 */
export function isValidTelegramToken(token: string): boolean {
  return /^\d{8,10}:[a-zA-Z0-9_-]{35}$/.test(token);
}

// ============================================================================
// Model Validators
// ============================================================================

/**
 * Validate and normalize model name
 */
export function validateAndNormalizeModel(
  model: string | undefined,
  secrets: {
    googleApiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
  }
): string {
  // Map deprecated models to current ones
  let normalizedModel = model;
  if (normalizedModel && MODEL_MAPPINGS[normalizedModel]) {
    normalizedModel = MODEL_MAPPINGS[normalizedModel];
  }

  // Auto-select model if not provided
  if (!normalizedModel) {
    if (secrets.googleApiKey) return 'google/gemini-3-pro-preview';
    if (secrets.anthropicApiKey) return 'anthropic/claude-3-5-sonnet';
    if (secrets.openaiApiKey) return 'openai/gpt-4o';
    throw new ValidationError('No model specified and no API keys provided');
  }

  // Validate model matches provided API key
  if (normalizedModel.startsWith('google') && !secrets.googleApiKey) {
    throw new ValidationError('Selected Google model but missing Google API Key');
  }
  if (normalizedModel.startsWith('anthropic') && !secrets.anthropicApiKey) {
    throw new ValidationError('Selected Anthropic model but missing Anthropic API Key');
  }
  if (normalizedModel.startsWith('openai') && !secrets.openaiApiKey) {
    throw new ValidationError('Selected OpenAI model but missing OpenAI API Key');
  }

  return normalizedModel;
}

// ============================================================================
// Secrets Validators
// ============================================================================

/**
 * Validate that at least one API key is provided
 */
export function validateApiKeys(secrets: {
  googleApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}): void {
  if (!secrets.googleApiKey && !secrets.anthropicApiKey && !secrets.openaiApiKey) {
    throw new ValidationError('At least one API key (Google, OpenAI, or Anthropic) is required');
  }
}

/**
 * Validate API key formats
 */
export function validateApiKeyFormats(secrets: {
  googleApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  telegramBotToken?: string;
}): void {
  if (secrets.googleApiKey && !isValidGoogleApiKey(secrets.googleApiKey)) {
    throw new ValidationError('Invalid Google API Key format');
  }
  
  if (secrets.openaiApiKey && !isValidOpenAIApiKey(secrets.openaiApiKey)) {
    throw new ValidationError('Invalid OpenAI API Key format');
  }
  
  if (secrets.anthropicApiKey && !isValidAnthropicApiKey(secrets.anthropicApiKey)) {
    throw new ValidationError('Invalid Anthropic API Key format');
  }
  
  if (secrets.telegramBotToken && !isValidTelegramToken(secrets.telegramBotToken)) {
    throw new ValidationError('Invalid Telegram Bot Token format');
  }
}

// ============================================================================
// Pagination Validators
// ============================================================================

/**
 * Validate and normalize pagination parameters
 */
export function validatePagination(
  page?: string | number,
  limit?: string | number
): { page: number; limit: number; skip: number } {
  const normalizedPage = Math.max(1, parseInt(String(page || 1), 10) || 1);
  const normalizedLimit = Math.min(100, Math.max(1, parseInt(String(limit || 10), 10) || 10));
  const skip = (normalizedPage - 1) * normalizedLimit;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip,
  };
}

// ============================================================================
// State Transition Validators
// ============================================================================

/**
 * Validate state transition is allowed
 */
export function isValidStateTransition(
  currentState: string,
  targetState: string,
  validTransitions: Record<string, string[]>
): boolean {
  const allowed = validTransitions[currentState];
  if (!allowed) return false;
  return allowed.includes(targetState);
}

// ============================================================================
// Sanitization Functions
// ============================================================================

/**
 * Sanitize subdomain (lowercase, trim)
 */
export function sanitizeSubdomain(subdomain: string): string {
  return subdomain.toLowerCase().trim();
}

/**
 * Sanitize email (lowercase, trim)
 */
export function sanitizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Mask sensitive data for logging
 */
export function maskSensitive(data: Record<string, any>): Record<string, any> {
  const masked = { ...data };
  const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'key'];
  
  for (const key of Object.keys(masked)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      if (typeof masked[key] === 'string') {
        masked[key] = masked[key].substring(0, 8) + '***';
      }
    }
  }
  
  return masked;
}

/**
 * Sanitize MongoDB URI for logging (hide credentials)
 */
export function sanitizeMongoUri(uri: string): string {
  return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
}

// ============================================================================
// Object Validators
// ============================================================================

/**
 * Check if object has all required keys
 */
export function hasRequiredKeys<T extends Record<string, any>>(
  obj: T,
  keys: Array<keyof T>
): boolean {
  return keys.every(key => key in obj && obj[key] !== undefined && obj[key] !== null);
}

/**
 * Remove undefined and null values from object
 */
export function removeEmpty<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key as keyof T] = value;
    }
  }
  
  return result;
}

// ============================================================================
// Export All
// ============================================================================

export default {
  isValidHex,
  isValidObjectId,
  isValidSubdomain,
  isValidEmail,
  isEncryptedFormat,
  isValidPort,
  isValidGoogleApiKey,
  isValidOpenAIApiKey,
  isValidAnthropicApiKey,
  isValidTelegramToken,
  validateAndNormalizeModel,
  validateApiKeys,
  validateApiKeyFormats,
  validatePagination,
  isValidStateTransition,
  sanitizeSubdomain,
  sanitizeEmail,
  maskSensitive,
  sanitizeMongoUri,
  hasRequiredKeys,
  removeEmpty,
};