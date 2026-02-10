/**
 * Deployment Orchestrator Service
 * High-level orchestration of deployment lifecycle
 */

import { Deployment } from '@models/Deployment';
import { portManager } from '../PortManager';
import { containerManager } from '../docker/ContainerManager';
import { configGenerator } from './ConfigGenerator';
import { stateManager } from './StateManager';
import { healthChecker } from '../docker/HealthChecker';
import { logger } from '@utils/logger';
import { IDecryptedSecrets } from '../../types';
import { DEPLOYMENT_STATES } from '@utils/constants';
import { validateAndNormalizeModel } from '@utils/validation';
import { PortAllocationError, DeploymentError } from '@utils/errors';

export class DeploymentOrchestrator {
  /**
   * Spawn a new agent deployment
   */
  public async spawnAgent(
    deployment: InstanceType<typeof Deployment>,
    secrets: IDecryptedSecrets,
    model?: string
  ): Promise<string> {
    const deploymentId = deployment._id.toString();
    const subdomain = deployment.subdomain;

    logger.info('Starting agent deployment', { deploymentId, subdomain });

    try {
      // Step 1: Cleanup any zombie containers
      await this.cleanupZombieResources(deployment);

      // Step 2: Transition to configuring state
      await stateManager.transitionTo(deployment, DEPLOYMENT_STATES.CONFIGURING, {
        provisioningStep: 'Allocating resources...',
      });

      // Step 3: Allocate port
      const port = await this.allocatePortForDeployment(deployment);

      // Step 4: Validate and normalize model
      const normalizedModel = validateAndNormalizeModel(model, secrets);

      // Step 5: Generate configuration files
      await stateManager.updateProvisioningStep(deployment, 'Generating configuration...');
      await configGenerator.generateConfigs(
        deploymentId,
        subdomain,
        secrets,
        normalizedModel,
        deployment.config?.systemPrompt as string
      );

      // Step 6: Provision container
      await stateManager.transitionTo(deployment, DEPLOYMENT_STATES.PROVISIONING, {
        provisioningStep: 'Pulling image...',
      });

      await stateManager.updateProvisioningStep(deployment, 'Starting container...');

      // Step 7: Create and start container
      const containerId = await containerManager.createAndStart(
        deployment,
        port,
        secrets,
        normalizedModel
      );

      // Step 8: Update deployment with container info
      deployment.containerId = containerId;
      deployment.internalPort = port;
      await deployment.save();

      // Step 9: Start health checks
      await stateManager.transitionTo(deployment, DEPLOYMENT_STATES.STARTING, {
        provisioningStep: 'Health checking...',
      });

      healthChecker.startHealthChecks(deploymentId, port, async () => {
        await stateManager.transitionTo(deployment, DEPLOYMENT_STATES.HEALTHY);
      });

      logger.info('Agent deployment initiated successfully', { deploymentId, containerId });

      return containerId;
    } catch (error) {
      logger.error('Agent deployment failed', {
        deploymentId,
        error: (error as Error).message,
      });

      // Cleanup on failure
      await this.handleDeploymentFailure(deployment, error as Error);

      throw error;
    }
  }

  /**
   * Stop a deployment
   */
  public async stopDeployment(deployment: InstanceType<typeof Deployment>): Promise<void> {
    const deploymentId = deployment._id.toString();

    logger.info('Stopping deployment', { deploymentId });

    // Check if can be stopped
    if (!stateManager.canStop(deployment.status as any)) {
      throw new DeploymentError(
        `Cannot stop deployment in ${deployment.status} state`,
        'INVALID_STATE'
      );
    }

    try {
      // Stop container
      await containerManager.stop(deployment);

      // Update state
      await stateManager.transitionTo(deployment, DEPLOYMENT_STATES.STOPPED);

      logger.info('Deployment stopped successfully', { deploymentId });
    } catch (error) {
      await stateManager.markAsError(deployment, (error as Error).message);
      throw error;
    }
  }

