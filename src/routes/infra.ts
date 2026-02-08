import { Router } from 'express';
import { Deployment } from '@models/Deployment';

const router = Router();

// Caddy calls this to verify if it should issue an SSL certificate
router.get('/domain-check', async (req, res) => {
  const domain = req.query.domain as string;
  if (!domain) return res.sendStatus(400);

  // Logic: extracting 'alice-agent' from 'alice-agent.simpleclaw.com'
  // NOTE: In production, ensure this logic matches your domain structure exactly.
  const subdomain = domain.split('.')[0]; 

  try {
    const exists = await Deployment.exists({ subdomain: subdomain.toLowerCase() });
    if (exists) {
      return res.sendStatus(200); 
    }
  } catch (e) {
    // database error
    return res.sendStatus(500);
  }
  
  return res.sendStatus(404);
});

export default router;