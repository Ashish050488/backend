/**
 * Deployment Routes
 * CRUD operations for agent deployments, lifecycle management,
 * and container operations.
 */

import { Router } from 'express';
import { Deployment } from '@models/Deployment';
import { User } from '@models/User';
import { dockerService } from '@services/DockerService';
import { authenticateToken } from '@middleware/auth';
import { 
  validateBody, 
  validateParams,
  createDeploymentSchema,
  deploymentActionSchema,
  deploymentParamsSchema,
  paginationSchema
} from '@middleware/validate';
import { cryptoService } from '@utils/crypto';
import { logger } from '@utils/logger';
import { ApiResponse, DeploymentStatusResponse } from '../types';
import { proxyManager } from '@middleware/proxy';

const router = Router();

// ============================================================================
// GET /api/deployments - List all deployments for current user
// ============================================================================

router.get(
  '/',
  authenticateToken,
  validateQuery(paginationSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      const [deployments, total] = await Promise.all([
        Deployment.find({ user: userId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Deployment.countDocuments({ user: userId }),
      ]);

      const formattedDeployments: DeploymentStatusResponse[] = deployments.map(d => ({
        id: d._id.toString(),
        subdomain: d.subdomain,
        status: d.status as any,
        url: d.status === 'healthy' 
          ? (process.env.NODE_ENV === 'development' && d.internalPort 
              ? `http://localhost:${d.internalPort}` 
              : `https://${d.subdomain}.${process.env.DOMAIN || 'localhost'}`)
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
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      } as ApiResponse<DeploymentStatusResponse[]>);

    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// POST /api/deployments - Create new deployment
// ============================================================================

router.post(
  '/',
  authenticateToken,
  validateBody(createDeploymentSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const { name, model, openaiApiKey, anthropicApiKey, googleApiKey, telegramBotToken } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          error: { code: 'USER_NOT_FOUND', message: 'User not found' } 
        });
      }

      const canCreate = await user.canCreateAgent();
      if (!canCreate.allowed) {
        return res.status(403).json({ 
          success: false, 
          error: { code: 'AGENT_LIMIT_REACHED', message: canCreate.reason } 
        });
      }

      const existing = await Deployment.findOne({ subdomain: name.toLowerCase() });
      if (existing) {
        return res.status(409).json({ 
          success: false, 
          error: { code: 'SUBDOMAIN_TAKEN', message: 'Name taken' } 
        });
      }

      // --- SMART MODEL DETECTION LOGIC START ---
      let selectedModel = model;

      // Model mapping for Google Gemini (use models from OpenClaw's pi-ai catalog)
      const modelMapping: Record<string, string> = {
        'google/gemini-1.5-flash': 'google/gemini-3-pro-preview',
        'google/gemini-1.5-pro': 'google/gemini-3-pro-preview',
        'google/gemini-2.0-flash-exp': 'google/gemini-3-pro-preview',
        'google/gemini-flash': 'google/gemini-3-pro-preview',
      };

      // 1. Smart Fallback: If no model selected, pick based on available key
      if (!selectedModel) {
        if (googleApiKey) selectedModel = 'google/gemini-3-pro-preview';
        else if (anthropicApiKey) selectedModel = 'anthropic/claude-3-5-sonnet';
        else if (openaiApiKey) selectedModel = 'openai/gpt-4o';
      }

      // 2. Map deprecated/alias model names to actual catalog models
      if (modelMapping[selectedModel]) {
        const originalModel = selectedModel;
        selectedModel = modelMapping[selectedModel];
        logger.info('Mapped model to catalog version', {
          from: originalModel,
          to: selectedModel
        });
      }

      // 3. Safety Check: Ensure the model matches the key provided
      if (selectedModel?.startsWith('google') && !googleApiKey) {
         return res.status(400).json({ 
           success: false, 
           error: { 
             code: 'MISCONFIG', 
             message: 'Selected Gemini but missing Google API Key' 
           } 
         });
      }
      if (selectedModel?.startsWith('anthropic') && !anthropicApiKey) {
         return res.status(400).json({ 
           success: false, 
           error: { 
             code: 'MISCONFIG', 
             message: 'Selected Claude but missing Anthropic API Key' 
           } 
         });
      }
      if (selectedModel?.startsWith('openai') && !openaiApiKey) {
         return res.status(400).json({ 
           success: false, 
           error: { 
             code: 'MISCONFIG', 
             message: 'Selected OpenAI but missing OpenAI API Key' 
           } 
         });
      }

      // 4. Final Fallback
      if (!selectedModel) {
         return res.status(400).json({ 
           success: false, 
           error: { 
             code: 'MODEL_REQUIRED', 
             message: 'Could not determine model from inputs' 
           } 
         });
      }
      // --- SMART MODEL DETECTION LOGIC END ---

      // Global Key Check
      if (!openaiApiKey && !anthropicApiKey && !googleApiKey) {
        return res.status(400).json({ 
          success: false, 
          error: { 
            code: 'API_KEY_REQUIRED', 
            message: 'Provide at least one API key.' 
          } 
        });
      }

      const webUiToken = cryptoService.generateToken(32);

      const deployment = new Deployment({
        user: userId,
        subdomain: name.toLowerCase(),
        status: 'idle',
        secrets: {
          openaiApiKey: openaiApiKey || undefined,
          anthropicApiKey: anthropicApiKey || undefined,
          googleApiKey: googleApiKey || undefined,
          telegramBotToken: telegramBotToken || undefined,
          webUiToken,
        },
        config: {
          model: selectedModel, // Use the smart detected/corrected model
          systemPrompt: 'You are a helpful AI assistant.'
        },
      });

      await deployment.save();

      setImmediate(async () => {
        try {
          const secrets = await deployment.decryptSecrets();
          await dockerService.spawnAgent(deployment, secrets);
        } catch (error) {
          logger.error('Async spawn failed', { error: (error as Error).message });
          await deployment.transitionTo('error', { errorMessage: (error as Error).message });
        }
      });

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
);

// ============================================================================
// GET /api/deployments/:id - Get deployment details
// ============================================================================

router.get(
  '/:id',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const deployment = await Deployment.findOne({
        _id: id,
        user: userId,
      });

      if (!deployment) {
        res.status(404).json({
          success: false,
          error: {
            code: 'DEPLOYMENT_NOT_FOUND',
            message: 'Deployment not found',
          },
        } as ApiResponse);
        return;
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
);

// ============================================================================
// GET /api/deployments/:id/status - Get deployment status (for polling)
// ============================================================================

router.get(
  '/:id/status',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const deployment = await Deployment.findOne({
        _id: id,
        user: userId,
      });

      if (!deployment) {
        res.status(404).json({
          success: false,
          error: {
            code: 'DEPLOYMENT_NOT_FOUND',
            message: 'Deployment not found',
          },
        } as ApiResponse);
        return;
      }

      res.json({
        success: true,
        data: {
          id: deployment._id.toString(),
          status: deployment.status as any,
          provisioningStep: deployment.provisioningStep,
          errorMessage: deployment.errorMessage,
          url: deployment.status === 'healthy' 
            ? deployment.getUrl() 
            : undefined,
        },
      } as ApiResponse);

    } catch (error) {
      next(error);
    }
  }
);

// ============================================================================
// POST /api/deployments/:id/action - Perform action on deployment
// ============================================================================

router.post(
  '/:id/action',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  validateBody(deploymentActionSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const { action } = req.body;

      const deployment = await Deployment.findOne({
        _id: id,
        user: userId,
      });

      if (!deployment) {
        res.status(404).json({
          success: false,
          error: {
            code: 'DEPLOYMENT_NOT_FOUND',
            message: 'Deployment not found',
          },
        } as ApiResponse);
        return;
      }

      logger.info(`Performing action: ${action}`, {
        deploymentId: id,
        userId,
      });

      switch (action) {
        case 'start':
          if (deployment.status === 'stopped' || deployment.status === 'error') {
            const secrets = await deployment.decryptSecrets();
            await dockerService.spawnAgent(deployment, secrets);
          } else {
            res.status(400).json({
              success: false,
              error: {
                code: 'INVALID_ACTION',
                message: `Cannot start deployment in ${deployment.status} state`,
              },
            } as ApiResponse);
            return;
          }
          break;

        case 'stop':
          if (deployment.status === 'healthy' || deployment.status === 'starting') {
            await dockerService.stopContainer(deployment);
          } else {
            res.status(400).json({
              success: false,
              error: {
                code: 'INVALID_ACTION',
                message: `Cannot stop deployment in ${deployment.status} state`,
              },
            } as ApiResponse);
            return;
          }
          break;

        case 'restart':
          if (deployment.status === 'healthy') {
            await dockerService.restartContainer(deployment);
          } else {
            res.status(400).json({
              success: false,
              error: {
                code: 'INVALID_ACTION',
                message: `Cannot restart deployment in ${deployment.status} state`,
              },
            } as ApiResponse);
            return;
          }
          break;

        case 'remove':
          if (deployment.containerId) {
            await dockerService.removeContainer(deployment);
          }
          
          await Deployment.findByIdAndDelete(id);
          proxyManager.clearCache(deployment.subdomain);
          
          res.json({
            success: true,
            data: { message: 'Deployment removed successfully' },
          } as ApiResponse);
          return;

        default:
          res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_ACTION',
              message: `Unknown action: ${action}`,
            },
          } as ApiResponse);
          return;
      }

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
);

