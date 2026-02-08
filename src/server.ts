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
async function startServer(): Promise<void> {
  try {
    logger.info('Connecting to database...');
    await connectDatabase();
    logger.info('Database connected');

    // --- 2. START THE REAPER HERE ---
    // This cleans up dead containers every minute
    reaperService.start(); 
    logger.info('💀 Reaper Service started');

    const PORT = config.server.port;
    
    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

// Graceful Shutdown
const shutdown = () => {
  logger.info('Shutting down...');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer();

export default app;