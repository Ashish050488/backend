/**
 * List Deployments Handler
 * GET /api/deployments - List all deployments for current user
 */

import { Request, Response, NextFunction } from 'express';
import { Deployment } from '@models/Deployment';
import { ApiResponse, DeploymentStatusResponse } from '../../types';
import { validatePagination } from '@utils/validation';
import { logger } from '@utils/logger';

export async function listDeployments(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    
    // Cast query parameters to string for validatePagination
    const page = typeof req.query.page === 'string' ? req.query.page : undefined;
    const limit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
    
    const { page: validatedPage, limit: validatedLimit, skip } = validatePagination(page, limit);

    logger.debug('Listing deployments', { userId, page: validatedPage, limit: validatedLimit });

    // Fetch deployments and total count in parallel
    const [deployments, total] = await Promise.all([
      Deployment.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(validatedLimit)
        .lean(),
      Deployment.countDocuments({ user: userId }),
    ]);

    // Format deployments for response
    const formattedDeployments: DeploymentStatusResponse[] = deployments.map((d) => ({
      id: d._id.toString(),
      subdomain: d.subdomain,
      status: d.status as any,
      url:
        d.status === 'healthy'
          ? process.env.NODE_ENV === 'development' && d.internalPort
            ? `http://localhost:${d.internalPort}`
            : `https://${d.subdomain}.${process.env.DOMAIN || 'localhost'}`
          : undefined,
      provisioningStep: d.provisioningStep,
      errorMessage: d.errorMessage,
      createdAt: (d.createdAt as Date).toISOString(),
      lastHeartbeat: d.lastHeartbeat ? (d.lastHeartbeat as Date).toISOString() : undefined,
    }));

    res.json({
      success: true,
      data: formattedDeployments,
      meta: {
        page: validatedPage,
        limit: validatedLimit,
        total,
        pages: Math.ceil(total / validatedLimit),
      },
    } as ApiResponse<DeploymentStatusResponse[]>);
  } catch (error) {
    next(error);
  }
}

export default listDeployments;