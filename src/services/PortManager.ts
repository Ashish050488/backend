import net from 'net';
import { Deployment } from '@models/Deployment';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { PortAllocationError } from '../types';

// IMPORTANT: import Docker client to detect published ports
import { dockerClient } from './docker/DockerClient';

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

  /**
   * Allocate a host port that is:
   * 1) Not in use by active deployments in Mongo
   * 2) Not reserved in this process (inFlight)
   * 3) Not currently published by any Docker container
   * 4) Actually bindable on the OS (host port free)
   */
  async allocatePort(): Promise<number> {
    logger.debug('Starting port allocation...');

    try {
      const usedPorts = await this.getUsedPortsFromDb();
      this.inFlightReservations.forEach((p) => usedPorts.add(p));

      // Also include ports published by existing Docker containers
      const dockerPorts = await this.getUsedPortsFromDocker();
      dockerPorts.forEach((p) => usedPorts.add(p));

      logger.debug(`Found ${usedPorts.size} used/reserved ports (db + inflight + docker)`);

      // Sweep range and pick the first host-port that is truly available
      for (let port = MIN_PORT; port <= MAX_PORT; port++) {
        if (usedPorts.has(port)) continue;

        // Mark inflight early to reduce races inside this process
        this.inFlightReservations.add(port);

        try {
          const ok = await this.isPortTrulyFreeOnHost(port);
          if (!ok) {
            this.inFlightReservations.delete(port);
            continue;
          }

          logger.info(`Port ${port} reserved successfully`);
          return port;
        } catch (e) {
          this.inFlightReservations.delete(port);
          throw e;
        }
      }

      throw new PortAllocationError(`No available ports in range ${MIN_PORT}-${MAX_PORT}`);
    } catch (error) {
      if (error instanceof PortAllocationError) throw error;

      logger.error('Port allocation failed', { error: (error as Error).message });
      throw new PortAllocationError(`Failed to allocate port: ${(error as Error).message}`);
    }
  }

  releasePort(port: number): void {
    this.inFlightReservations.delete(port);
    logger.debug(`Port ${port} released`);
  }

  async isPortAvailable(port: number): Promise<boolean> {
    if (port < MIN_PORT || port > MAX_PORT) return false;
    if (this.inFlightReservations.has(port)) return false;

    const usedPorts = await this.getUsedPortsFromDb();
    const dockerPorts = await this.getUsedPortsFromDocker();

    if (usedPorts.has(port) || dockerPorts.has(port)) return false;

    return this.isPortTrulyFreeOnHost(port);
  }

  async getStats(): Promise<{
    total: number;
    used: number;
    available: number;
    inFlight: number;
    dockerPublished: number;
  }> {
    const usedPorts = await this.getUsedPortsFromDb();
    const dockerPorts = await this.getUsedPortsFromDocker();

    const total = MAX_PORT - MIN_PORT + 1;
    const inFlight = this.inFlightReservations.size;

    // Treat dockerPorts as used too
    const usedCombined = new Set<number>([...usedPorts, ...dockerPorts]);
    this.inFlightReservations.forEach((p) => usedCombined.add(p));

    return {
      total,
      used: usedCombined.size,
      available: total - usedCombined.size,
      inFlight,
      dockerPublished: dockerPorts.size,
    };
  }

  /**
   * DB ports currently assigned to "active" deployments.
   * Adjust statuses if your app uses different lifecycle values.
   */
  private async getUsedPortsFromDb(): Promise<Set<number>> {
    const deployments = await Deployment.find({
      status: { $nin: ['stopped', 'error', 'idle'] },
      internalPort: { $exists: true, $ne: null },
    }).select('internalPort');

    const ports = new Set<number>();
    for (const d of deployments) {
      if (d.internalPort !== undefined && d.internalPort !== null) {
        ports.add(d.internalPort);
      }
    }
    return ports;
  }

  /**
   * Ports published by Docker containers (HostPort).
   * This prevents collisions when a container exists but DB doesn’t reflect it.
   */
  private async getUsedPortsFromDocker(): Promise<Set<number>> {
    const ports = new Set<number>();

    try {
      const containers = await dockerClient.listContainers({ all: true });

      for (const c of containers) {
        // Dockerode returns Ports like:
        // [{ IP: '127.0.0.1', PrivatePort: 18789, PublicPort: 20000, Type: 'tcp' }]
        if (!c.Ports) continue;
        for (const p of c.Ports) {
          if (typeof (p as any).PublicPort === 'number') {
            const pub = (p as any).PublicPort as number;
            if (pub >= MIN_PORT && pub <= MAX_PORT) ports.add(pub);
          }
        }
      }
    } catch (e) {
      // If Docker is temporarily unavailable, don’t block allocation;
      // OS bind check will still protect you.
      logger.warn('Failed to read Docker published ports; falling back to OS check only', {
        error: (e as Error).message,
      });
    }

    return ports;
  }

  /**
   * True host-level check: can we bind this port?
   * Uses 127.0.0.1 to match your Docker publish IP, and also tries 0.0.0.0 for safety.
   */
  private async isPortTrulyFreeOnHost(port: number): Promise<boolean> {
    const tryBind = (host: string) =>
      new Promise<boolean>((resolve) => {
        const server = net.createServer();

        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });

        server.listen(port, host);
      });

    // If either bind fails, treat as not free (more conservative, avoids Docker bind errors)
    const loopbackOk = await tryBind('127.0.0.1');
    if (!loopbackOk) return false;

    const anyOk = await tryBind('0.0.0.0');
    if (!anyOk) return false;

    return true;
  }

  /**
   * Writes the chosen port into the Deployment doc, only if still in configuring state.
   * Also re-check OS availability right before commit to reduce race conditions.
   */
  async atomicReservePort(deploymentId: string, port: number): Promise<boolean> {
    try {
      // Final safety check before committing the port to DB
      const stillFree = await this.isPortTrulyFreeOnHost(port);
      if (!stillFree) {
        this.inFlightReservations.delete(port);
        logger.warn('Atomic reserve aborted: port not free on host', { deploymentId, port });
        return false;
      }

      const result = await Deployment.findOneAndUpdate(
        { _id: deploymentId, status: 'configuring' },
        { internalPort: port },
        { new: true, runValidators: true }
      );

      if (!result) {
        logger.warn('Atomic port reservation failed - deployment not found or status changed', {
          deploymentId,
          port,
        });
        return false;
      }

      this.inFlightReservations.delete(port);

      logger.debug('Atomic port reservation successful', { deploymentId, port });
      return true;
    } catch (error) {
      this.inFlightReservations.delete(port);

      const msg = (error as Error).message;
      if (msg.includes('E11000') || msg.includes('duplicate')) {
        logger.warn('Port collision detected at DB layer, retrying...', { port });
        return false;
      }

      throw error;
    }
  }
}

export const portManager = PortManager.getInstance();
export default portManager;
