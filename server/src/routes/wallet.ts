import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getWallet, getTransactions, redeemSweepCoins, getRedemptions } from '../controllers/gameController';

const router = Router();

router.use(authenticate);

router.get('/', getWallet);
router.get('/transactions', getTransactions);
router.post('/redeem', redeemSweepCoins);
router.get('/redemptions', getRedemptions);

export default router;
