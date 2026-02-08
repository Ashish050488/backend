import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import http from 'http';

// --- IMPORTS ---
import { config } from '@config/index';
import { connectDatabase } from '@config/database';
import { logger } from '@utils/logger';
import { proxyMiddleware, handleWebSocketUpgrade } from '@middleware/proxy';
import { errorHandler, notFoundHandler } from '@middleware/errorHandler';
import routes from '@routes/index';
import { reaperService } from '@services/ReaperService'; // <--- 1. IMPORT REAPER

const app = express();
const server = http.createServer(app);

// --- MIDDLEWARE ---
app.use(helmet({
  contentSecurityPolicy: false, // Set false for dev, tune for prod
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // Allow frontend access
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
});
app.use(limiter);

// --- BODY PARSING ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// --- LOGGING ---
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// --- PROXY (MUST BE BEFORE API ROUTES) ---
app.use(proxyMiddleware);

// --- API ROUTES ---
app.use('/api', routes);

// --- STATIC FILES ---
if (config.server.isDevelopment) {
  app.use('/views', express.static('views'));
}

// --- ERROR HANDLING ---
app.use(notFoundHandler);
app.use(errorHandler);

// --- WEBSOCKET ---
server.on('upgrade', handleWebSocketUpgrade);

// --- SERVER STARTUP ---
const RETRY_DELAY = 5000;
const MAX_RETRIES = 5;

async function startServerWithRetry(retries = MAX_RETRIES): Promise<void> {
  try {
    logger.info(`Connecting to database... (Attempts left: ${retries})`);
    await connectDatabase();
    logger.info('Database connected successfully.');

    // Start Reaper only after DB is connected
    reaperService.start();
    logger.info('💀 Reaper Service started');

    const PORT = config.server.port;
    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`- API: http://${config.server.domain}:${PORT}`);
      logger.info(`- Environment: ${config.server.env}`);
    });

  } catch (error) {
    logger.error('Failed to start server:', { error: (error as Error).message });
    
    if (retries > 0) {
      logger.warn(`Retrying in ${RETRY_DELAY/1000} seconds...`);
      setTimeout(() => startServerWithRetry(retries - 1), RETRY_DELAY);
    } else {
      logger.error('Max retries reached. Exiting.');
      process.exit(1);
    }
  }
}

// Replace the old startServer() call with:
startServerWithRetry();

// Graceful Shutdown
const shutdown = () => {
  logger.info('Shutting down...');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);


export default app;