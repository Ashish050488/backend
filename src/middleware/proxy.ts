/**
 * Dynamic Reverse Proxy Middleware
 * 
 * Routes incoming requests from user-specific subdomains to the correct
 * Docker container using http-proxy. Supports both HTTP and WebSocket traffic.
 */

import httpProxy from 'http-proxy';
import { Request, Response, NextFunction } from 'express';
import { Deployment } from '@models/Deployment';
import { logger } from '@utils/logger';
import { config } from '@config/index';

// ============================================================================
// Constants
// ============================================================================

const PROXY_TIMEOUT = 30000; // 30 seconds
const CACHE_TTL = 5000; // 5 seconds cache for deployment lookups

// ============================================================================
// Types
// ============================================================================

interface CachedDeployment {
  port: number;
  status: string;
  timestamp: number;
}

// ============================================================================
// Proxy Manager Class
// ============================================================================

class ProxyManager {
  private proxy: httpProxy;
  private deploymentCache: Map<string, CachedDeployment> = new Map();

  constructor() {
    this.proxy = httpProxy.createProxyServer({
      ws: true, // Enable WebSocket support
      changeOrigin: true,
      timeout: PROXY_TIMEOUT,
      proxyTimeout: PROXY_TIMEOUT,
    });

    this.setupErrorHandling();
  }

  // ==========================================================================
  // Middleware
  // ==========================================================================

  /**
   * Main proxy middleware
   * 
   * Intercepts requests based on subdomain and routes to appropriate container
   */
  middleware = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const host = req.headers.host || '';
    const subdomain = this.extractSubdomain(host);

    logger.debug('Proxy middleware received request', {
      host,
      subdomain,
      path: req.path,
      method: req.method,
    });

    // Skip if no subdomain or main domain
    if (!subdomain || this.isMainDomain(subdomain)) {
      return next();
    }

