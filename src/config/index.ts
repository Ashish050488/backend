/**
 * Configuration Module - Centralized environment configuration
 */

import dotenv from 'dotenv';
import path from 'path';
import os from 'os';

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

// Determine a safe data path for Docker
const isWindows = os.platform() === 'win32';
const defaultDataPath = isWindows 
  ? 'C:\\simpleclaw-data' // Safe path for Windows Dev
  : '/opt/saas/data';     // Standard path for Linux Prod

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
    socketPath: getEnv('DOCKER_SOCKET', '/var/run/docker.sock'),
    agentImage: getEnv('AGENT_IMAGE', 'ghcr.io/openclaw/openclaw:latest'),
    // USE THE SAFE PATH LOGIC
    dataPath: getEnv('DATA_PATH', defaultDataPath),
    containerPrefix: 'simpleclaw-agent-',
  },

  // Port Allocation
  ports: {
    min: getIntEnv('MIN_AGENT_PORT', 20000),
    max: getIntEnv('MAX_AGENT_PORT', 30000),
  },

  // Agent Configuration
  agent: {
    defaultModel: 'anthropic/claude-3-5-sonnet',
    internalPort: 18789,
    // UPDATE THESE TWO LINES:
    memoryLimit: 2 * 1024 * 1024 * 1024, // 2GB RAM
    cpuLimit: 2000000000, // 2 CPUs (optional, helps with startup speed)
    maxRestarts: 3,
    healthCheckTimeout: 120000, // Increase to 2 minutes for slower startups
    healthCheckInterval: 2000,
  },

  // Payments (Razorpay)
  payments: {
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '', // Optional to prevent crash if missing
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
    plans: {
      hobby: { amount: 4900, currency: 'INR' },
      pro: { amount: 9900, currency: 'INR' },
    }
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