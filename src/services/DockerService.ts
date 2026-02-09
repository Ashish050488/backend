import Docker from 'dockerode';
import fs from 'fs/promises';
import path from 'path';
import { config } from '@config/index';
import { logger } from '@utils/logger';
import { portManager } from './PortManager';
import { Deployment } from '@models/Deployment';
import { ContainerConfig, IDecryptedSecrets } from '../types';
import net from 'net';

const AGENT_IMAGE = config.docker.agentImage;
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
    const containerName = `${CONTAINER_PREFIX}${deploymentId}`;

    logger.info('Spawning agent container', { deploymentId, subdomain });

    try {
      // 1. Cleanup Old Containers
      try {
        const oldContainer = this.docker.getContainer(containerName);
        const inspect = await oldContainer.inspect();
        if (inspect) {
          logger.warn(`Found zombie container ${containerName}. Killing it...`);
          await oldContainer.remove({ force: true });
        }
      } catch (e: any) {
        if (e.statusCode !== 404) logger.error('Error clearing zombie:', e.message);
      }

      await Deployment.updateOne(
        { _id: deploymentId },
        { $unset: { internalPort: "", containerId: "" } }
      );

      await deployment.transitionTo('configuring', { provisioningStep: 'Allocating resources...' });

      // 2. Port Allocation
      const port = await portManager.allocatePort();
      const reserved = await portManager.atomicReservePort(deploymentId, port);

      if (!reserved) {
        logger.warn(`Atomic reservation failed. Forcing port ${port} assignment.`);
        await Deployment.updateOne({ _id: deploymentId }, { $set: { internalPort: port } });
      }

      await deployment.transitionTo('configuring', { provisioningStep: 'Generating configuration...' });

      await this.prepareAgentConfig(
        deploymentId,
        subdomain,
        secrets,
        deployment.config
      );

      await deployment.transitionTo('provisioning', { provisioningStep: 'Pulling image...' });
      await this.ensureImageExists(AGENT_IMAGE);

      await deployment.transitionTo('provisioning', { provisioningStep: 'Starting container...' });

      const containerConfig = this.buildContainerConfig(
        containerName,
        port,
        deploymentId,
        secrets
      );

      const container = await this.docker.createContainer(containerConfig);
      const containerId = container.id;

      deployment.containerId = containerId;
      deployment.internalPort = port;
      await deployment.save();

      await container.start();

      await deployment.transitionTo('starting', { provisioningStep: 'Health checking...' });
      this.startHealthChecks(deployment, port);

      return containerId;

    } catch (error: any) {
      logger.error("Spawn Error", { message: error.message });
      await this.cleanupFailedDeployment(deployment);

      if (error.message?.includes('port is already allocated')) {
        logger.warn(`Port collision detected. Retrying...`);
        return this.spawnAgent(deployment, secrets);
      }

      await deployment.transitionTo('error', { errorMessage: (error as Error).message });
      throw error;
    }
  }

  private async prepareAgentConfig(
    deploymentId: string,
    subdomain: string,
    secrets: IDecryptedSecrets,
    agentConfig: any
  ): Promise<void> {
    const configDir = path.join(ABSOLUTE_DATA_PATH, deploymentId, 'config');
    const dataDir = path.join(ABSOLUTE_DATA_PATH, deploymentId, 'data');
    const workspaceDir = path.join(dataDir, 'workspace', 'memory');
    await fs.mkdir(workspaceDir, { recursive: true });

    // Create initial memory file
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const memoryFile = path.join(workspaceDir, `${today}.md`);
    await fs.writeFile(memoryFile, `# Memory for ${today}\n\n`, { mode: 0o644 });

    logger.info('Created workspace memory structure', { workspaceDir });

    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });

    // --- 1. openclaw.json ---
    const configPath = path.join(configDir, 'openclaw.json');
    const gatewayToken = secrets.webUiToken || 'fallback-dev-token-xyz';

    // Use correct Google model names from OpenClaw's pi-ai catalog
    // Available Google models: google/gemini-3-pro-preview, google/gemini-2.0-flash-thinking-exp
    let modelStr = agentConfig.model || 'google/gemini-3-pro-preview';

    // Map common user inputs to actual catalog models
    const modelMapping: Record<string, string> = {
      'google/gemini-1.5-flash': 'google/gemini-3-pro-preview',
      'google/gemini-1.5-pro': 'google/gemini-3-pro-preview',
      'google/gemini-2.0-flash-exp': 'google/gemini-3-pro-preview',
      'google/gemini-flash': 'google/gemini-3-pro-preview',
    };

    if (modelMapping[modelStr]) {
      const originalModel = modelStr;
      modelStr = modelMapping[modelStr];
      logger.info('Mapped model to catalog version', {
        from: originalModel,
        to: modelStr
      });
    }

    const openClawConfig = {
      agents: {
        defaults: {
          model: { primary: modelStr },
          workspace: process.platform === 'win32' ? '/root/.openclaw/workspace' : '/home/node/.openclaw/workspace'
        }
      },
      gateway: {
        port: AGENT_PORT,
        auth: { mode: 'token', token: gatewayToken },
      },
      channels: {
        telegram: secrets.telegramBotToken ? {
          enabled: true,
          botToken: secrets.telegramBotToken,
          dmPolicy: "open",
          groupPolicy: "open",
          allowFrom: ["*"]
        } : { enabled: false }
      },
      plugins: {
        entries: { telegram: { enabled: !!secrets.telegramBotToken } }
      }
    };

    await fs.writeFile(configPath, JSON.stringify(openClawConfig, null, 2), { mode: 0o600 });
    logger.info('Wrote openclaw.json', { configPath, model: modelStr });

    // --- 2. auth-profiles.json (CRITICAL FIX) ---
    // OpenClaw expects auth-profiles.json in a specific structure:
    // Primary: ~/.openclaw/agents/<agentId>/agent/auth-profiles.json
    // Legacy: ~/.openclaw/agent/auth-profiles.json
    // Root fallback: ~/.openclaw/auth-profiles.json

    // Create the agent-specific auth directory
    const agentAuthDir = path.join(dataDir, 'agents', 'main', 'agent');
    await fs.mkdir(agentAuthDir, { recursive: true });

    // Build the auth profiles object with proper structure
    const authProfiles: any = {
      profiles: {},
      usageStats: {}
    };

    if (secrets.googleApiKey) {
      authProfiles.profiles['google:default'] = {
        type: 'api_key',
        provider: 'google',
        key: secrets.googleApiKey
      };
      logger.info('Added Google API key to auth profile', {
        keyLength: secrets.googleApiKey.length,
        keyPrefix: secrets.googleApiKey.substring(0, 10)
      });
    }

    if (secrets.anthropicApiKey) {
      authProfiles.profiles['anthropic:default'] = {
        type: 'api_key',
        provider: 'anthropic',
        key: secrets.anthropicApiKey
      };
      logger.info('Added Anthropic API key to auth profile');
    }

    if (secrets.openaiApiKey) {
      authProfiles.profiles['openai:default'] = {
        type: 'api_key',
        provider: 'openai',
        key: secrets.openaiApiKey
      };
      logger.info('Added OpenAI API key to auth profile');
    }

    // Write to the AGENT-SPECIFIC path (primary location)
    const authProfilePath = path.join(agentAuthDir, 'auth-profiles.json');
    await fs.writeFile(authProfilePath, JSON.stringify(authProfiles, null, 2), { mode: 0o600 });
    logger.info('Wrote auth-profiles.json to agent directory', {
      path: authProfilePath,
      providers: Object.keys(authProfiles.profiles),
    });

    // ALSO write to legacy location as fallback
    const legacyAuthDir = path.join(dataDir, 'agent');
    await fs.mkdir(legacyAuthDir, { recursive: true });
    const legacyAuthPath = path.join(legacyAuthDir, 'auth-profiles.json');
    await fs.writeFile(legacyAuthPath, JSON.stringify(authProfiles, null, 2), { mode: 0o600 });
    logger.info('Wrote auth-profiles.json to legacy location', { path: legacyAuthPath });

    // VERIFY: Read back the file to confirm it was written
    try {
      const writtenContent = await fs.readFile(authProfilePath, 'utf-8');
      const parsed = JSON.parse(writtenContent);
      logger.info('Verified auth-profiles.json was written correctly', {
        path: authProfilePath,
        profiles: Object.keys(parsed.profiles),
        hasGoogleProfile: !!parsed.profiles['google:default'],
      });
    } catch (error) {
      logger.error('Failed to verify auth-profiles.json', {
        error: (error as Error).message,
      });
    }

    // Fix permissions for Linux containers
    if (process.platform !== 'win32') {
      try {
        await fs.chown(configDir, 1000, 1000);
        await fs.chown(dataDir, 1000, 1000);
        await fs.chown(agentAuthDir, 1000, 1000);
        await fs.chown(authProfilePath, 1000, 1000);
        await fs.chown(legacyAuthDir, 1000, 1000);
        await fs.chown(legacyAuthPath, 1000, 1000);
      } catch (e) {
        logger.warn('Failed to chown directories', { error: (e as Error).message });
      }
    }

    logger.info('Agent config preparation complete', {
      configDir,
      dataDir,
      agentAuthDir,
      authProfilePath,
      legacyAuthPath,
    });
  }

  private buildContainerConfig(
    name: string,
    hostPort: number,
    deploymentId: string,
    secrets: IDecryptedSecrets
  ): ContainerConfig {

    const hostConfigPath = path.join(ABSOLUTE_DATA_PATH, deploymentId, 'config');
    const hostDataPath = path.join(ABSOLUTE_DATA_PATH, deploymentId, 'data');

    // CRITICAL: Map to /root/.openclaw for the container's internal path
    const internalDataPath = process.platform === 'win32' ? '/root/.openclaw' : '/home/node/.openclaw';
    const safeToken = secrets.webUiToken || 'fallback-dev-token-xyz';

    const envVars = [
      `OPENCLAW_CONFIG_PATH=/config/openclaw.json`,
      `DEPLOYMENT_ID=${deploymentId}`,
      `NODE_ENV=production`,
      `OPENCLAW_GATEWAY_TOKEN=${safeToken}`,
      `NODE_OPTIONS=--max-old-space-size=1536`
    ];

    // Add API keys as environment variables (fallback method)
    if (secrets.googleApiKey) {
      envVars.push(`GOOGLE_API_KEY=${secrets.googleApiKey}`);
      envVars.push(`GOOGLE_GENAI_API_KEY=${secrets.googleApiKey}`);
      logger.info('Added Google API key to container env vars');
    }

    if (secrets.anthropicApiKey) {
      envVars.push(`ANTHROPIC_API_KEY=${secrets.anthropicApiKey}`);
    }

    if (secrets.openaiApiKey) {
      envVars.push(`OPENAI_API_KEY=${secrets.openaiApiKey}`);
    }

    if (secrets.telegramBotToken) {
      envVars.push(`TELEGRAM_BOT_TOKEN=${secrets.telegramBotToken}`);
    }

    logger.info('Container config', {
      hostConfigPath,
      hostDataPath,
      internalDataPath,
      binds: [
        `${hostConfigPath}:/config:rw`,
        `${hostDataPath}:${internalDataPath}:rw`
      ],
    });

    return {
      Image: AGENT_IMAGE,
      name,
      User: process.platform === 'win32' ? '0' : undefined,
      Env: envVars,
      HostConfig: {
        Binds: [
          `${hostConfigPath}:/config:rw`,
          `${hostDataPath}:${internalDataPath}:rw`  // CRITICAL: Mount data directory
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
    if (!deployment.containerId) {
      logger.info('Restart requested (clean spawn)...', { id: deployment._id });
      deployment.internalPort = undefined;
      await deployment.save();

      const secrets = await deployment.decryptSecrets();
      await this.spawnAgent(deployment, secrets);
      return;
    }

    await deployment.transitionTo('restarting');
    try {
      const container = this.docker.getContainer(deployment.containerId);

      try {
        await container.inspect();
      } catch (e: any) {
        if (e.statusCode === 404) {
          logger.warn('Container missing. Respawning...', { id: deployment._id });
          deployment.containerId = undefined;
          deployment.internalPort = undefined;
          await deployment.save();

          const secrets = await deployment.decryptSecrets();
          await this.spawnAgent(deployment, secrets);
          return;
        }
        throw e;
      }

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
    if (deployment.containerId) {
      await this.removeContainer(deployment);
    }
  }

  private async cleanupDataDirectory(id: string): Promise<void> {
    try {
      await fs.rm(path.join(ABSOLUTE_DATA_PATH, id), { recursive: true, force: true });
    } catch { }
  }
}

export const dockerService = new DockerService();
export default dockerService;