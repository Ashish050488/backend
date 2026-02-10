/**
 * Config Generator Service
 * Generates OpenClaw configuration files for agent deployments
 */

import fs from 'fs/promises';
import path from 'path';
import { configBuilder } from '../docker/ConfigBuilder';
import { logger } from '@utils/logger';
import { IDecryptedSecrets } from '../../types';
import { AGENT, DEFAULTS, PATHS } from '@utils/constants';

export class ConfigGenerator {
  /**
   * Generate all configuration files for deployment
   */
  public async generateConfigs(
    deploymentId: string,
    subdomain: string,
    secrets: IDecryptedSecrets,
    model: string,
    systemPrompt: string = DEFAULTS.SYSTEM_PROMPT
  ): Promise<void> {
    logger.info('Generating configuration files', { deploymentId, subdomain });

    try {
      // Create directories
      await this.createDirectories(deploymentId);

      // Generate openclaw.json
      await this.generateOpenClawConfig(deploymentId, secrets, model);

      // Generate auth-profiles.json
      await this.generateAuthProfiles(deploymentId, secrets);

      // Generate initial memory file
      await this.generateInitialMemory(deploymentId);

      // Fix permissions for Linux
      await this.fixPermissions(deploymentId);

      logger.info('Configuration files generated successfully', { deploymentId });
    } catch (error) {
      logger.error('Failed to generate config files', {
        deploymentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /**
   * Create required directories
   */
  private async createDirectories(deploymentId: string): Promise<void> {
    const directories = [
      configBuilder.getConfigDir(deploymentId),
      configBuilder.getDataDir(deploymentId),
      configBuilder.getWorkspaceDir(deploymentId),
      configBuilder.getAgentAuthDir(deploymentId),
      configBuilder.getLegacyAuthDir(deploymentId),
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
      logger.debug('Created directory', { dir });
    }
  }

  /**
   * Generate openclaw.json configuration
   */
  private async generateOpenClawConfig(
    deploymentId: string,
    secrets: IDecryptedSecrets,
    model: string
  ): Promise<void> {
    const configPath = path.join(
      configBuilder.getConfigDir(deploymentId),
      PATHS.CONFIG_FILE
    );

    const gatewayToken = secrets.webUiToken || DEFAULTS.FALLBACK_TOKEN;
    const workspacePath = this.getWorkspacePath();

    const config = {
      agents: {
        defaults: {
          model: { primary: model },
          workspace: workspacePath,
        },
      },
      gateway: {
        port: AGENT.INTERNAL_PORT,
        auth: {
          mode: 'token',
          token: gatewayToken,
        },
      },
      channels: {
        telegram: secrets.telegramBotToken
          ? {
              enabled: true,
              botToken: secrets.telegramBotToken,
              dmPolicy: 'open',
              groupPolicy: 'open',
              allowFrom: ['*'],
            }
          : { enabled: false },
      },
      plugins: {
        entries: {
          telegram: {
            enabled: !!secrets.telegramBotToken,
          },
        },
      },
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    
    logger.info('Generated openclaw.json', { configPath, model });
  }

  /**
   * Generate auth-profiles.json
   */
  private async generateAuthProfiles(
    deploymentId: string,
    secrets: IDecryptedSecrets
  ): Promise<void> {
    const authProfiles: any = {
      profiles: {},
      usageStats: {},
    };

    // Add Google profile
    if (secrets.googleApiKey) {
      authProfiles.profiles['google:default'] = {
        type: 'api_key',
        provider: 'google',
        key: secrets.googleApiKey,
      };
      logger.debug('Added Google API key to auth profile', {
        keyLength: secrets.googleApiKey.length,
        keyPrefix: secrets.googleApiKey.substring(0, 10),
      });
    }

    // Add Anthropic profile
    if (secrets.anthropicApiKey) {
      authProfiles.profiles['anthropic:default'] = {
        type: 'api_key',
        provider: 'anthropic',
        key: secrets.anthropicApiKey,
      };
      logger.debug('Added Anthropic API key to auth profile');
    }

    // Add OpenAI profile
    if (secrets.openaiApiKey) {
      authProfiles.profiles['openai:default'] = {
        type: 'api_key',
        provider: 'openai',
        key: secrets.openaiApiKey,
      };
      logger.debug('Added OpenAI API key to auth profile');
    }

    // Write to agent-specific path (primary)
    const agentAuthPath = path.join(
      configBuilder.getAgentAuthDir(deploymentId),
      PATHS.AUTH_PROFILES_FILE
    );
    
    await fs.writeFile(agentAuthPath, JSON.stringify(authProfiles, null, 2), {
      mode: 0o600,
    });
    
    logger.info('Generated auth-profiles.json (agent path)', { path: agentAuthPath });

    // Write to legacy path (fallback)
    const legacyAuthPath = path.join(
      configBuilder.getLegacyAuthDir(deploymentId),
      PATHS.AUTH_PROFILES_FILE
    );
    
    await fs.writeFile(legacyAuthPath, JSON.stringify(authProfiles, null, 2), {
      mode: 0o600,
    });
    
    logger.info('Generated auth-profiles.json (legacy path)', { path: legacyAuthPath });

    // Verify files were written correctly
    await this.verifyAuthProfiles(agentAuthPath, authProfiles);
  }

  /**
   * Verify auth profiles were written correctly
   */
  private async verifyAuthProfiles(filePath: string, expectedData: any): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      
      logger.info('Verified auth-profiles.json', {
        path: filePath,
        profiles: Object.keys(parsed.profiles),
        hasGoogleProfile: !!parsed.profiles['google:default'],
      });
    } catch (error) {
      logger.error('Failed to verify auth-profiles.json', {
        path: filePath,
        error: (error as Error).message,
      });
    }
  }

  /**
   * Generate initial memory file
   */
  private async generateInitialMemory(deploymentId: string): Promise<void> {
    const workspaceDir = configBuilder.getWorkspaceDir(deploymentId);
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const memoryFile = path.join(workspaceDir, `${today}.md`);

    await fs.writeFile(memoryFile, `# Memory for ${today}\n\n`, { mode: 0o644 });
    
    logger.info('Created initial memory file', { memoryFile });
  }

  /**
   * Fix file permissions for Linux containers
   */
  private async fixPermissions(deploymentId: string): Promise<void> {
    if (process.platform === 'win32') {
      logger.debug('Skipping permission fix on Windows');
      return;
    }

    const paths = [
      configBuilder.getConfigDir(deploymentId),
      configBuilder.getDataDir(deploymentId),
      configBuilder.getAgentAuthDir(deploymentId),
      configBuilder.getLegacyAuthDir(deploymentId),
    ];

    try {
      for (const dir of paths) {
        await fs.chown(dir, 1000, 1000);
      }
      
      logger.debug('Fixed permissions for container user', { uid: 1000, gid: 1000 });
    } catch (error) {
      logger.warn('Failed to fix permissions', {
        error: (error as Error).message,
      });
    }
  }

  /**
   * Get workspace path for container
   */
  private getWorkspacePath(): string {
    return process.platform === 'win32'
      ? '/root/.openclaw/workspace'
      : '/home/node/.openclaw/workspace';
  }
}

export const configGenerator = new ConfigGenerator();
export default configGenerator;