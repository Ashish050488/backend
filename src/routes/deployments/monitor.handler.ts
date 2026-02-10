/**
 * Monitor Deployment Handlers
 * GET /api/deployments/:id/status - Get deployment status
 * GET /api/deployments/:id/logs - Get container logs
 * GET /api/deployments/:id/stats - Get container stats
 * GET /api/deployments/:id - Get deployment details
 */

import { Request, Response, NextFunction } from 'express';
import { Deployment } from '@models/Deployment';
import { containerManager } from '@services/docker';
import { logger } from '@utils/logger';
import { NotFoundError } from '@utils/errors';
import { ApiResponse } from '../../types';

/**
 * Get deployment details
 */
export async function getDeploymentDetails(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const deployment = await Deployment.findOne({
      _id: id,
      user: userId,
    });

    if (!deployment) {
      throw new NotFoundError('Deployment');
    }

    res.json({
      success: true,
      data: {
        id: deployment._id.toString(),
        subdomain: deployment.subdomain,
        status: deployment.status as any,
        url: deployment.status === 'healthy' ? deployment.getUrl() : undefined,
        provisioningStep: deployment.provisioningStep,
        errorMessage: deployment.errorMessage,
        createdAt: deployment.createdAt.toISOString(),
        updatedAt: deployment.updatedAt.toISOString(),
        lastHeartbeat: deployment.lastHeartbeat?.toISOString(),
      },
    } as ApiResponse);
  } catch (error) {
    next(error);
  }
}

/**
 * Get deployment status (for polling)
 */
export async function getDeploymentStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const deployment = await Deployment.findOne({
      _id: id,
      user: userId,
    });

    if (!deployment) {
      throw new NotFoundError('Deployment');
    }

    res.json({
      success: true,
      data: {
        id: deployment._id.toString(),
        status: deployment.status as any,
        provisioningStep: deployment.provisioningStep,
        errorMessage: deployment.errorMessage,
        url: deployment.status === 'healthy' ? deployment.getUrl() : undefined,
      },
    } as ApiResponse);
  } catch (error) {
    next(error);
  }
}

/**
 * Get container logs
 */
export async function getDeploymentLogs(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const tail = parseInt(req.query.tail as string) || 100;

    logger.debug('Fetching logs', { deploymentId: id, tail });

    const deployment = await Deployment.findOne({
      _id: id,
      user: userId,
    });

    if (!deployment) {
      throw new NotFoundError('Deployment');
    }

    const logs = await containerManager.getLogs(deployment, tail);

    res.json({
      success: true,
      data: {
        logs,
        deploymentId: id,
      },
    } as ApiResponse);
  } catch (error) {
    next(error);
  }
}

/**
 * Get container stats
 */
export async function getDeploymentStats(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const deployment = await Deployment.findOne({
      _id: id,
      user: userId,
    });

    if (!deployment) {
      throw new NotFoundError('Deployment');
    }

    // Return empty stats if not running
    if (!deployment.containerId || deployment.status !== 'healthy') {
      res.json({
        success: true,
        data: {
          status: deployment.status as any,
          cpu: 0,
          memory: 0,
        },
      } as ApiResponse);
      return;
    }

    // Get actual stats
    const stats = await containerManager.getStats(deployment.containerId);

    res.json({
      success: true,
      data: {
        status: deployment.status as any,
        ...stats,
      },
    } as ApiResponse);
  } catch (error) {
    next(error);
  }
}

export default {
  getDeploymentDetails,
  getDeploymentStatus,
  getDeploymentLogs,
  getDeploymentStats,
};