import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '@config/index';
import { User } from '@models/User';
import { logger } from '@utils/logger';

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: config.payments.razorpayKeyId,
  key_secret: config.payments.razorpayKeySecret,
});

export class PaymentService {

  /**
   * Create an Order for Frontend
   */
  async createOrder(userId: string, plan: 'hobby' | 'pro') {
    const planDetails = config.payments.plans[plan];

    const options = {
      amount: planDetails.amount,
      currency: planDetails.currency,
      // Truncate userId to last 6 chars to keep it under 40 chars
      receipt: `rcpt_${userId.slice(-6)}_${Date.now()}`,
      notes: {
        userId: userId,
        plan: plan
      }
    };

    try {
      const order = await razorpay.orders.create(options);
      return order;
    } catch (error) {
      logger.error('Razorpay Order Creation Failed', error);
      throw error;
    }
  }

  /**
   * Verify Payment Signature
   */
  async verifyPayment(
    razorpayOrderId: string,
    razorpayPaymentId: string,
    signature: string,
    userId: string,
    plan: 'hobby' | 'pro'
  ) {
    const body = razorpayOrderId + "|" + razorpayPaymentId;

    const expectedSignature = crypto
      .createHmac('sha256', config.payments.razorpayKeySecret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === signature) {
      await this.activateSubscription(userId, plan);
      return { success: true };
    } else {
      logger.error(`Payment Signature Mismatch for User ${userId}`);
      throw new Error('Invalid Payment Signature');
    }
  }

  private async activateSubscription(userId: string, plan: 'hobby' | 'pro') {
    // 1 Agent for Hobby, 5 for Pro
    const maxAgents = plan === 'pro' ? 5 : 1;

    await User.findByIdAndUpdate(userId, {
      subscriptionStatus: 'active',
      tier: plan,
      maxAgents: maxAgents
    });

    logger.info(`Subscription activated for ${userId} on plan ${plan}`);
  }
}

export const paymentService = new PaymentService();