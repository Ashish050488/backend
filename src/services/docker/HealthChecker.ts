/**
 * Health Checker Service
 * Manages health checks for agent containers
 */

import net from 'net';
import { logger } from '@utils/logger';
import { AGENT } from '@utils/constants';

export class HealthChecker {
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start health checks for a deployment
   */
  public startHealthChecks(
    deploymentId: string,
    port: number,
    onHealthy: () => Promise<void>
  ): void {
    this.stopHealthChecks(deploymentId);

    logger.info('Starting health checks', { deploymentId, port });

    const interval = setInterval(async () => {
      const healthy = await this.checkContainerHealth(port);
      
      if (healthy) {
        logger.info('Container is healthy', { deploymentId, port });
        clearInterval(interval);
        this.healthCheckIntervals.delete(deploymentId);
        await onHealthy();
      } else {
        logger.debug('Health check failed, retrying...', { deploymentId, port });
      }
    }, AGENT.HEALTH_CHECK_INTERVAL);

    this.healthCheckIntervals.set(deploymentId, interval);

    // Set a timeout to stop checking after max timeout
    setTimeout(() => {
      if (this.healthCheckIntervals.has(deploymentId)) {
        logger.warn('Health check timeout reached', { deploymentId });
        this.stopHealthChecks(deploymentId);
      }
    }, AGENT.HEALTH_CHECK_TIMEOUT);
  }

  /**
   * Stop health checks for a deployment
   */
  public stopHealthChecks(deploymentId: string): void {
    const interval = this.healthCheckIntervals.get(deploymentId);
    
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(deploymentId);
      logger.debug('Health checks stopped', { deploymentId });
    }
  }

  /**
   * Stop all health checks
   */
  public stopAllHealthChecks(): void {
    this.healthCheckIntervals.forEach((interval, deploymentId) => {
      clearInterval(interval);
      logger.debug('Health check stopped', { deploymentId });
    });
    
    this.healthCheckIntervals.clear();
    logger.info('All health checks stopped');
  }

  /**
   * Check if container is healthy by attempting TCP connection
   */
  private async checkContainerHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      const onError = () => {
        socket.destroy();
        resolve(false);
      };

      socket.setTimeout(2000);
      socket.on('timeout', onError);
      socket.on('error', onError);
      
      socket.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true);
      });
    });
  }

  /**
   * Perform a single health check (useful for polling)
   */
  public async performHealthCheck(port: number): Promise<boolean> {
    return this.checkContainerHealth(port);
  }

  /**
   * Get number of active health checks
   */
  public getActiveHealthCheckCount(): number {
    return this.healthCheckIntervals.size;
  }

  /**
   * Check if health checks are running for deployment
   */
  public hasActiveHealthCheck(deploymentId: string): boolean {
    return this.healthCheckIntervals.has(deploymentId);
  }
}

export const healthChecker = new HealthChecker();
export default healthChecker;