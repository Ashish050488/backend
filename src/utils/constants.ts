/**
 * Application Constants
 * Centralized location for all application-wide constants
 */

import { config } from '@config/index';

// ============================================================================
// Docker Constants (Windows-safe defaults + sane fallbacks)
// ============================================================================

const isWindows = process.platform === 'win32';

// If config.docker.socketPath is missing or accidentally set to a Linux path,
// this prevents Windows from trying /var/run/docker.sock.
const resolvedDockerSocket =
  config?.docker?.socketPath &&
  typeof config.docker.socketPath === 'string' &&
  config.docker.socketPath.trim().length > 0 &&
  !(isWindows && config.docker.socketPath.includes('/var/run/docker.sock'))
    ? config.docker.socketPath
    : isWindows
      ? 'http://127.0.0.1:2375'
      : 'unix:///var/run/docker.sock';

// Ensure GHCR is used by default (avoids pulling from Docker Hub by mistake)
const resolvedAgentImage =
  config?.docker?.agentImage &&
  typeof config.docker.agentImage === 'string' &&
  config.docker.agentImage.trim().length > 0
    ? config.docker.agentImage
    : 'ghcr.io/openclaw/openclaw:latest';

// Data path fallback (Windows-friendly)
const resolvedDataPath =
  config?.docker?.dataPath &&
  typeof config.docker.dataPath === 'string' &&
  config.docker.dataPath.trim().length > 0
    ? config.docker.dataPath
    : isWindows
      ? 'C:\\simpleclaw-data'
      : '/tmp/simpleclaw-data';

export const DOCKER = {
  AGENT_IMAGE: resolvedAgentImage,
  CONTAINER_PREFIX: config.docker.containerPrefix,
  SOCKET_PATH: resolvedDockerSocket,
  DATA_PATH: resolvedDataPath,
} as const;

// ============================================================================
// Agent Configuration
// ============================================================================

export const AGENT = {
  INTERNAL_PORT: config.agent.internalPort,
  DEFAULT_MODEL: config.agent.defaultModel,
  MEMORY_LIMIT: config.agent.memoryLimit,
  CPU_LIMIT: config.agent.cpuLimit,
  MAX_RESTARTS: config.agent.maxRestarts,
  HEALTH_CHECK_TIMEOUT: config.agent.healthCheckTimeout,
  HEALTH_CHECK_INTERVAL: config.agent.healthCheckInterval,
} as const;

// ============================================================================
// Port Configuration
// ============================================================================

export const PORTS = {
  MIN: config.ports.min,
  MAX: config.ports.max,
  RANGE: config.ports.max - config.ports.min + 1,
} as const;

// ============================================================================
// Deployment States
// ============================================================================

export const DEPLOYMENT_STATES = {
  IDLE: 'idle',
  CONFIGURING: 'configuring',
  PROVISIONING: 'provisioning',
  STARTING: 'starting',
  HEALTHY: 'healthy',
  STOPPED: 'stopped',
  ERROR: 'error',
  RESTARTING: 'restarting',
} as const;

export type DeploymentState = typeof DEPLOYMENT_STATES[keyof typeof DEPLOYMENT_STATES];

// ============================================================================
// State Transitions Map
// ============================================================================

export const VALID_STATE_TRANSITIONS: Record<DeploymentState, DeploymentState[]> = {
  [DEPLOYMENT_STATES.IDLE]: ['idle', 'configuring', 'provisioning', 'error'],
  [DEPLOYMENT_STATES.CONFIGURING]: ['configuring', 'provisioning', 'error'],
  [DEPLOYMENT_STATES.PROVISIONING]: ['provisioning', 'starting', 'error'],
  [DEPLOYMENT_STATES.STARTING]: ['starting', 'healthy', 'error'],
  [DEPLOYMENT_STATES.HEALTHY]: ['healthy', 'stopped', 'restarting', 'error'],
  [DEPLOYMENT_STATES.STOPPED]: ['stopped', 'configuring', 'idle', 'error', 'starting'],
  [DEPLOYMENT_STATES.RESTARTING]: ['restarting', 'starting', 'healthy', 'error'],
  [DEPLOYMENT_STATES.ERROR]: ['error', 'configuring', 'idle', 'restarting', 'stopped'],
} as const;

// ============================================================================
// Timeouts
// ============================================================================

export const TIMEOUTS = {
  PROXY: 30000, // 30 seconds
  CONTAINER_STOP: 30, // 30 seconds
  CONTAINER_RESTART: 30, // 30 seconds
  HEALTH_CHECK: 2000, // 2 seconds
  CACHE_TTL: 5000, // 5 seconds
} as const;

// ============================================================================
// Cache Configuration
// ============================================================================

export const CACHE = {
  DEPLOYMENT_TTL: 5000, // 5 seconds
} as const;

// ============================================================================
// Encrypted Fields
// ============================================================================

export const ENCRYPTED_FIELDS = [
  'openaiApiKey',
  'anthropicApiKey',
  'googleApiKey',
  'telegramBotToken',
  'webUiToken',
] as const;

// ============================================================================
// Model Mappings
// ============================================================================

export const MODEL_MAPPINGS: Record<string, string> = {
  'google/gemini-1.5-flash': 'google/gemini-3-pro-preview',
  'google/gemini-1.5-pro': 'google/gemini-3-pro-preview',
  'google/gemini-2.0-flash-exp': 'google/gemini-3-pro-preview',
  'google/gemini-flash': 'google/gemini-3-pro-preview',
} as const;

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULTS = {
  PAGINATION: {
    PAGE: 1,
    LIMIT: 10,
  },
  SYSTEM_PROMPT: 'You are a helpful AI assistant.',
  FALLBACK_TOKEN: 'fallback-dev-token-xyz',
} as const;

// ============================================================================
// File Paths
// ============================================================================

export const PATHS = {
  CONFIG_FILE: 'openclaw.json',
  AUTH_PROFILES_FILE: 'auth-profiles.json',
} as const;

// ============================================================================
// Reaper Configuration
// ============================================================================

export const REAPER = {
  INTERVAL: '*/5 * * * *', // Every 5 minutes
  BATCH_SIZE: 5,
  DELAY_BETWEEN_BATCHES: 100, // milliseconds
  DOCKER_TIMEOUT: 10000, // 10 seconds
} as const;

export default {
  DOCKER,
  AGENT,
  PORTS,
  DEPLOYMENT_STATES,
  VALID_STATE_TRANSITIONS,
  TIMEOUTS,
  CACHE,
  ENCRYPTED_FIELDS,
  MODEL_MAPPINGS,
  DEFAULTS,
  PATHS,
  REAPER,
};
