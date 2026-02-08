import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { portManager } from './PortManager';
import { Deployment } from '@models/Deployment';
import { ContainerConfig, IDecryptedSecrets } from '../types/index';
import net from 'net';

const AGENT_IMAGE = config.docker.agentImage;

// Force absolute path for Docker Bind Mounts
const ABSOLUTE_DATA_PATH = path.resolve(process.cwd(), config.docker.dataPath);

const CONTAINER_PREFIX = config.docker.containerPrefix;
const AGENT_PORT = config.agent.internalPort;
const MEMORY_LIMIT = config.agent.memoryLimit;
const CPU_LIMIT = config.agent.cpuLimit;

export class DockerService {
  private docker: Docker;
  private healthCheckIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    const socketVal = config.docker.socketPath;
    if (socketVal.startsWith('http')) {
      try {
        const url = new URL(socketVal);
        this.docker = new Docker({
          host: url.hostname,
          port: Number(url.port) || 2375,
          protocol: 'http'
        });
        logger.info(`Docker client initialized via TCP`, { host: url.hostname, port: url.port });
      } catch (e) {
        logger.error('Invalid Docker Socket URL', { socketVal });
        throw e;
      }
    } else {
      this.docker = new Docker({ socketPath: socketVal });
      logger.info(`Docker client initialized via Pipe/Socket`, { socketPath: socketVal });
    }
  }

  async spawnAgent(
    deployment: InstanceType<typeof Deployment>,
    secrets: IDecryptedSecrets
  ): Promise<string> {
    const deploymentId = deployment._id.toString();
    const subdomain = deployment.subdomain;

    logger.info('Spawning agent container', { deploymentId, subdomain });

    try {
      await deployment.transitionTo('configuring', { provisioningStep: 'Allocating resources...' });

      const port = await portManager.allocatePort();
      const reserved = await portManager.atomicReservePort(deploymentId, port);
      
      if (!reserved) {
        portManager.releasePort(port);
        return this.spawnAgent(deployment, secrets);
      }

      await deployment.transitionTo('configuring', { provisioningStep: 'Generating configuration...' });
      
      const configPath = await this.prepareAgentConfig(
        deploymentId,
        subdomain,
        secrets,
        deployment.config 
      );

      await deployment.transitionTo('provisioning', { provisioningStep: 'Pulling container image...' });
      await this.ensureImageExists(AGENT_IMAGE);

      await deployment.transitionTo('provisioning', { provisioningStep: 'Creating container...' });
      const containerName = `${CONTAINER_PREFIX}${deploymentId}`;
      
      const containerConfig = this.buildContainerConfig(
        containerName, 
        port, 
        configPath, 
        deploymentId,
        secrets
      );

      const container = await this.docker.createContainer(containerConfig);
      const containerId = container.id;

      deployment.containerId = containerId;
      await deployment.save();

      await deployment.transitionTo('starting', { provisioningStep: 'Starting agent...' });
      await container.start();
      
      this.startHealthChecks(deployment, port);

      return containerId;
    } catch (error) {
      logger.error("Spawn Error", error);
      await this.cleanupFailedDeployment(deployment);
      await deployment.transitionTo('error', { errorMessage: (error as Error).message });
      throw error;
    }
  }

  private async prepareAgentConfig(
    deploymentId: string,
    subdomain: string,
    secrets: IDecryptedSecrets,
    agentConfig: any
  ): Promise<string> {
    const configDir = path.join(ABSOLUTE_DATA_PATH, deploymentId, 'config');
    const configPath = path.join(configDir, 'openclaw.json');

    console.log(`[DEBUG] Creating config at: ${configPath}`);

    await fs.mkdir(configDir, { recursive: true });

    const openClawConfig = {
      agents: {
        defaults: {
          model: {
            primary: agentConfig.model, 
          },
          workspace: '/home/node/.openclaw/workspace'
        }
      },
      gateway: {
        port: AGENT_PORT,
        auth: {
          mode: 'token',
          token: secrets.webUiToken,
        },
      },
      channels: {
        telegram: secrets.telegramBotToken ? {
          enabled: true,
          dmPolicy: "open",
          groupPolicy: "open",
          allowFrom: ["*"] 
        } : { enabled: false }
      },
      plugins: {
        entries: {
          telegram: { 
            enabled: !!secrets.telegramBotToken 
          }
        }
      }
    };

    await fs.writeFile(configPath, JSON.stringify(openClawConfig, null, 2), { mode: 0o600 });

    if (process.platform !== 'win32') {
       try { await fs.chown(configDir, 1000, 1000); } catch (e) {}
    }

    return configDir;
  }

  private buildContainerConfig(
    name: string, 
    hostPort: number, 
    configDir: string, 
    deploymentId: string, 
    secrets: IDecryptedSecrets
  ): ContainerConfig {
    
    let bindConfigPath = configDir;
    const volumeName = `simpleclaw-vol-${deploymentId}`;

    const envVars = [
        `OPENCLAW_CONFIG_PATH=/config/openclaw.json`,
        `DEPLOYMENT_ID=${deploymentId}`,
        `NODE_ENV=production`,
        `OPENCLAW_GATEWAY_TOKEN=${secrets.webUiToken}`,
        `NODE_OPTIONS=--max-old-space-size=1536`
    ];

    // INJECT ALL API KEYS
    if (secrets.openaiApiKey) envVars.push(`OPENAI_API_KEY=${secrets.openaiApiKey}`);
    if (secrets.anthropicApiKey) envVars.push(`ANTHROPIC_API_KEY=${secrets.anthropicApiKey}`);
    if (secrets.googleApiKey) envVars.push(`GOOGLE_API_KEY=${secrets.googleApiKey}`); // GEMINI FIX
    
    if (secrets.telegramBotToken) {
        envVars.push(`TELEGRAM_TOKEN=${secrets.telegramBotToken}`);
        envVars.push(`TELEGRAM_BOT_TOKEN=${secrets.telegramBotToken}`);
        envVars.push(`OPENCLAW_TELEGRAM_TOKEN=${secrets.telegramBotToken}`);
        envVars.push(`CHANNELS_TELEGRAM_TOKEN=${secrets.telegramBotToken}`);
    }

    return {
      Image: AGENT_IMAGE,
      name,
      User: process.platform === 'win32' ? '0' : undefined,
      Env: envVars,
      HostConfig: {
        Binds: [
          `${bindConfigPath}:/config:rw`,
          `${volumeName}:/home/node/.openclaw`
        ],
        PortBindings: { [`${AGENT_PORT}/tcp`]: [{ HostPort: hostPort.toString() }] },
        Memory: MEMORY_LIMIT,
        NanoCpus: CPU_LIMIT,
        RestartPolicy: { Name: 'on-failure', MaximumRetryCount: config.agent.maxRestarts },
      },
      ExposedPorts: { [`${AGENT_PORT}/tcp`]: {} },
    };
  }

  async stopContainer(deployment: InstanceType<typeof Deployment>): Promise<void> {
    if (!deployment.containerId) return;
    this.stopHealthChecks(deployment._id.toString());
    try {
      const container = this.docker.getContainer(deployment.containerId);
      await container.stop({ t: 30 });
      await deployment.transitionTo('stopped');
    } catch (error: any) {
      if (error.statusCode === 304 || error.message.includes('not running')) {
        await deployment.transitionTo('stopped');
      } else {
        throw error;
      }
    }
  }

  async removeContainer(deployment: InstanceType<typeof Deployment>): Promise<void> {
    if (!deployment.containerId) return;
    this.stopHealthChecks(deployment._id.toString());
    try {
      const container = this.docker.getContainer(deployment.containerId);
      await container.remove({ force: true, v: true });
      const volume = this.docker.getVolume(`simpleclaw-vol-${deployment._id}`);
      await volume.remove().catch(() => {});
      await this.cleanupDataDirectory(deployment._id.toString());
      if (deployment.internalPort) portManager.releasePort(deployment.internalPort);
      deployment.containerId = undefined;
      deployment.internalPort = undefined;
      await deployment.save();
    } catch (error: any) {
      if (error.statusCode === 404) return;
      throw error;
    }
  }

  async restartContainer(deployment: InstanceType<typeof Deployment>): Promise<void> {
    if (!deployment.containerId) throw new Error('No container ID');
    await deployment.transitionTo('restarting');
    try {
      const container = this.docker.getContainer(deployment.containerId);
      await container.restart({ t: 30 });
      if (deployment.internalPort) this.startHealthChecks(deployment, deployment.internalPort);
    } catch (error: any) {
      await deployment.transitionTo('error', { errorMessage: error.message });
      throw error;
    }
  }

  async getContainerLogs(deployment: InstanceType<typeof Deployment>, tail = 100): Promise<string> {
    if (!deployment.containerId) return 'No container available';
    try {
      const container = this.docker.getContainer(deployment.containerId);
      const logs = await container.logs({ stdout: true, stderr: true, tail, timestamps: true });
      return logs.toString('utf-8');
    } catch (error: any) {
      return `Error fetching logs: ${error.message}`;
    }
  }

  async listContainers(): Promise<Docker.ContainerInfo[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers.filter(c => c.Names.some(name => name.startsWith(`/${CONTAINER_PREFIX}`)));
  }

  async getContainerStats(containerId: string): Promise<{ cpu: number; memory: number }> {
    try {
        const container = this.docker.getContainer(containerId);
        const stats = await container.stats({ stream: false });
        return { cpu: 0, memory: 0 }; 
    } catch (e) {
        return { cpu: 0, memory: 0 };
    }
  }

  private async ensureImageExists(image: string): Promise<void> {
    try {
      const images = await this.docker.listImages({ filters: { reference: [image] } });
      if (images.length > 0) return;
      const stream = await this.docker.pull(image);
      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err: any) => err ? reject(err) : resolve(true));
      });
    } catch (error) {
      throw error;
    }
  }

  private startHealthChecks(deployment: InstanceType<typeof Deployment>, port: number): void {
    const id = deployment._id.toString();
    this.stopHealthChecks(id);
    const interval = setInterval(async () => {
      const healthy = await this.checkContainerHealth(port);
      if (healthy) {
        clearInterval(interval);
        await deployment.transitionTo('healthy');
      }
    }, 2000);
    this.healthCheckIntervals.set(id, interval);
  }

  private stopHealthChecks(id: string): void {
    const interval = this.healthCheckIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(id);
    }
  }

  private async checkContainerHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const onError = () => { socket.destroy(); resolve(false); };
      socket.setTimeout(2000);
      socket.on('timeout', onError);
      socket.on('error', onError);
      socket.connect(port, '127.0.0.1', () => {
        socket.end();
        resolve(true); 
      });
    });
  }

  private async cleanupFailedDeployment(deployment: InstanceType<typeof Deployment>): Promise<void> {
    await this.removeContainer(deployment);
  }

  private async cleanupDataDirectory(id: string): Promise<void> {
    try {
      await fs.rm(path.join(ABSOLUTE_DATA_PATH, id), { recursive: true, force: true });
    } catch { }
  }
}

export const dockerService = new DockerService();
export default dockerService;