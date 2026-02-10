/**
 * Create Deployment Handler
 * POST /api/deployments - Create new deployment
 */

import { Request, Response, NextFunction } from 'express';
import { Deployment } from '@models/Deployment';
import { User } from '@models/User';
import { deploymentOrchestrator } from '@services/deployment';
import { cryptoService } from '@utils/crypto';
import { logger } from '@utils/logger';
import {
  validateApiKeys,
  validateAndNormalizeModel,
  sanitizeSubdomain,
} from '@utils/validation';
import { ConflictError, ForbiddenError, NotFoundError } from '@utils/errors';
import { ApiResponse, DeploymentStatusResponse } from '../../types';

export async function createDeployment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { name, model, openaiApiKey, anthropicApiKey, googleApiKey, telegramBotToken } =
      req.body;

    logger.info('Creating deployment', { userId, subdomain: name });

    // Get user and check quota
    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    const canCreate = await user.canCreateAgent();
    if (!canCreate.allowed) {
      throw new ForbiddenError(canCreate.reason || 'Cannot create deployment');
    }

    // Check subdomain availability
    const subdomain = sanitizeSubdomain(name);
    const existing = await Deployment.findOne({ subdomain });
    
    if (existing) {
      throw new ConflictError('Subdomain already taken');
    }

    // Prepare secrets
    const secrets = {
      openaiApiKey,
      anthropicApiKey,
      googleApiKey,
      telegramBotToken,
    };

    // Validate at least one API key
    validateApiKeys(secrets);

    // Validate and normalize model
    const normalizedModel = validateAndNormalizeModel(model, secrets);

    // Generate web UI token
    const webUiToken = cryptoService.generateToken(32);

    // Create deployment document
    const deployment = new Deployment({
      user: userId,
      subdomain,
      status: 'idle',
      secrets: {
        ...secrets,
        webUiToken,
      },
      config: {
        model: normalizedModel,
        systemPrompt: 'You are a helpful AI assistant.',
      },
    });

    await deployment.save();

    logger.info('Deployment document created', {
      deploymentId: deployment._id.toString(),
      subdomain,
    });

    // Start async deployment process
    setImmediate(async () => {
      try {
        const decryptedSecrets = await deployment.decryptSecrets();
        await deploymentOrchestrator.spawnAgent(deployment, decryptedSecrets, normalizedModel);
      } catch (error) {
        logger.error('Async deployment spawn failed', {
          deploymentId: deployment._id.toString(),
          error: (error as Error).message,
        });
      }
    });

    // Return immediate response
    res.status(201).json({
      success: true,
      data: {
        id: deployment._id.toString(),
        subdomain: deployment.subdomain,
        status: deployment.status as any,
        createdAt: deployment.createdAt.toISOString(),
      },
    } as ApiResponse<DeploymentStatusResponse>);
  } catch (error) {
    next(error);
  }
}

export default createDeployment;