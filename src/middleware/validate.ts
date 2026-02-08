import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError, z } from 'zod';

// Helper function to validate request body
export const validateBody = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: error.errors,
          },
        });
      } else {
        next(error);
      }
    }
  };
};

// Helper function to validate URL parameters
export const validateParams = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // @ts-ignore
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid URL parameters',
            details: error.errors,
          },
        });
      } else {
        next(error);
      }
    }
  };
};

// Helper function to validate Query parameters
export const validateQuery = (schema: ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // @ts-ignore
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid query parameters',
            details: error.errors,
          },
        });
      } else {
        next(error);
      }
    }
  };
};

// --- SCHEMAS ---

// Regex for Google Keys (starts with AIza)
export const googleKeySchema = z.string().regex(/^AIza[0-9A-Za-z\-_]{35}$/, "Invalid Google API Key format").optional();

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

export const createDeploymentSchema = z.object({
  name: subdomainSchema,
  model: z.string().optional(), // Optional so Controller can set default
  openaiApiKey: apiKeySchema,
  anthropicApiKey: apiKeySchema,
  googleApiKey: googleKeySchema, 
  telegramBotToken: z.string().min(10, "Telegram Token is too short").optional(),
}).refine(data => data.openaiApiKey || data.anthropicApiKey || data.googleApiKey, {
  message: "At least one API key (Google, OpenAI, or Anthropic) is required",
  path: ["googleApiKey"] 
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