  /**
   * Restart a deployment
   */
  public async restartDeployment(deployment: InstanceType<typeof Deployment>): Promise<void> {
    const deploymentId = deployment._id.toString();

    logger.info('Restarting deployment', { deploymentId });

    try {
      // If no container exists, do a full respawn
      if (!deployment.containerId) {
        logger.info('No existing container, performing full respawn', { deploymentId });
        const secrets = await deployment.decryptSecrets();
        await this.spawnAgent(deployment, secrets, deployment.config?.model as string);
        return;
      }

      // Check if can be restarted
      if (!stateManager.canRestart(deployment.status as any)) {
        throw new DeploymentError(
          `Cannot restart deployment in ${deployment.status} state`,
          'INVALID_STATE'
        );
      }

      // Transition to restarting state
      await stateManager.transitionTo(deployment, DEPLOYMENT_STATES.RESTARTING);

      // Restart container
      await containerManager.restart(deployment);

      logger.info('Deployment restarted successfully', { deploymentId });
    } catch (error) {
      await stateManager.markAsError(deployment, (error as Error).message);
      throw error;
    }
  }

  /**
   * Remove a deployment completely
   */
  public async removeDeployment(deployment: InstanceType<typeof Deployment>): Promise<void> {
    const deploymentId = deployment._id.toString();

    logger.info('Removing deployment', { deploymentId });

    try {
      // Remove container and data
      await containerManager.remove(deployment);

      // Release port
      if (deployment.internalPort) {
        portManager.releasePort(deployment.internalPort);
      }

      // Clear deployment fields
      deployment.containerId = undefined;
      deployment.internalPort = undefined;
      await deployment.save();

      logger.info('Deployment removed successfully', { deploymentId });
    } catch (error) {
      logger.error('Failed to remove deployment', {
        deploymentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Allocate port for deployment
   */
  private async allocatePortForDeployment(
    deployment: InstanceType<typeof Deployment>
  ): Promise<number> {
    const deploymentId = deployment._id.toString();

    try {
      // Allocate port
      const port = await portManager.allocatePort();

      // Atomically reserve port
      const reserved = await portManager.atomicReservePort(deploymentId, port);

      if (!reserved) {
        logger.warn('Atomic reservation failed, forcing assignment', {
          deploymentId,
          port,
        });

        // Force update
        await Deployment.updateOne({ _id: deploymentId }, { $set: { internalPort: port } });
      }

      logger.info('Port allocated successfully', { deploymentId, port });

      return port;
    } catch (error) {
      throw new PortAllocationError(`Failed to allocate port: ${(error as Error).message}`);
    }
  }

  /**
   * Cleanup zombie resources
   */
  private async cleanupZombieResources(
    deployment: InstanceType<typeof Deployment>
  ): Promise<void> {
    const deploymentId = deployment._id.toString();

    // Cleanup zombie container
    await containerManager.cleanupZombieContainer(deploymentId);

    // Clear old deployment data
    await Deployment.updateOne(
      { _id: deploymentId },
      { $unset: { internalPort: '', containerId: '' } }
    );

    logger.debug('Zombie resources cleaned up', { deploymentId });
  }

  /**
   * Handle deployment failure
   */
  private async handleDeploymentFailure(
    deployment: InstanceType<typeof Deployment>,
    error: Error
  ): Promise<void> {
    const deploymentId = deployment._id.toString();

    logger.error('Handling deployment failure', { deploymentId, error: error.message });

    try {
      // Remove any created container
      if (deployment.containerId) {
        await containerManager.remove(deployment);
      }

      // Release port
      if (deployment.internalPort) {
        portManager.releasePort(deployment.internalPort);
      }

      // Check if it's a port collision error
      if (error.message?.includes('port is already allocated')) {
        logger.warn('Port collision detected, will retry on next attempt', { deploymentId });
      }

      // Mark as error
      await stateManager.markAsError(deployment, error.message);
    } catch (cleanupError) {
      logger.error('Error during cleanup', {
        deploymentId,
        error: (cleanupError as Error).message,
      });
    }
  }
}

export const deploymentOrchestrator = new DeploymentOrchestrator();
export default deploymentOrchestrator;