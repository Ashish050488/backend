import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '@models/User';
import { generateToken, authenticateToken } from '@middleware/auth';
import { validateBody, registerSchema, loginSchema } from '@middleware/validate';
import { logger } from '@utils/logger';
import { ApiResponse } from '../types';

const router = Router();

router.post(
  '/register',
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

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

      const passwordHash = await bcrypt.hash(password, 12);

      const user = new User({
        email,
        passwordHash,
      });

      await user.save();

      const token = generateToken({
        _id: user._id.toString(),
        email: user.email,
        tier: user.tier,
      });

      logger.info('User registered', { userId: user._id, email });

      res.status(201).json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
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

router.post(
  '/login',
  validateBody(loginSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

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

      const token = generateToken({
        _id: user._id.toString(),
        email: user.email,
        tier: user.tier,
      });

      logger.info('User logged in', { userId: user._id, email });

      res.json({
        success: true,
        data: {
          user: {
            id: user._id.toString(),
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
          id: user._id.toString(),
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

      const token = generateToken({
        _id: user._id.toString(),
        email: user.email,
        tier: user.tier,
      });

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