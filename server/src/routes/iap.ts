import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { verifyBuyIn, verifyShield } from '../controllers/iapController';

const router = Router();

router.use(authenticate);

router.post('/buyin/verify', verifyBuyIn);
router.post('/shield/verify', verifyShield);

export default router;
