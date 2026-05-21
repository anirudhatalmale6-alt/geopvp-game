import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  dropCoin,
  bulkDropCoins,
  listCoinDrops,
  deleteCoinDrop,
  clearAllDrops,
  getStats,
} from '../controllers/adminController';

const router = Router();

router.use(authenticate);

router.post('/coins/drop', dropCoin);
router.post('/coins/bulk-drop', bulkDropCoins);
router.get('/coins', listCoinDrops);
router.delete('/coins/:id', deleteCoinDrop);
router.delete('/coins', clearAllDrops);
router.get('/stats', getStats);

export default router;
