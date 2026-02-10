/**
 * Manage Deployment Handler
 * POST /api/deployments/:id/action - Perform action on deployment
 */

import { Request, Response, NextFunction } from 'express';
import { Deployment } from '@models/Deployment';
import { deploymentOrchestrator } from '@services/deployment';
import { proxyManager } from '@middleware/proxy';
import { logger } from '@utils/logger';
import { NotFoundError, BadRequestError } from '@utils/errors';
import { ApiResponse } from '../../types';

export async function manageDeployment(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { action } = req.body;

    logger.info('Managing deployment', { deploymentId: id, userId, action });

    // Find deployment
    const deployment = await Deployment.findOne({
      _id: id,
      user: userId,
    });

    if (!deployment) {
      throw new NotFoundError('Deployment');
    }

    // Handle different actions
    switch (action) {
      case 'start':
        await handleStart(deployment);
        break;

      case 'stop':
        await handleStop(deployment);
        break;

      case 'restart':
        await handleRestart(deployment);
        break;

      case 'remove':
        await handleRemove(deployment, res);
        return; // Exit early for remove

      default:
        throw new BadRequestError(`Unknown action: ${action}`);
    }

    // Return success response
    res.json({
      success: true,
      data: {
        id: deployment._id.toString(),
        status: deployment.status as any,
        message: `Action '${action}' initiated successfully`,
      },
    } as ApiResponse);
  } catch (error) {
    next(error);
  }
}

/**
 * Handle start action
 */
async function handleStart(deployment: InstanceType<typeof Deployment>): Promise<void> {
  if (deployment.status !== 'stopped' && deployment.status !== 'error') {
    throw new BadRequestError(`Cannot start deployment in ${deployment.status} state`);
  }

  const secrets = await deployment.decryptSecrets();
  await deploymentOrchestrator.spawnAgent(
    deployment,
    secrets,
    deployment.config?.model as string
  );
}

/**
 * Handle stop action
 */
async function handleStop(deployment: InstanceType<typeof Deployment>): Promise<void> {
  if (deployment.status !== 'healthy' && deployment.status !== 'starting') {
    throw new BadRequestError(`Cannot stop deployment in ${deployment.status} state`);
  }

  await deploymentOrchestrator.stopDeployment(deployment);
}

/**
 * Handle restart action
 */
async function handleRestart(deployment: InstanceType<typeof Deployment>): Promise<void> {
  if (deployment.status !== 'healthy') {
    throw new BadRequestError(`Cannot restart deployment in ${deployment.status} state`);
  }

  await deploymentOrchestrator.restartDeployment(deployment);
}

/**
 * Handle remove action
 */
async function handleRemove(
  deployment: InstanceType<typeof Deployment>,
  res: Response
): Promise<void> {
  // Remove deployment
  await deploymentOrchestrator.removeDeployment(deployment);

  // Delete from database
  await Deployment.findByIdAndDelete(deployment._id);

  // Clear proxy cache
  proxyManager.clearCache(deployment.subdomain);

  logger.info('Deployment removed successfully', {
    deploymentId: deployment._id.toString(),
  });

  // Send response
  res.json({
    success: true,
    data: { message: 'Deployment removed successfully' },
  } as ApiResponse);
}

export default manageDeployment;