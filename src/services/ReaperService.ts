import cron from 'node-cron';
import { Deployment } from '@models/Deployment';
import { dockerService } from './DockerService';
import { logger } from '@utils/logger';

export class ReaperService {
  start() {
    // Run every minute
    cron.schedule('* * * * *', async () => {
      logger.debug('Running Reaper Reconciliation...');
      await this.reconcileState();
    });
  }

  private async reconcileState() {
    // 1. Get all containers currently running in Docker
    const activeContainers = await dockerService.listContainers();
    const activeContainerIds = new Set(activeContainers.map(c => c.Id));

    // 2. Get all deployments that DB thinks are "healthy" or "starting"
    const supposedActiveDeployments = await Deployment.find({
      status: { $in: ['healthy', 'starting'] }
    });

    for (const deployment of supposedActiveDeployments) {
      // If DB says healthy, but Docker has no record of the container ID
      if (deployment.containerId && !activeContainerIds.has(deployment.containerId)) {
        logger.warn(`Reaper: Found zombie deployment ${deployment.subdomain}. Marking stopped.`);
        
        // Mark as error/stopped so UI updates
        deployment.status = 'error';
        deployment.errorMessage = 'Container died unexpectedly';
        deployment.containerId = undefined; 
        deployment.internalPort = undefined; // Release the port
        await deployment.save();
      }
    }
  }
}

export const reaperService = new ReaperService();