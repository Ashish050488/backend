import { Router } from 'express';
import { paymentService } from '@services/PaymentService';
import { authenticateToken } from '@middleware/auth';
import { validateBody } from '@middleware/validate';
import { z } from 'zod';

const router = Router();

const createOrderSchema = z.object({
  plan: z.enum(['hobby', 'pro'])
});

const verifyOrderSchema = z.object({
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  signature: z.string(),
  plan: z.enum(['hobby', 'pro'])
});

// Create Order
router.post('/create-order', authenticateToken, validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const { plan } = req.body;
    const order = await paymentService.createOrder(req.user!.id, plan);
    res.json(order);
  } catch (error) {
    next(error);
  }
});

// Verify Payment
router.post('/verify', authenticateToken, validateBody(verifyOrderSchema), async (req, res, next) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, signature, plan } = req.body;
    
    await paymentService.verifyPayment(
      razorpayOrderId,
      razorpayPaymentId,
      signature,
      req.user!.id,
      plan
    );
    
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ 
      success: false, 
      error: { code: 'PAYMENT_FAILED', message: 'Invalid payment signature' } 
    });
  }
});

export default router;