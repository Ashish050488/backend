import mongoose, { Schema, model } from 'mongoose';
import { 
  IDeploymentDocument, 
  IDecryptedSecrets, 
  DeploymentStatus 
} from '../types/index';
import { cryptoService } from '@utils/crypto';
import { logger } from '@utils/logger';

const ENCRYPTED_FIELDS = ['openaiApiKey', 'anthropicApiKey', 'telegramBotToken', 'webUiToken'];

const DeploymentSchema = new Schema<IDeploymentDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subdomain: { 
      type: String, 
      required: true, 
      unique: true, 
      lowercase: true, 
      trim: true, 
      validate: /^[a-z0-9][a-z0-9-_]*[a-z0-9]$/
    },
    containerId: { type: String, sparse: true },
    internalPort: { type: Number, sparse: true },
    status: { 
      type: String, 
      enum: ['idle', 'configuring', 'provisioning', 'starting', 'healthy', 'stopped', 'error', 'restarting'], 
      default: 'idle' 
    },
    secrets: {
      openaiApiKey: { type: String },
      anthropicApiKey: { type: String },
      telegramBotToken: { type: String },
      googleApiKey: { type: String },
      webUiToken: { type: String, required: true },
    },
    config: {
      model: { type: String, default: 'anthropic/claude-3-5-sonnet' },
      systemPrompt: { type: String, default: 'You are a helpful AI assistant.' }
    },
    lastHeartbeat: { type: Date },
    errorMessage: { type: String },
    provisioningStep: { type: String, default: '' },
  },
  { 
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret: any) => {
        delete ret.secrets;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (doc, ret: any) => {
        delete ret.secrets;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// --- Virtuals ---

DeploymentSchema.virtual('url').get(function() {
  return this.getUrl();
});

// --- Helper Functions ---

/**
 * Checks if a string matches the encryption format (iv:authTag:ciphertext)
 * where each part is a hex string.
 */
function isEncryptedFormat(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  // Must have exactly 3 parts, and all must be hex strings
  return parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p));
}

// --- Methods ---

DeploymentSchema.methods.decryptSecrets = async function(): Promise<IDecryptedSecrets> {
  const decrypted: IDecryptedSecrets = { webUiToken: '' };
  
  // Helper to safely decrypt a field
  const safeDecrypt = (field: string, value?: string) => {
    if (!value) return undefined;
    
    // Safety check: If somehow we have plaintext that looks like token in DB, don't crash
    if (!isEncryptedFormat(value)) {
        logger.warn(`Detecting plaintext secret for ${field} (Fixing automatically on next save)`, { id: this._id });
        return value; // Return as-is if it's not encrypted
    }

    try {
      return cryptoService.decrypt(value);
    } catch (error) {
      logger.error(`Failed to decrypt field ${field}`, { id: this._id, error: (error as Error).message });
      throw error; 
    }
  };

  try {
    if (this.secrets.webUiToken) decrypted.webUiToken = safeDecrypt('webUiToken', this.secrets.webUiToken) || '';
    if (this.secrets.openaiApiKey) decrypted.openaiApiKey = safeDecrypt('openaiApiKey', this.secrets.openaiApiKey);
    if (this.secrets.anthropicApiKey) decrypted.anthropicApiKey = safeDecrypt('anthropicApiKey', this.secrets.anthropicApiKey);
    if (this.secrets.telegramBotToken) decrypted.telegramBotToken = safeDecrypt('telegramBotToken', this.secrets.telegramBotToken);
  } catch (error) {
    // If decryption fails critically, we can't spawn the agent
    throw new Error(`Decryption failed: ${(error as Error).message}`);
  }
  return decrypted;
};

// --- Middleware ---

DeploymentSchema.pre('save', async function(next) {
  if (!this.isModified('secrets')) return next();
  try {
    const secrets = this.secrets as Record<string, string | undefined>;
    for (const field of ENCRYPTED_FIELDS) {
      const value = secrets[field];
      // FIX: Use isEncryptedFormat() instead of just checking for ':'
      // This ensures Telegram tokens (which contain ':') get encrypted correctly
      if (value && !isEncryptedFormat(value)) {
        secrets[field] = cryptoService.encrypt(value);
      }
    }
    next();
  } catch (err) { next(err as Error); }
});

// --- State Machine ---

const VALID_STATE_TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  idle: ['idle', 'configuring', 'provisioning', 'error'],
  configuring: ['configuring', 'provisioning', 'error'],
  provisioning: ['provisioning', 'starting', 'error'],
  starting: ['starting', 'healthy', 'error'],
  healthy: ['healthy', 'stopped', 'restarting', 'error'],
  stopped: ['stopped', 'configuring', 'idle', 'error', 'starting'],
  restarting: ['restarting', 'starting', 'healthy', 'error'],
  error: ['error', 'configuring', 'idle', 'restarting', 'stopped'],
};

DeploymentSchema.methods.transitionTo = async function(
  newStatus: DeploymentStatus,
  options?: { errorMessage?: string; provisioningStep?: string }
): Promise<void> {
  const currentStatus = this.status as DeploymentStatus;
  const validTransitions = VALID_STATE_TRANSITIONS[currentStatus];
  
  if (!validTransitions || !validTransitions.includes(newStatus)) {
    throw new Error(`Invalid state transition from ${currentStatus} to ${newStatus}`);
  }

  this.status = newStatus;
  
  if (options?.errorMessage) this.errorMessage = options.errorMessage;
  if (options?.provisioningStep !== undefined) this.provisioningStep = options.provisioningStep;
  
  if (newStatus === 'healthy') {
    this.errorMessage = undefined;
    this.lastHeartbeat = new Date();
  }

  await this.save();
};

// --- URL Generation ---

DeploymentSchema.methods.getUrl = function(): string {
  const domain = process.env.DOMAIN || 'localhost';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  
  if (process.env.NODE_ENV === 'development' && this.internalPort) {
    return `http://localhost:${this.internalPort}`;
  }

  return `${protocol}://${this.subdomain}.${domain}`;
};

DeploymentSchema.methods.getAutoLoginUrl = async function(): Promise<string> {
  const secrets = await this.decryptSecrets();
  const baseUrl = this.getUrl();
  return `${baseUrl}?token=${secrets.webUiToken}`;
};

DeploymentSchema.statics.findBySubdomain = function(subdomain: string) {
  return this.findOne({ subdomain: subdomain.toLowerCase() });
};

export const Deployment = model<IDeploymentDocument>('Deployment', DeploymentSchema);
export default Deployment;