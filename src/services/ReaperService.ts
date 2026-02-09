import cron, { ScheduledTask } from 'node-cron'; // 1. Added Named Import for the type
import { Deployment } from '@models/Deployment';
import { dockerService } from './DockerService';
import { logger } from '@utils/logger';

export class ReaperService {
  private isRunning = false;
  private task: ScheduledTask | null = null; // 2. Updated type usage (removed 'cron.' prefix)

  start() {
    // Run every 5 minutes instead of every minute (reduces load)
    this.task = cron.schedule('*/5 * * * *', async () => {
      // Skip if previous reconciliation is still running
      if (this.isRunning) {
        logger.warn('Reaper: Skipping reconciliation - previous run still in progress');
        return;
      }

      this.isRunning = true;
      try {
        logger.debug('Running Reaper Reconciliation...');
        await this.reconcileState();
      } catch (error) {
        logger.error('Reaper reconciliation failed', {
          error: (error as Error).message,
        });
      } finally {
        this.isRunning = false;
      }
    });

    logger.info('Reaper Service started (runs every 5 minutes)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      logger.info('Reaper Service stopped');
    }
  }

  private async reconcileState() {
    try {
      // 1. Get all containers with timeout
      const activeContainers = await Promise.race([
        dockerService.listContainers(),
        this.timeout(10000, 'Docker list containers timed out')
      ]);

      const activeContainerIds = new Set(activeContainers.map(c => c.Id));

      // 2. Get deployments that should be running (with lean query for performance)
      const supposedActiveDeployments = await Deployment.find({
        status: { $in: ['healthy', 'starting'] },
        containerId: { $exists: true, $ne: null }
      })
        .select('_id subdomain containerId internalPort status')
        .lean()
        .exec();

      logger.debug('Reaper: Checking deployments', {
        activeContainers: activeContainerIds.size,
        supposedActive: supposedActiveDeployments.length,
      });

      // 3. Reconcile in batches to avoid blocking
      const batchSize = 5;
      for (let i = 0; i < supposedActiveDeployments.length; i += batchSize) {
        const batch = supposedActiveDeployments.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (deployment) => {
            // If DB says healthy but Docker doesn't have the container
            if (!activeContainerIds.has(deployment.containerId!)) {
              logger.warn('Reaper: Found zombie deployment', {
                id: deployment._id,
                subdomain: deployment.subdomain,
                containerId: deployment.containerId,
              });

              // Use updateOne for better performance
              await Deployment.updateOne(
                { _id: deployment._id },
                {
                  $set: {
                    status: 'error',
                    errorMessage: 'Container died unexpectedly',
                  },
                  $unset: {
                    containerId: '',
                    internalPort: '',
                  },
                }
              );
            }
          })
        );

        // Small delay between batches to prevent event loop blocking
        if (i + batchSize < supposedActiveDeployments.length) {
          await this.delay(100);
        }
      }

      logger.debug('Reaper: Reconciliation complete', {
        checked: supposedActiveDeployments.length,
      });
    } catch (error) {
      logger.error('Reaper: reconcileState error', {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // Helper: Create timeout promise
  private timeout(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  // Helper: Non-blocking delay
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const reaperService = new ReaperService();