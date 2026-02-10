/**
 * Container Configuration Builder
 * Builds Docker container configurations for agent deployments
 */

import path from 'path';
import { DOCKER, AGENT, DEFAULTS } from '@utils/constants';
import { IDecryptedSecrets, ContainerConfig } from '../../types';
import { logger } from '@utils/logger';

export class ConfigBuilder {
  private readonly dataPath: string;

  constructor() {
    this.dataPath = path.resolve(process.cwd(), DOCKER.DATA_PATH);
  }

  /**
   * Build complete container configuration
   */
  public buildContainerConfig(
    containerName: string,
    hostPort: number,
    deploymentId: string,
    secrets: IDecryptedSecrets,
    model: string
  ): ContainerConfig {
    const env = this.buildEnvironmentVariables(deploymentId, secrets, model);
    const binds = this.buildVolumeMounts(deploymentId);
    const hostConfig = this.buildHostConfig(hostPort, binds);

    logger.debug('Building container config', {
      containerName,
      hostPort,
      deploymentId,
      model,
    });

    return {
      Image: DOCKER.AGENT_IMAGE,
      name: containerName,
      User: this.getUserConfig(),
      Env: env,
      HostConfig: hostConfig,
      ExposedPorts: { [`${AGENT.INTERNAL_PORT}/tcp`]: {} },
    };
  }

  /**
   * Build environment variables array
   */
  private buildEnvironmentVariables(
    deploymentId: string,
    secrets: IDecryptedSecrets,
    model: string
  ): string[] {
    const safeToken = secrets.webUiToken || DEFAULTS.FALLBACK_TOKEN;

    const env = [
      `OPENCLAW_CONFIG_PATH=/config/openclaw.json`,
      `DEPLOYMENT_ID=${deploymentId}`,
      `NODE_ENV=production`,
      `OPENCLAW_GATEWAY_TOKEN=${safeToken}`,
      `NODE_OPTIONS=--max-old-space-size=1536`,
    ];

    // Add API keys
    if (secrets.googleApiKey) {
      env.push(`GOOGLE_API_KEY=${secrets.googleApiKey}`);
      env.push(`GOOGLE_GENAI_API_KEY=${secrets.googleApiKey}`);
      logger.debug('Added Google API key to env vars');
    }

    if (secrets.anthropicApiKey) {
      env.push(`ANTHROPIC_API_KEY=${secrets.anthropicApiKey}`);
      logger.debug('Added Anthropic API key to env vars');
    }

    if (secrets.openaiApiKey) {
      env.push(`OPENAI_API_KEY=${secrets.openaiApiKey}`);
      logger.debug('Added OpenAI API key to env vars');
    }

    if (secrets.telegramBotToken) {
      env.push(`TELEGRAM_BOT_TOKEN=${secrets.telegramBotToken}`);
      logger.debug('Added Telegram token to env vars');
    }

    return env;
  }

  /**
   * Build volume mount bindings
   */
  private buildVolumeMounts(deploymentId: string): string[] {
    const hostConfigPath = path.join(this.dataPath, deploymentId, 'config');
    const hostDataPath = path.join(this.dataPath, deploymentId, 'data');
    const internalDataPath = this.getInternalDataPath();

    const binds = [
      `${hostConfigPath}:/config:rw`,
      `${hostDataPath}:${internalDataPath}:rw`,
    ];

    logger.debug('Volume mounts configured', {
      hostConfigPath,
      hostDataPath,
      internalDataPath,
    });

    return binds;
  }

  /**
   * Build host configuration
   */
  private buildHostConfig(hostPort: number, binds: string[]): ContainerConfig['HostConfig'] {
    return {
      Binds: binds,
      PortBindings: {
        [`${AGENT.INTERNAL_PORT}/tcp`]: [{ HostPort: hostPort.toString() }],
      },
      Memory: AGENT.MEMORY_LIMIT,
      NanoCpus: AGENT.CPU_LIMIT,
      RestartPolicy: {
        Name: 'on-failure',
        MaximumRetryCount: AGENT.MAX_RESTARTS,
      },
    };
  }

  /**
   * Get user configuration for container
   */
  private getUserConfig(): string | undefined {
    return process.platform === 'win32' ? '0' : undefined;
  }

  /**
   * Get internal data path based on platform
   */
  private getInternalDataPath(): string {
    return process.platform === 'win32' 
      ? '/root/.openclaw' 
      : '/home/node/.openclaw';
  }

  /**
   * Get container name for deployment
   */
  public getContainerName(deploymentId: string): string {
    return `${DOCKER.CONTAINER_PREFIX}${deploymentId}`;
  }

  /**
   * Get config directory path for deployment
   */
  public getConfigDir(deploymentId: string): string {
    return path.join(this.dataPath, deploymentId, 'config');
  }

  /**
   * Get data directory path for deployment
   */
  public getDataDir(deploymentId: string): string {
    return path.join(this.dataPath, deploymentId, 'data');
  }

  /**
   * Get workspace directory path for deployment
   */
  public getWorkspaceDir(deploymentId: string): string {
    return path.join(this.getDataDir(deploymentId), 'workspace', 'memory');
  }

  /**
   * Get agent auth directory path
   */
  public getAgentAuthDir(deploymentId: string): string {
    return path.join(this.getDataDir(deploymentId), 'agents', 'main', 'agent');
  }

  /**
   * Get legacy auth directory path
   */
  public getLegacyAuthDir(deploymentId: string): string {
    return path.join(this.getDataDir(deploymentId), 'agent');
  }
}

export const configBuilder = new ConfigBuilder();
export default configBuilder;