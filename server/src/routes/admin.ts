import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  dropCoin,
  bulkDropCoins,
  listCoinDrops,
  deleteCoinDrop,
  clearAllDrops,
  getStats,
  listUsers,
  toggleAdmin,
  getActivePlayers,
  spawnBots,
  clearBots,
  resetDeviceLock,
  listTransactions,
  listAttacks,
} from '../controllers/adminController';

const router = Router();

router.use(authenticate);

router.get('/stats', getStats);
router.get('/users', listUsers);
router.post('/users/:id/toggle-admin', toggleAdmin);
router.get('/players', getActivePlayers);
router.post('/coins/drop', dropCoin);
router.post('/coins/bulk-drop', bulkDropCoins);
router.get('/coins', listCoinDrops);
router.delete('/coins/:id', deleteCoinDrop);
router.delete('/coins', clearAllDrops);
router.post('/bots/spawn', spawnBots);
router.delete('/bots', clearBots);
router.post('/users/:id/reset-device', resetDeviceLock);
router.get('/transactions', listTransactions);
router.get('/attacks', listAttacks);

export default router;