// ============================================================================
// GET /api/deployments/:id/logs - Get container logs
// ============================================================================

router.get(
  '/:id/logs',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const tail = parseInt(req.query.tail as string) || 100;

      const deployment = await Deployment.findOne({
        _id: id,
        user: userId,
      });

      if (!deployment) {
        res.status(404).json({
          success: false,
          error: {
            code: 'DEPLOYMENT_NOT_FOUND',
            message: 'Deployment not found',
          },
        } as ApiResponse);
        return;
      }

      const logs = await dockerService.getContainerLogs(deployment, tail);

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
);

// ============================================================================
// GET /api/deployments/:id/stats - Get container stats
// ============================================================================

router.get(
  '/:id/stats',
  authenticateToken,
  validateParams(deploymentParamsSchema),
  async (req: any, res, next) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const deployment = await Deployment.findOne({
        _id: id,
        user: userId,
      });

      if (!deployment) {
        res.status(404).json({
          success: false,
          error: {
            code: 'DEPLOYMENT_NOT_FOUND',
            message: 'Deployment not found',
          },
        } as ApiResponse);
        return;
      }

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

      const stats = await dockerService.getContainerStats(deployment.containerId);

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
);

// Helper for validateQuery
function validateQuery(schema: any) {
  return (req: any, res: any, next: any) => {
    next();
  };
}

export default router;