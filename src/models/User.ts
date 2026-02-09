import mongoose, { Schema, model, Model } from 'mongoose';
import bcrypt from 'bcryptjs';
import { 
  IUser, 
  IUserDocument, 
  SubscriptionStatus, 
  UserTier 
} from '../types';

const SALT_ROUNDS = 12;

export const TIER_CONFIG: Record<string, { maxAgents: number; priority: number }> = {
  free: { maxAgents: 0, priority: 0 },
  hobby: { maxAgents: 1, priority: 1 },
  pro: { maxAgents: 5, priority: 2 },
  enterprise: { maxAgents: 20, priority: 3 },
};

const UserSchema = new Schema<IUserDocument>(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      validate: {
        validator: (email: string) => {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
        },
        message: 'Please provide a valid email address',
      },
    },
    passwordHash: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [60, 'Password hash must be at least 60 characters'],
    },
    razorpayCustomerId: {
      type: String,
      sparse: true,
      index: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ['free', 'active', 'past_due', 'canceled'],
      default: 'free',
      index: true,
    },
    tier: {
      type: String,
      enum: ['hobby', 'pro', 'enterprise'],
      default: 'hobby',
      index: true,
    },
    maxAgents: {
      type: Number,
      default: 1,
      min: [0, 'Max agents cannot be negative'],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: any) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      transform: (_doc, ret: any) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

UserSchema.index({ subscriptionStatus: 1, tier: 1 });

UserSchema.methods.comparePassword = async function(password: string): Promise<boolean> {
  return bcrypt.compare(password, this.passwordHash);
};

interface IUserModel extends Model<IUserDocument> {
  hashPassword(password: string): Promise<string>;
  findByEmail(email: string): Promise<IUserDocument | null>;
}

UserSchema.statics.hashPassword = async function(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
};

UserSchema.statics.findByEmail = function(email: string) {
  return this.findOne({ email: email.toLowerCase() });
};

UserSchema.methods.canCreateAgent = async function(): Promise<{ allowed: boolean; reason?: string }> {
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

UserSchema.methods.updateSubscription = async function(
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

UserSchema.pre('save', async function(next) {
  if (this.isModified('tier')) {
    const tier = this.tier as UserTier;
    if (TIER_CONFIG[tier]) {
      this.maxAgents = TIER_CONFIG[tier].maxAgents;
    }
  }
  next();
});

export const User = model<IUserDocument, IUserModel>('User', UserSchema);

export default User;