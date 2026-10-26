import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getMyReferrals, claimReferral } from '../controllers/referralController';

const router = Router();
router.use(authenticate);
router.get('/me', getMyReferrals);
router.post('/claim', claimReferral);
export default router;
