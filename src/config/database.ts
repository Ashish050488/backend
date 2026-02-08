/**
 * Database Connection Module
 * 
 * Manages MongoDB connection with connection pooling and error handling.
 */

import mongoose from 'mongoose';
import { config } from '@config/index';
import { logger } from '@utils/logger';

// ============================================================================
// Connection State
// ============================================================================

let isConnected = false;
let connectionPromise: Promise<typeof mongoose> | null = null;

// ============================================================================
// Connection Function
// ============================================================================

export async function connectDatabase(): Promise<typeof mongoose> {
  // Return existing connection if already connected
  if (isConnected && mongoose.connection.readyState === 1) {
    logger.debug('Using existing MongoDB connection');
    return mongoose;
  }

  // Return in-flight connection promise if one exists
  if (connectionPromise) {
    logger.debug('Reusing in-flight MongoDB connection');
    return connectionPromise;
  }

  // Create new connection
  connectionPromise = mongoose.connect(config.database.uri, config.database.options);

  try {
    const connection = await connectionPromise;
    isConnected = true;
    
    logger.info('MongoDB connected successfully', {
      host: connection.connection.host,
      port: connection.connection.port,
      database: connection.connection.name,
    });

    // Set up connection event handlers
    setupConnectionHandlers();

    return connection;
  } catch (error) {
    isConnected = false;
    connectionPromise = null;
    
    logger.error('MongoDB connection failed', {
      error: (error as Error).message,
      uri: config.database.uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'), // Hide credentials
    });
    
    throw error;
  }
}

// ============================================================================
// Connection Event Handlers
// ============================================================================

function setupConnectionHandlers(): void {
  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB connection error', { error: error.message });
    isConnected = false;
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    isConnected = false;
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
    isConnected = true;
  });

  // Handle process termination
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function gracefulShutdown(): Promise<void> {
  logger.info('Shutting down MongoDB connection...');
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error closing MongoDB connection', { error: (error as Error).message });
    process.exit(1);
  }
}

// ============================================================================
// Health Check
// ============================================================================

export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latency?: number;
  error?: string;
}> {
  const start = Date.now();
  
  try {
    // Ping the database
    await mongoose.connection.db?.admin().ping();
    
    return {
      healthy: true,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      error: (error as Error).message,
      latency: Date.now() - start,
    };
  }
}

// ============================================================================
// Export
// ============================================================================

export default connectDatabase;
