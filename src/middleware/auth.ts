/**
 * Authentication Middleware
 * 
 * JWT-based authentication for API endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { User } from '@models/User';

// ============================================================================
// Types
// ============================================================================

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        tier: string;
      };
    }
  }
}

interface JwtPayload {
  userId: string;
  email: string;
  tier: string;
}

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Verify JWT token and attach user to request
 */
export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (!token) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token required',
        },
      });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Attach user to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      tier: decoded.tier,
    };

    logger.debug('User authenticated', { userId: decoded.userId });
    next();

  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
        },
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
        },
      });
      return;
    }

    logger.error('Authentication error', { error: (error as Error).message });
    
    res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
      },
    });
  }
}

/**
 * Optional authentication - attaches user if token valid, but doesn't require it
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;

    if (token) {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        tier: decoded.tier,
      };
    }

    next();
  } catch {
    // Ignore errors for optional auth
    next();
  }
}

/**
 * Generate JWT token for user
 */
export function generateToken(user: {
  _id: string;
  email: string;
  tier: string;
}): string {
  return jwt.sign(
    {
      userId: user._id.toString(),
      email: user.email,
      tier: user.tier,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * Require specific tier for access
 */
export function requireTier(...allowedTiers: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
      return;
    }

    if (!allowedTiers.includes(req.user.tier)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: `This feature requires one of these tiers: ${allowedTiers.join(', ')}`,
        },
      });
      return;
    }

    next();
  };
}

export default authenticateToken;