    try {
      // Look up deployment
      const deployment = await this.getDeployment(subdomain);

      if (!deployment) {
        logger.warn('Deployment not found for subdomain', { subdomain });
        return this.sendNotFound(res, subdomain);
      }

      // Check deployment status
      if (deployment.status !== 'healthy') {
        return this.handleNonHealthyDeployment(res, deployment);
      }

      // Proxy the request
      this.proxyRequest(req, res, deployment.port, subdomain);

    } catch (error) {
      logger.error('Proxy error', {
        subdomain,
        error: (error as Error).message,
      });
      
      res.status(502).json({
        success: false,
        error: {
          code: 'PROXY_ERROR',
          message: 'Failed to route request to agent',
        },
      });
    }
  };

  // ==========================================================================
  // WebSocket Handler
  // ==========================================================================

  /**
   * Handle WebSocket upgrade requests
   * 
   * Must be attached to the HTTP server's 'upgrade' event
   */
  handleUpgrade = async (
    request: httpProxy.ProxyReqArgs['req'],
    socket: NodeJS.Socket,
    head: Buffer
  ): Promise<void> => {
    const host = request.headers.host || '';
    const subdomain = this.extractSubdomain(host);

    logger.debug('WebSocket upgrade request', { host, subdomain });

    if (!subdomain || this.isMainDomain(subdomain)) {
      socket.destroy();
      return;
    }

    try {
      const deployment = await this.getDeployment(subdomain);

      if (!deployment || deployment.status !== 'healthy') {
        logger.warn('WebSocket upgrade failed - deployment not healthy', { subdomain });
        socket.destroy();
        return;
      }

      const target = `http://127.0.0.1:${deployment.port}`;
      
      this.proxy.ws(request, socket, head, { target }, (error) => {
        logger.error('WebSocket proxy error', {
          subdomain,
          error: (error as Error).message,
        });
        socket.destroy();
      });

    } catch (error) {
      logger.error('WebSocket upgrade error', {
        subdomain,
        error: (error as Error).message,
      });
      socket.destroy();
    }
  };

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Extract subdomain from host header
   */
  private extractSubdomain(host: string): string | null {
    // Remove port if present
    const cleanHost = host.split(':')[0];
    
    // Split by dots
    const parts = cleanHost.split('.');
    
    // If we have at least 3 parts (subdomain.domain.tld), extract subdomain
    if (parts.length >= 3) {
      return parts[0].toLowerCase();
    }

    // For localhost development (e.g., alice-agent.localhost)
    if (parts.length === 2 && parts[1] === 'localhost') {
      return parts[0].toLowerCase();
    }

    return null;
  }

  /**
   * Check if subdomain is a main domain (should not be proxied)
   */
  private isMainDomain(subdomain: string): boolean {
    const mainDomains = ['www', 'api', 'app', 'admin', 'dashboard', 'auth'];
    return mainDomains.includes(subdomain.toLowerCase());
  }

  /**
   * Get deployment with caching
   */
  private async getDeployment(
    subdomain: string
  ): Promise<{ port: number; status: string } | null> {
    // Check cache first
    const cached = this.deploymentCache.get(subdomain);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { port: cached.port, status: cached.status };
    }

    // Query database
    const deployment = await Deployment.findBySubdomain(subdomain);

    if (!deployment || !deployment.internalPort) {
      return null;
    }

    // Update cache
    this.deploymentCache.set(subdomain, {
      port: deployment.internalPort,
      status: deployment.status,
      timestamp: Date.now(),
    });

    return {
      port: deployment.internalPort,
      status: deployment.status,
    };
  }

  /**
   * Clear deployment cache for a subdomain
   */
  clearCache(subdomain: string): void {
    this.deploymentCache.delete(subdomain);
    logger.debug('Proxy cache cleared', { subdomain });
  }

  /**
   * Clear entire cache
   */
  clearAllCache(): void {
    this.deploymentCache.clear();
    logger.debug('All proxy cache cleared');
  }

  // ==========================================================================
  // Response Handlers
  // ==========================================================================

  /**
   * Send "deployment not found" response
   */
  private sendNotFound(res: Response, subdomain: string): void {
    res.status(404).json({
      success: false,
      error: {
        code: 'DEPLOYMENT_NOT_FOUND',
        message: `No agent found for subdomain: ${subdomain}`,
      },
    });
  }

  /**
   * Handle non-healthy deployment states
   */
  private handleNonHealthyDeployment(
    res: Response,
    deployment: { port: number; status: string }
  ): void {
    const statusMessages: Record<string, { status: number; message: string }> = {
      idle: { status: 503, message: 'Agent is idle. Please start the deployment.' },
      configuring: { status: 503, message: 'Agent is being configured...' },
      provisioning: { status: 503, message: 'Agent is provisioning...' },
      starting: { status: 503, message: 'Agent is starting up...' },
      restarting: { status: 503, message: 'Agent is restarting...' },
      stopped: { status: 503, message: 'Agent is stopped. Please start the deployment.' },
      error: { status: 503, message: 'Agent encountered an error. Please check logs.' },
    };

    const response = statusMessages[deployment.status] || {
      status: 503,
      message: 'Agent is not ready.',
    };

    res.status(response.status).json({
      success: false,
      error: {
        code: 'AGENT_NOT_READY',
        message: response.message,
        status: deployment.status,
      },
    });
  }

  /**
   * Proxy request to target container
   */
  private proxyRequest(
    req: Request,
    res: Response,
    port: number,
    subdomain: string
  ): void {
    const target = `http://127.0.0.1:${port}`;

    logger.debug('Proxying request', {
      subdomain,
      target,
      path: req.path,
    });

    this.proxy.web(req, res, { target }, (error) => {
      logger.error('Proxy web error', {
        subdomain,
        target,
        error: (error as Error).message,
      });

      // Only send response if headers not already sent
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          error: {
            code: 'PROXY_ERROR',
            message: 'Failed to connect to agent. The agent may be restarting.',
          },
        });
      }
    });
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  /**
   * Setup proxy error event handlers
   */
  private setupErrorHandling(): void {
    this.proxy.on('error', (err, req, res) => {
      logger.error('Proxy error event', {
        error: err.message,
        url: (req as Request).url,
      });
    });

    this.proxy.on('proxyReq', (proxyReq, req) => {
      logger.debug('Proxy request initiated', {
        method: req.method,
        path: req.url,
        target: proxyReq.path,
      });
    });

    this.proxy.on('proxyRes', (proxyRes, req) => {
      logger.debug('Proxy response received', {
        status: proxyRes.statusCode,
        path: (req as Request).url,
      });
    });
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const proxyManager = new ProxyManager();

// Express middleware export
export const proxyMiddleware = proxyManager.middleware;

// WebSocket handler export
export const handleWebSocketUpgrade = proxyManager.handleUpgrade;

export default proxyManager;
