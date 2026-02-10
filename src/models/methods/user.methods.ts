/**
 * User Model Methods
 * Static and instance methods for User model
 */

import { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { IUserDocument, UserTier, SubscriptionStatus } from '../../types';

const SALT_ROUNDS = 12;

export const TIER_CONFIG: Record<string, { maxAgents: number; priority: number }> = {
  free: { maxAgents: 0, priority: 0 },
  hobby: { maxAgents: 1, priority: 1 },
  pro: { maxAgents: 5, priority: 2 },
  enterprise: { maxAgents: 20, priority: 3 },
};

/**
 * Add static methods to User schema
 */
export function addUserStaticMethods(schema: Schema<IUserDocument>) {
  /**
   * Hash password
   */
  schema.statics.hashPassword = async function(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  };

  /**
   * Find user by email
   */
  schema.statics.findByEmail = function(email: string) {
    return this.findOne({ email: email.toLowerCase() });
  };

  /**
   * Find users by tier
   */
  schema.statics.findByTier = function(tier: UserTier) {
    return this.find({ tier });
  };

  /**
   * Find users by subscription status
   */
  schema.statics.findBySubscriptionStatus = function(status: SubscriptionStatus) {
    return this.find({ subscriptionStatus: status });
  };

  /**
   * Count users by tier
   */
  schema.statics.countByTier = function(tier: UserTier) {
    return this.countDocuments({ tier });
  };
}

/**
 * Add instance methods to User schema
 */
export function addUserInstanceMethods(schema: Schema<IUserDocument>) {
  /**
   * Compare password with hash
   */
  schema.methods.comparePassword = async function(password: string): Promise<boolean> {
    return bcrypt.compare(password, this.passwordHash);
  };

  /**
   * Check if user can create an agent
   */
  schema.methods.canCreateAgent = async function(): Promise<{ allowed: boolean; reason?: string }> {
    const tier = this.tier || 'free';
    const config = TIER_CONFIG[tier];
    
    if (!config) {
      return { allowed: false, reason: 'Invalid subscription tier' };
    }

    const { maxAgents } = config;

    if (maxAgents === 0) {
      return { 
        allowed: false, 
        reason: 'You are on the Free tier. Please upgrade to Hobby or Pro to deploy an agent.' 
      };
    }
    
    const Deployment = mongoose.model('Deployment');
    const currentCount = await Deployment.countDocuments({
      user: this._id,
      status: { $nin: ['stopped', 'error'] },
    });

    if (currentCount >= maxAgents) {
      return {
        allowed: false,
        reason: `You have reached the maximum of ${maxAgents} agents for your ${tier} plan. Please upgrade to create more.`,
      };
    }

    return { allowed: true };
  };

  /**
   * Update user subscription
   */
  schema.methods.updateSubscription = async function(
    status: SubscriptionStatus,
    tier?: UserTier
  ): Promise<void> {
    this.subscriptionStatus = status;
    if (tier) {
      this.tier = tier;
      this.maxAgents = TIER_CONFIG[tier].maxAgents;
    }
    await this.save();
  };

  /**
   * Check if user is on free tier
   */
  schema.methods.isFreeTier = function(): boolean {
    return this.tier === 'free' || this.subscriptionStatus === 'free';
  };

  /**
   * Check if user is on paid tier
   */
  schema.methods.isPaidTier = function(): boolean {
    return ['hobby', 'pro', 'enterprise'].includes(this.tier);
  };

  /**
   * Check if subscription is active
   */
  schema.methods.hasActiveSubscription = function(): boolean {
    return this.subscriptionStatus === 'active';
  };

  /**
   * Get remaining agent slots
   */
  schema.methods.getRemainingAgentSlots = async function(): Promise<number> {
    const tier = this.tier || 'free';
    const config = TIER_CONFIG[tier];
    const maxAgents = config?.maxAgents || 0;

    const Deployment = mongoose.model('Deployment');
    const currentCount = await Deployment.countDocuments({
      user: this._id,
      status: { $nin: ['stopped', 'error'] },
    });

    return Math.max(0, maxAgents - currentCount);
  };
}

export default {
  addUserStaticMethods,
  addUserInstanceMethods,
  TIER_CONFIG,
};