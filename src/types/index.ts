import { Document, Types } from 'mongoose';

// ============================================================================
// User Types
// ============================================================================

export type SubscriptionStatus = 'free' | 'active' | 'past_due' | 'canceled';
export type UserTier = 'hobby' | 'pro' | 'enterprise';

export interface IUser {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
razorpayCustomerId?: string;
  subscriptionStatus: SubscriptionStatus;
  tier: UserTier;
  maxAgents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserDocument extends IUser, Document {
  comparePassword(password: string): Promise<boolean>;
  canCreateAgent(): Promise<{ allowed: boolean; reason?: string }>;
  updateSubscription(status: SubscriptionStatus, tier?: UserTier): Promise<void>;
}

// ... (Keep the rest of your Deployment/Docker types below as they were)
export type DeploymentStatus = 
  | 'idle' 
  | 'configuring' 
  | 'provisioning' 
  | 'starting' 
  | 'healthy' 
  | 'stopped' 
  | 'error'
  | 'restarting';

export interface IDeploymentSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  webUiToken: string;
  [key: string]: string | undefined;
}

export interface IDeployment {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  subdomain: string;
  containerId?: string;
  internalPort?: number;
  status: DeploymentStatus;
  secrets: IDeploymentSecrets;
  config?: Record<string, unknown>;
  lastHeartbeat?: Date;
  errorMessage?: string;
  provisioningStep?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDeploymentDocument extends IDeployment, Document {
  decryptSecrets(): Promise<IDecryptedSecrets>;
  transitionTo(status: DeploymentStatus, options?: { errorMessage?: string; provisioningStep?: string }): Promise<void>;
  getUrl(): string;
  getAutoLoginUrl(): Promise<string>;
}

export interface IDecryptedSecrets {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  webUiToken: string;
  [key: string]: string | undefined;
}

export interface ContainerConfig {
  Image: string;
  name: string;
  User?: string;
  Env: string[];
  HostConfig: {
    Binds: string[];
    PortBindings: Record<string, Array<{ HostPort: string }>>;
    Memory: number;
    NanoCpus: number;
    RestartPolicy: {
      Name: string;
      MaximumRetryCount: number;
    };
  };
  ExposedPorts: Record<string, {}>;
}

export interface OpenClawConfig {
  agent: {
    model: string;
    workspace: string;
  };
  gateway: {
    bind: string;
    port: number;
    auth: {
      mode: 'token' | 'password';
      token?: string;
      password?: string;
    };
  };
  llm?: {
    provider: string;
    apiKey?: string;
  };
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface DeploymentStatusResponse {
  id: string;
  subdomain: string;
  status: DeploymentStatus;
  url?: string;
  provisioningStep?: string;
  errorMessage?: string;
  createdAt: string;
  lastHeartbeat?: string;
}

export class TamperedDataError extends Error {
  constructor(message: string = 'Data integrity check failed') {
    super(message);
    this.name = 'TamperedDataError';
  }
}

export class EncryptionError extends Error {
  constructor(message: string = 'Encryption operation failed') {
    super(message);
    this.name = 'EncryptionError';
  }
}

export class DeploymentError extends Error {
  constructor(message: string, public code: string, public statusCode: number = 500) {
    super(message);
    this.name = 'DeploymentError';
  }
}

export class PortAllocationError extends Error {
  constructor(message: string = 'Failed to allocate port') {
    super(message);
    this.name = 'PortAllocationError';
  }
}



export interface PaymentOrderRequest {
  plan: 'hobby' | 'pro';
}

export interface PaymentVerifyRequest {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
  plan: 'hobby' | 'pro';
}