import { Deployment } from '@models/Deployment';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { PortAllocationError } from '../types';

const MIN_PORT = config.ports.min;
const MAX_PORT = config.ports.max;

export class PortManager {
  private static instance: PortManager;
  private inFlightReservations: Set<number> = new Set();

  private constructor() {}

  public static getInstance(): PortManager {
    if (!PortManager.instance) {
      PortManager.instance = new PortManager();
    }
    return PortManager.instance;
  }

  async allocatePort(): Promise<number> {
    logger.debug('Starting port allocation...');

    try {
      const usedPorts = await this.getUsedPorts();
      
      this.inFlightReservations.forEach(port => usedPorts.add(port));

      logger.debug(`Found ${usedPorts.size} used/reserved ports`);

      const availablePort = this.findAvailablePort(usedPorts);

      if (!availablePort) {
        throw new PortAllocationError(
          `No available ports in range ${MIN_PORT}-${MAX_PORT}`
        );
      }

      this.inFlightReservations.add(availablePort);

      try {
        logger.info(`Port ${availablePort} reserved successfully`);
        
        return availablePort;
      } catch (error) {
        this.inFlightReservations.delete(availablePort);
        throw error;
      }
    } catch (error) {
      if (error instanceof PortAllocationError) {
        throw error;
      }
      
      logger.error('Port allocation failed', { error: (error as Error).message });
      throw new PortAllocationError(`Failed to allocate port: ${(error as Error).message}`);
    }
  }

  releasePort(port: number): void {
    this.inFlightReservations.delete(port);
    logger.debug(`Port ${port} released`);
  }

  async isPortAvailable(port: number): Promise<boolean> {
    if (port < MIN_PORT || port > MAX_PORT) {
      return false;
    }

    if (this.inFlightReservations.has(port)) {
      return false;
    }

    const usedPorts = await this.getUsedPorts();
    return !usedPorts.has(port);
  }

  async getStats(): Promise<{
    total: number;
    used: number;
    available: number;
    inFlight: number;
  }> {
    const usedPorts = await this.getUsedPorts();
    const total = MAX_PORT - MIN_PORT + 1;
    const used = usedPorts.size;
    const inFlight = this.inFlightReservations.size;

    return {
      total,
      used,
      available: total - used - inFlight,
      inFlight,
    };
  }

  private async getUsedPorts(): Promise<Set<number>> {
    const deployments = await Deployment.find({
      status: { $nin: ['stopped', 'error', 'idle'] },
      internalPort: { $exists: true, $ne: null },
    }).select('internalPort');

    const ports = new Set<number>();
    
    for (const deployment of deployments) {
      if (deployment.internalPort !== undefined) {
        ports.add(deployment.internalPort);
      }
    }

    return ports;
  }

  private findAvailablePort(usedPorts: Set<number>): number | null {
    for (let port = MIN_PORT; port <= MAX_PORT; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  async atomicReservePort(
    deploymentId: string, 
    port: number
  ): Promise<boolean> {
    try {
      const result = await Deployment.findOneAndUpdate(
        { 
          _id: deploymentId,
          status: 'configuring',
        },
        { 
          internalPort: port,
        },
        { 
          new: true,
          runValidators: true,
        }
      );

      if (!result) {
        logger.warn('Atomic port reservation failed - deployment not found or status changed', {
          deploymentId,
          port,
        });
        return false;
      }

      this.inFlightReservations.delete(port);
      
      logger.debug('Atomic port reservation successful', {
        deploymentId,
        port,
      });

      return true;
    } catch (error) {
      this.inFlightReservations.delete(port);
      
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('E11000') || errorMessage.includes('duplicate')) {
        logger.warn('Port collision detected, retrying...', { port });
        return false;
      }

      throw error;
    }
  }
}

export const portManager = PortManager.getInstance();

export default portManager;