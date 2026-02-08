/**
 * Authentication Routes
 * 
 * User registration, login, and profile management.
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '@models/User';
import { generateToken, authenticateToken } from '@middleware/auth';
import { validateBody, registerSchema, loginSchema } from '@middleware/validate';
import { logger } from '@utils/logger';
import { ApiResponse } from '@types/index';

const router = Router();

// ============================================================================
// POST /api/auth/register - Register new user
// ============================================================================

router.post(
  '/register',
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        res.status(409).json({
          success: false,
          error: {
            code: 'EMAIL_EXISTS',
            message: 'An account with this email already exists',
          },
        } as ApiResponse);
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const user = new User({
        email,
        passwordHash,
      });

      await user.save();

      // Generate token
      const token = generateToken(user);

      logger.info('User registered', { userId: user._id, email });

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user._id,
            email: user.email,
            tier: user.tier,
            subscriptionStatus: user.subscriptionStatus,
            maxAgents: user.maxAgents,
          },
          token,
        },
      } as ApiResponse);

    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// POST /api/auth/login - Login user
// ============================================================================

router.post(
  '/login',
  validateBody(loginSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      // Find user
      const user = await User.findByEmail(email);
      if (!user) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        } as ApiResponse);
        return;
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        } as ApiResponse);
        return;
      }

      // Generate token
      const token = generateToken(user);

      logger.info('User logged in', { userId: user._id, email });

      res.json({
        success: true,
        data: {
          user: {
            id: user._id,
            email: user.email,
            tier: user.tier,
            subscriptionStatus: user.subscriptionStatus,
            maxAgents: user.maxAgents,
          },
          token,
        },
      } as ApiResponse);

    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// GET /api/auth/me - Get current user profile
// ============================================================================

router.get(
  '/me',
  authenticateToken,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user!.id);
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          },
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        data: {
          id: user._id,
          email: user.email,
          tier: user.tier,
          subscriptionStatus: user.subscriptionStatus,
          maxAgents: user.maxAgents,
          createdAt: user.createdAt,
        },
      } as ApiResponse);

    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// POST /api/auth/refresh - Refresh access token
// ============================================================================

router.post(
  '/refresh',
  authenticateToken,
  async (req, res, next) => {
    try {
      const user = await User.findById(req.user!.id);
      
      if (!user) {
        res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
          },
        } as ApiResponse);
        return;
      }

      // Generate new token
      const token = generateToken(user);

      res.json({
        success: true,
        data: { token },
      } as ApiResponse);

    } catch (error) {
      next(error);
    }
  }
);

export default router;
