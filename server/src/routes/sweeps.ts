import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getSweepStatus,
  claimDailyBonus,
  redeemSweepCode,
} from '../controllers/sweepsController';

const router = Router();

router.use(authenticate);

router.get('/status', getSweepStatus);
router.post('/daily', claimDailyBonus);
router.post('/redeem-code', redeemSweepCode);

export default router;
