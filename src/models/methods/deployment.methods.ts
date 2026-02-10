/**
 * Deployment Model Methods
 * Static and instance methods for Deployment model
 */

import { Schema } from 'mongoose';
import { IDeploymentDocument } from '../../types';

/**
 * Add static methods to Deployment schema
 */
export function addDeploymentStaticMethods(schema: Schema<IDeploymentDocument>) {
  /**
   * Find deployment by subdomain
   */
  schema.statics.findBySubdomain = function(subdomain: string) {
    return this.findOne({ subdomain: subdomain.toLowerCase() });
  };

  /**
   * Find all deployments for a user
   */
  schema.statics.findByUser = function(userId: string) {
    return this.find({ user: userId }).sort({ createdAt: -1 });
  };

  /**
   * Find active deployments (not stopped or errored)
   */
  schema.statics.findActive = function() {
    return this.find({
      status: { $nin: ['stopped', 'error', 'idle'] }
    });
  };

  /**
   * Find deployments by status
   */
  schema.statics.findByStatus = function(status: string) {
    return this.find({ status });
  };

  /**
   * Count deployments for user by status
   */
  schema.statics.countByUserAndStatus = function(userId: string, statuses: string[]) {
    return this.countDocuments({
      user: userId,
      status: { $in: statuses }
    });
  };
}

/**
 * Add instance methods to Deployment schema
 */
export function addDeploymentInstanceMethods(schema: Schema<IDeploymentDocument>) {
  /**
   * Get deployment URL
   */
  schema.methods.getUrl = function(): string {
    const domain = process.env.DOMAIN || 'localhost';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    
    if (process.env.NODE_ENV === 'development' && this.internalPort) {
      return `http://localhost:${this.internalPort}`;
    }

    return `${protocol}://${this.subdomain}.${domain}`;
  };

  /**
   * Get auto-login URL with token
   */
  schema.methods.getAutoLoginUrl = async function(): Promise<string> {
    const secrets = await this.decryptSecrets();
    const baseUrl = this.getUrl();
    return `${baseUrl}?token=${secrets.webUiToken}`;
  };

  /**
   * Check if deployment is healthy
   */
  schema.methods.isHealthy = function(): boolean {
    return this.status === 'healthy';
  };

  /**
   * Check if deployment is running
   */
  schema.methods.isRunning = function(): boolean {
    return ['healthy', 'starting', 'provisioning'].includes(this.status);
  };

  /**
   * Check if deployment can be started
   */
  schema.methods.canStart = function(): boolean {
    return ['idle', 'stopped', 'error'].includes(this.status);
  };

  /**
   * Check if deployment can be stopped
   */
  schema.methods.canStop = function(): boolean {
    return ['healthy', 'starting'].includes(this.status);
  };

  /**
   * Check if deployment can be restarted
   */
  schema.methods.canRestart = function(): boolean {
    return this.status === 'healthy';
  };
}

export default {
  addDeploymentStaticMethods,
  addDeploymentInstanceMethods,
};