import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createGameSession,
  getActiveSession,
  updatePlayerLocation,
  getNearbyPlayers,
  getAllPlayers,
  attackPlayer,
  buyShield,
  getWallet,
  getTransactions,
  getActiveCoinDrops,
  collectCoinDrop,
} from '../controllers/gameController';

const router = Router();

// All game routes require authentication
router.use(authenticate);

// Session routes
router.post('/sessions', createGameSession);
router.get('/sessions/active', getActiveSession);
router.post('/sessions/location', updatePlayerLocation);

// Gameplay routes
router.get('/nearby', getNearbyPlayers);
router.get('/players', getAllPlayers);
router.post('/attack', attackPlayer);
router.post('/shield', buyShield);

// Coin drop routes
router.get('/coins', getActiveCoinDrops);
router.post('/coins/:id/collect', collectCoinDrop);

export default router;
