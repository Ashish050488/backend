/**
 * Docker Client
 * Low-level wrapper around Dockerode with connection management
 */

import Docker from 'dockerode';
import { logger } from '@utils/logger';
import { DOCKER } from '@utils/constants';
import { ContainerError } from '@utils/errors';

function normalizeSocketPath(socketVal: string): string {
  // dockerode expects raw socket paths (no scheme)
  // - "unix:///var/run/docker.sock" => "/var/run/docker.sock"
  if (socketVal.startsWith('unix://')) {
    return socketVal.replace('unix://', '');
  }
  return socketVal;
}

export class DockerClient {
  private static instance: DockerClient;
  private docker: Docker;

  private constructor() {
    this.docker = this.initializeDocker();
  }

  public static getInstance(): DockerClient {
    if (!DockerClient.instance) {
      DockerClient.instance = new DockerClient();
    }
    return DockerClient.instance;
  }

  private initializeDocker(): Docker {
    const socketVal = DOCKER.SOCKET_PATH;

    // TCP mode
    if (socketVal.startsWith('http://') || socketVal.startsWith('https://')) {
      try {
        const url = new URL(socketVal);
        const docker = new Docker({
          host: url.hostname,
          port: Number(url.port) || 2375,
          protocol: url.protocol.replace(':', '') as 'http' | 'https',
        });

        logger.info('Docker client initialized via TCP', {
          host: url.hostname,
          port: url.port || '2375',
          protocol: url.protocol,
        });

        return docker;
      } catch (error) {
        logger.error('Invalid Docker Socket URL', { socketVal });
        throw error;
      }
    }

    // Socket mode (Linux)
    const normalized = normalizeSocketPath(socketVal);
    const docker = new Docker({ socketPath: normalized });
    logger.info('Docker client initialized via Socket', { socketPath: normalized });
    return docker;
  }

  public getClient(): Docker {
    return this.docker;
  }

  public getContainer(idOrName: string): Docker.Container {
    return this.docker.getContainer(idOrName);
  }

  public async listContainers(options?: Docker.ContainerListOptions): Promise<Docker.ContainerInfo[]> {
    try {
      return await this.docker.listContainers(options);
    } catch (error) {
      logger.error('Failed to list containers', { error: (error as Error).message });
      throw new ContainerError('Failed to list containers', 'list');
    }
  }

  public async createContainer(options: Docker.ContainerCreateOptions): Promise<Docker.Container> {
    try {
      return await this.docker.createContainer(options);
    } catch (error) {
      logger.error('Failed to create container', { error: (error as Error).message });
      throw new ContainerError('Failed to create container', 'create');
    }
  }

  public async pullImage(image: string): Promise<void> {
    try {
      const stream = await this.docker.pull(image);

      await new Promise<void>((resolve, reject) => {
        this.docker.modem.followProgress(
          stream,
          (err: any) => (err ? reject(err) : resolve()),
          (event: any) => {
            if (event.status) {
              logger.debug('Image pull progress', {
                image,
                status: event.status,
                progress: event.progress,
              });
            }
          }
        );
      });

      logger.info('Image pulled successfully', { image });
    } catch (error) {
      logger.error('Failed to pull image', {
        image,
        error: (error as Error).message,
      });
      throw new ContainerError(`Failed to pull image ${image}`, 'pull');
    }
  }

  public async listImages(options?: any): Promise<Docker.ImageInfo[]> {
    try {
      const images = await this.docker.listImages(options);
      return images as unknown as Docker.ImageInfo[];
    } catch (error) {
      logger.error('Failed to list images', { error: (error as Error).message });
      throw new ContainerError('Failed to list images', 'list');
    }
  }

  public async inspectContainer(idOrName: string): Promise<Docker.ContainerInspectInfo> {
    try {
      const container = this.getContainer(idOrName);
      return await container.inspect();
    } catch (error) {
      const err = error as any;
      if (err.statusCode === 404) {
        throw new ContainerError(`Container ${idOrName} not found`, 'inspect');
      }

      logger.error('Failed to inspect container', {
        container: idOrName,
        error: err.message,
      });
      throw new ContainerError('Failed to inspect container', 'inspect');
    }
  }

  public async startContainer(idOrName: string): Promise<void> {
    try {
      const container = this.getContainer(idOrName);
      await container.start();
      logger.info('Container started', { container: idOrName });
    } catch (error) {
      const err = error as any;
      if (err.statusCode === 304) {
        logger.debug('Container already started', { container: idOrName });
        return;
      }

      logger.error('Failed to start container', {
        container: idOrName,
        error: err.message,
      });
      throw new ContainerError('Failed to start container', 'start');
    }
  }

  public async stopContainer(idOrName: string, timeout: number = 30): Promise<void> {
    try {
      const container = this.getContainer(idOrName);
      await container.stop({ t: timeout });
      logger.info('Container stopped', { container: idOrName });
    } catch (error) {
      const err = error as any;
      if (err.statusCode === 304 || err.message?.includes('not running')) {
        logger.debug('Container already stopped', { container: idOrName });
        return;
      }

      logger.error('Failed to stop container', {
        container: idOrName,
        error: err.message,
      });
      throw new ContainerError('Failed to stop container', 'stop');
    }
  }

  public async restartContainer(idOrName: string, timeout: number = 30): Promise<void> {
    try {
      const container = this.getContainer(idOrName);
      await container.restart({ t: timeout });
      logger.info('Container restarted', { container: idOrName });
    } catch (error) {
      logger.error('Failed to restart container', {
        container: idOrName,
        error: (error as Error).message,
      });
      throw new ContainerError('Failed to restart container', 'restart');
    }
  }

  public async removeContainer(idOrName: string, force: boolean = true): Promise<void> {
    try {
      const container = this.getContainer(idOrName);
      await container.remove({ force, v: true });
      logger.info('Container removed', { container: idOrName });
    } catch (error) {
      const err = error as any;
      if (err.statusCode === 404) {
        logger.debug('Container does not exist', { container: idOrName });
        return;
      }

      logger.error('Failed to remove container', {
        container: idOrName,
        error: err.message,
      });
      throw new ContainerError('Failed to remove container', 'remove');
    }
  }

  public async getContainerLogs(
    idOrName: string,
    options: { tail?: number; timestamps?: boolean } = {}
  ): Promise<string> {
    try {
      const container = this.getContainer(idOrName);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: options.tail || 100,
        timestamps: options.timestamps !== false,
      });

      return logs.toString('utf-8');
    } catch (error) {
      logger.error('Failed to get container logs', {
        container: idOrName,
        error: (error as Error).message,
      });
      return `Error fetching logs: ${(error as Error).message}`;
    }
  }

  public async getContainerStats(idOrName: string): Promise<any> {
    try {
      const container = this.getContainer(idOrName);
      return await container.stats({ stream: false });
    } catch (error) {
      logger.error('Failed to get container stats', {
        container: idOrName,
        error: (error as Error).message,
      });
      throw new ContainerError('Failed to get container stats', 'stats');
    }
  }

  public async containerExists(idOrName: string): Promise<boolean> {
    try {
      await this.inspectContainer(idOrName);
      return true;
    } catch (error) {
      if ((error as ContainerError).operation === 'inspect') {
        return false;
      }
      throw error;
    }
  }

  public async imageExists(image: string): Promise<boolean> {
    try {
      const images = await this.listImages({ filters: { reference: [image] } });
      return images.length > 0;
    } catch {
      return false;
    }
  }
}

export const dockerClient = DockerClient.getInstance();
export default dockerClient;
