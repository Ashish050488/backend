/**
 * Configuration Module - Centralized environment configuration
 */

import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getIntEnv(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer`);
  }
  return parsed;
}

// Platform & environment detection
const isWindows = os.platform() === 'win32';
const isRunningInDocker =
  process.env.RUNNING_IN_DOCKER === 'true' ||
  fs.existsSync('/.dockerenv') ||
  fs.existsSync('/run/.containerenv');

// Safe data path defaults
const defaultDataPath = isWindows
  ? 'C:\\simpleclaw-data'
  : '/opt/saas/data';

// Docker socket defaults:
// - Windows host: TCP is easiest (you already verified 2375 works)
// - Linux host: unix socket
// - If backend is itself running inside a container: 127.0.0.1 points to *that container*,
//   so use host.docker.internal for TCP-to-host (works in Docker Desktop).
const defaultDockerSocket = (() => {
  if (isWindows) return 'http://127.0.0.1:2375';
  if (isRunningInDocker) return 'http://host.docker.internal:2375';
  return 'unix:///var/run/docker.sock';
})();

export const config = {
  // Server
  server: {
    env: getEnv('NODE_ENV', 'development'),
    port: getIntEnv('PORT', 3000),
    domain: getEnv('DOMAIN', 'localhost'),
    isDevelopment: getEnv('NODE_ENV', 'development') === 'development',
    isProduction: getEnv('NODE_ENV', 'development') === 'production',
  },

  // Database
  database: {
    uri: requireEnv('MONGODB_URI'),
    options: {
      maxPoolSize: 50,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    },
  },

  // Encryption
  encryption: {
    key: requireEnv('ENCRYPTION_KEY'),
    algorithm: 'aes-256-gcm' as const,
    ivLength: 12,
    authTagLength: 16,
    keyLength: 32,
  },

  // JWT
  jwt: {
    secret: requireEnv('JWT_SECRET'),
    expiresIn: getEnv('JWT_EXPIRES_IN', '7d'),
  },

  // Docker
  docker: {
    // IMPORTANT: default now matches your OS instead of hardcoding Linux sock
    socketPath: getEnv('DOCKER_SOCKET', defaultDockerSocket),

    // IMPORTANT: keep GHCR as the default (matches your manual docker pull)
    agentImage: getEnv('AGENT_IMAGE', 'ghcr.io/openclaw/openclaw:latest'),

    dataPath: getEnv('DATA_PATH', defaultDataPath),
    containerPrefix: getEnv('CONTAINER_PREFIX', 'simpleclaw-agent-'),
  },

  // Port Allocation
  ports: {
    min: getIntEnv('MIN_AGENT_PORT', 20000),
    max: getIntEnv('MAX_AGENT_PORT', 30000),
  },

  // Agent Configuration
  agent: {
    defaultModel: getEnv('DEFAULT_MODEL', 'anthropic/claude-3-5-sonnet'),
    internalPort: getIntEnv('AGENT_INTERNAL_PORT', 18789),

    memoryLimit: getIntEnv('AGENT_MEMORY_LIMIT', 2 * 1024 * 1024 * 1024), // 2GB
    cpuLimit: getIntEnv('AGENT_CPU_NANO', 2_000_000_000), // 2 CPUs in NanoCpus

    maxRestarts: getIntEnv('AGENT_MAX_RESTARTS', 3),
    healthCheckTimeout: getIntEnv('HEALTH_CHECK_TIMEOUT', 120000),
    healthCheckInterval: getIntEnv('HEALTH_CHECK_INTERVAL', 2000),
  },

  // Payments (Razorpay)
  payments: {
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    plans: {
      hobby: { amount: 4900, currency: 'INR' },
      pro: { amount: 9900, currency: 'INR' },
    },
  },

  // Logging
  logging: {
    level: getEnv('LOG_LEVEL', 'info'),
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 5000,
  },

  // CORS
  cors: {
    origin: getEnv('CORS_ORIGIN', '*'),
    credentials: true,
  },
} as const;

// Encryption Key Validation
const hexRegex = /^[a-f0-9]{64}$/i;
if (!hexRegex.test(config.encryption.key)) {
  throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes).');
}

export default config;
