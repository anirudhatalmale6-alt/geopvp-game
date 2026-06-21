import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createBuyInOrder,
  captureBuyInOrder,
  createShieldOrder,
  captureShieldOrder,
} from '../controllers/paypalController';

const router = Router();

// Return/cancel URLs — no auth required (PayPal redirects here)
router.get('/return', (_req: Request, res: Response) => {
  res.send('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#0a0e1a;color:#00e5ff;"><h2>Payment approved! Returning to app...</h2></body></html>');
});

router.get('/cancel', (_req: Request, res: Response) => {
  res.send('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;background:#0a0e1a;color:#ff4444;"><h2>Payment cancelled. Returning to app...</h2></body></html>');
});

// Authenticated routes
router.use(authenticate);

// Buy-in payment flow
router.post('/buyin/create', createBuyInOrder);
router.post('/buyin/capture', captureBuyInOrder);

// Shield payment flow
router.post('/shield/create', createShieldOrder);
router.post('/shield/capture', captureShieldOrder);

export default router;
