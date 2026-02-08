import { Router } from 'express';
import authRoutes from './auth';
import deploymentRoutes from './deployments';
import billingRoutes from './billing';
import infraRoutes from './infra'; // Check if you have created src/routes/infra.ts

const router = Router();

router.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    status: 'healthy', 
    timestamp: new Date().toISOString() 
  });
});

router.use('/auth', authRoutes);
router.use('/deployments', deploymentRoutes);
router.use('/billing', billingRoutes);
router.use('/infra', infraRoutes); // Needed for Caddy

export default router;