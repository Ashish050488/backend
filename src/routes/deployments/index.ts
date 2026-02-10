/**
 * Deployment Routes
 * Main router that combines all deployment-related handlers
 */

import { Router } from 'express';
import { authenticateToken } from '@middleware/auth';
import {
  validateBody,
  validateParams,
  validateQuery,
  createDeploymentSchema,
  deploymentActionSchema,
  deploymentParamsSchema,
  paginationSchema,
} from '@middleware/validate';

// Import handlers
import { listDeployments } from './list.handler';
import { createDeployment } from './create.handler';
import { manageDeployment } from './manage.handler';
import {
  getDeploymentDetails,
  getDeploymentStatus,
  getDeploymentLogs,
  getDeploymentStats,
} from './monitor.handler';

const router = Router();

// ============================================================================
// List Deployments
// ============================================================================

router.get(
  '/',
  authenticateToken,
  validateQuery(paginationSchema),
  listDeployments
);

// ============================================================================
// Create Deployment
// ============================================================================

router.post(
  '/',
  authenticateToken,
  validateBody(createDeploymentSchema),
  createDeployment
);

// ============================================================================
// Get Deployment Details
// ============================================================================

router.get(
  '/:id',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  getDeploymentDetails
);

// ============================================================================
// Get Deployment Status (for polling)
// ============================================================================

router.get(
  '/:id/status',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  getDeploymentStatus
);

// ============================================================================
// Manage Deployment (start/stop/restart/remove)
// ============================================================================

router.post(
  '/:id/action',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  validateBody(deploymentActionSchema),
  manageDeployment
);

// ============================================================================
// Get Container Logs
// ============================================================================

router.get(
  '/:id/logs',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  getDeploymentLogs
);

// ============================================================================
// Get Container Stats
// ============================================================================

router.get(
  '/:id/stats',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  getDeploymentStats
);

export default router;