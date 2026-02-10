/**
 * Container Manager Service
 * Handles container lifecycle operations (start, stop, restart, remove)
 */

import fs from 'fs/promises';
import path from 'path';
import { dockerClient } from './DockerClient';
import { configBuilder } from './ConfigBuilder';
import { healthChecker } from './HealthChecker';
import { imageManager } from './ImageManager';
import { logger } from '@utils/logger';
import { Deployment } from '@models/Deployment';
import { IDecryptedSecrets } from '../../types';
import { TIMEOUTS, DOCKER } from '@utils/constants';
import { ContainerError } from '@utils/errors';

export class ContainerManager {
  /**
   * Create and start a new container
   */
  public async createAndStart(
    deployment: InstanceType<typeof Deployment>,
    port: number,
    secrets: IDecryptedSecrets,
    model: string
  ): Promise<string> {
    const deploymentId = deployment._id.toString();
    const containerName = configBuilder.getContainerName(deploymentId);

    logger.info('Creating container', { deploymentId, containerName });

    try {
      // Ensure image exists
      await imageManager.ensureImageExists();

      // Build container config
      const containerConfig = configBuilder.buildContainerConfig(
        containerName,
        port,
        deploymentId,
        secrets,
        model
      );

      // Create container
      const container = await dockerClient.createContainer(containerConfig);
      const containerId = container.id;

      logger.info('Container created', { deploymentId, containerId });

      // Start container
      await dockerClient.startContainer(containerId);
      
      logger.info('Container started', { deploymentId, containerId });

      return containerId;
    } catch (error) {
      logger.error('Failed to create/start container', {
        deploymentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Stop a container
   */
  public async stop(deployment: InstanceType<typeof Deployment>): Promise<void> {
    if (!deployment.containerId) {
      logger.warn('No container to stop', { deploymentId: deployment._id });
      return;
    }

    const deploymentId = deployment._id.toString();
    
    // Stop health checks
    healthChecker.stopHealthChecks(deploymentId);

    try {
      await dockerClient.stopContainer(deployment.containerId, TIMEOUTS.CONTAINER_STOP);
      logger.info('Container stopped', { deploymentId, containerId: deployment.containerId });
    } catch (error) {
      if ((error as ContainerError).message?.includes('already stopped')) {
        logger.debug('Container already stopped', { deploymentId });
      } else {
        throw error;
      }
    }
  }

  /**
   * Restart a container
   */
  public async restart(deployment: InstanceType<typeof Deployment>): Promise<void> {
    if (!deployment.containerId) {
      throw new ContainerError('No container to restart', 'restart');
    }

    const deploymentId = deployment._id.toString();

    try {
      // Check if container exists
      const exists = await dockerClient.containerExists(deployment.containerId);
      
      if (!exists) {
        logger.warn('Container not found, cannot restart', { deploymentId });
        throw new ContainerError('Container not found', 'restart');
      }

      await dockerClient.restartContainer(deployment.containerId, TIMEOUTS.CONTAINER_RESTART);
      
      logger.info('Container restarted', { deploymentId, containerId: deployment.containerId });

      // Resume health checks
      if (deployment.internalPort) {
        healthChecker.startHealthChecks(deploymentId, deployment.internalPort, async () => {
          await deployment.transitionTo('healthy');
        });
      }
    } catch (error) {
      logger.error('Failed to restart container', {
        deploymentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Remove a container and its data
   */
  public async remove(deployment: InstanceType<typeof Deployment>): Promise<void> {
    if (!deployment.containerId) {
      logger.debug('No container to remove', { deploymentId: deployment._id });
      return;
    }

    const deploymentId = deployment._id.toString();
    
    // Stop health checks
    healthChecker.stopHealthChecks(deploymentId);

    try {
      // Remove container
      await dockerClient.removeContainer(deployment.containerId, true);
      
      logger.info('Container removed', { deploymentId, containerId: deployment.containerId });

      // Clean up data directory
      await this.cleanupDataDirectory(deploymentId);
      
    } catch (error) {
      if ((error as ContainerError).message?.includes('not found')) {
        logger.debug('Container does not exist', { deploymentId });
      } else {
        throw error;
      }
    }
  }

  /**
   * Get container logs
   */
  public async getLogs(
    deployment: InstanceType<typeof Deployment>,
    tail: number = 100
  ): Promise<string> {
    if (!deployment.containerId) {
      return 'No container available';
    }

    try {
      return await dockerClient.getContainerLogs(deployment.containerId, {
        tail,
        timestamps: true,
      });
    } catch (error) {
      return `Error fetching logs: ${(error as Error).message}`;
    }
  }

  /**
   * Get container stats
   */
  public async getStats(containerId: string): Promise<{ cpu: number; memory: number }> {
    try {
      await dockerClient.getContainerStats(containerId);
      // In production, you'd parse the stats here
      return { cpu: 0, memory: 0 };
    } catch (error) {
      logger.error('Failed to get container stats', {
        containerId,
        error: (error as Error).message,
      });
      return { cpu: 0, memory: 0 };
    }
  }

  /**
   * Clean up zombie container if exists
   */
  public async cleanupZombieContainer(deploymentId: string): Promise<void> {
    const containerName = configBuilder.getContainerName(deploymentId);

    try {
      const exists = await dockerClient.containerExists(containerName);
      
      if (exists) {
        logger.warn('Found zombie container, removing...', { containerName });
        await dockerClient.removeContainer(containerName, true);
        logger.info('Zombie container removed', { containerName });
      }
    } catch (error) {
      logger.error('Failed to cleanup zombie container', {
        containerName,
        error: (error as Error).message,
      });
    }
  }

  /**
   * List all containers with prefix
   */
  public async listManagedContainers(): Promise<any[]> {
    const allContainers = await dockerClient.listContainers({ all: true });
    
    return allContainers.filter(c => 
      c.Names.some(name => name.startsWith(`/${DOCKER.CONTAINER_PREFIX}`))
    );
  }

  /**
   * Clean up data directory for deployment
   */
  private async cleanupDataDirectory(deploymentId: string): Promise<void> {
    const dataDir = configBuilder.getDataDir(deploymentId);
    const configDir = configBuilder.getConfigDir(deploymentId);

    try {
      await fs.rm(path.dirname(dataDir), { recursive: true, force: true });
      logger.info('Data directory cleaned up', { deploymentId, dataDir });
    } catch (error) {
      logger.warn('Failed to cleanup data directory', {
        deploymentId,
        error: (error as Error).message,
      });
    }
  }
}

export const containerManager = new ContainerManager();
export default containerManager;