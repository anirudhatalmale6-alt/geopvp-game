import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createBuyInOrder,
  captureBuyInOrder,
  createShieldOrder,
  captureShieldOrder,
} from '../controllers/paypalController';

const router = Router();

router.use(authenticate);

// Buy-in payment flow
router.post('/buyin/create', createBuyInOrder);
router.post('/buyin/capture', captureBuyInOrder);

// Shield payment flow
router.post('/shield/create', createShieldOrder);
router.post('/shield/capture', captureShieldOrder);

// Return/cancel URLs (user redirected here after PayPal approval)
router.get('/return', (_req: Request, res: Response) => {
  res.send('<html><body><script>window.close();</script><p>Payment approved. You can close this window.</p></body></html>');
});

router.get('/cancel', (_req: Request, res: Response) => {
  res.send('<html><body><script>window.close();</script><p>Payment cancelled. You can close this window.</p></body></html>');
});

export default router;
