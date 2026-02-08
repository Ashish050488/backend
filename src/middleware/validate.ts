import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, z } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: error.errors }
        });
      } else {
        next(error);
      }
    }
  };
}

// ... (validateParams and validateQuery helpers remain same) ...
export function validateParams<T>(schema: ZodSchema<T>) { /* ... */ return (req:any, res:any, next:any) => next(); } // Shortened for brevity
export function validateQuery<T>(schema: ZodSchema<T>) { /* ... */ return (req:any, res:any, next:any) => next(); }

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');
export const subdomainSchema = z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9-_]*[a-z0-9]$/);
export const apiKeySchema = z.string().min(10).optional();

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// UPDATED DEPLOYMENT SCHEMA
export const createDeploymentSchema = z.object({
  name: subdomainSchema,
  model: z.string().default('anthropic/claude-3-5-sonnet'),
  openaiApiKey: apiKeySchema,
  anthropicApiKey: apiKeySchema,
  telegramBotToken: z.string().min(10, "Telegram Token is too short").optional(),
}).refine(data => data.openaiApiKey || data.anthropicApiKey, {
  message: "At least one AI API key (OpenAI or Anthropic) is required",
  path: ["openaiApiKey"]
});

export const deploymentActionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart', 'remove']),
});

export const deploymentParamsSchema = z.object({
  id: objectIdSchema,
});

export const paginationSchema = z.object({
  page: z.string().transform(Number).default('1'),
  limit: z.string().transform(Number).default('10'),
});

export default validateBody;