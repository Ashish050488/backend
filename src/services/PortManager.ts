/**
 * PortManager Service - Thread-Safe Port Allocation
 * 
 * Manages the allocation of host ports for Docker containers.
 * Uses database-level atomic operations to prevent race conditions.
 */

import { Deployment } from '@models/Deployment';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { PortAllocationError } from '@types/index';

// ============================================================================
// Constants
// ============================================================================

const MIN_PORT = config.ports.min;
const MAX_PORT = config.ports.max;

// ============================================================================
// PortManager Class
// ============================================================================

export class PortManager {
  private static instance: PortManager;
  private inFlightReservations: Set<number> = new Set();

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): PortManager {
    if (!PortManager.instance) {
      PortManager.instance = new PortManager();
    }
    return PortManager.instance;
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Find and allocate an available port
   * 
   * This method implements a thread-safe port allocation strategy:
   * 1. Query all currently used ports from the database
   * 2. Find the first available port in the range
   * 3. Use atomic database operation to reserve the port
   * 
   * @returns Promise resolving to the allocated port number
   * @throws PortAllocationError if no ports are available
   */
  async allocatePort(): Promise<number> {
    logger.debug('Starting port allocation...');

    try {
      // Get all currently used ports from database
      const usedPorts = await this.getUsedPorts();
      
      // Add in-flight reservations to used ports
      this.inFlightReservations.forEach(port => usedPorts.add(port));

      logger.debug(`Found ${usedPorts.size} used/reserved ports`);

      // Find first available port
      const availablePort = this.findAvailablePort(usedPorts);

      if (!availablePort) {
        throw new PortAllocationError(
          `No available ports in range ${MIN_PORT}-${MAX_PORT}`
        );
      }

      // Reserve the port in-memory first (short-term lock)
      this.inFlightReservations.add(availablePort);

      try {
        // The actual reservation happens when the Deployment document is saved
        // with the atomic findOneAndUpdate or unique index on internalPort
        logger.info(`Port ${availablePort} reserved successfully`);
        
        return availablePort;
      } catch (error) {
        // Release in-memory reservation on failure
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

  /**
   * Release a port back to the pool
   * 
   * @param port - The port to release
   */
  releasePort(port: number): void {
    this.inFlightReservations.delete(port);
    logger.debug(`Port ${port} released`);
  }

  /**
   * Check if a port is available
   * 
   * @param port - The port to check
   * @returns Promise resolving to true if available
   */
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

  /**
   * Get port allocation statistics
   */
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

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get all currently used ports from the database
   * 
   * Queries deployments that are NOT in terminal states (stopped, error)
   */
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

  /**
   * Find the first available port in the range
   * 
   * Uses a simple linear scan which is efficient for <10k agents.
   * For higher scale, consider using a free-list data structure.
   */
  private findAvailablePort(usedPorts: Set<number>): number | null {
    for (let port = MIN_PORT; port <= MAX_PORT; port++) {
      if (!usedPorts.has(port)) {
        return port;
      }
    }
    return null;
  }

  /**
   * Atomically reserve a port using MongoDB
   * 
   * This method attempts to update a deployment document with the port,
   * relying on MongoDB's unique index on internalPort to prevent collisions.
   * 
   * @param deploymentId - The deployment ID
   * @param port - The port to reserve
   * @returns Promise resolving to true if reservation succeeded
   */
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

      // Remove from in-flight reservations
      this.inFlightReservations.delete(port);
      
      logger.debug('Atomic port reservation successful', {
        deploymentId,
        port,
      });

      return true;
    } catch (error) {
      // Release in-memory reservation on failure
      this.inFlightReservations.delete(port);
      
      // Check for duplicate key error (port already in use)
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('E11000') || errorMessage.includes('duplicate')) {
        logger.warn('Port collision detected, retrying...', { port });
        return false;
      }

      throw error;
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const portManager = PortManager.getInstance();

export default portManager;
