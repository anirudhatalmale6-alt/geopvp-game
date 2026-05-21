import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  createGameSession,
  getActiveSession,
  updatePlayerLocation,
  getNearbyPlayers,
  attackPlayer,
  buyShield,
  getWallet,
  getTransactions,
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
router.post('/attack', attackPlayer);
router.post('/shield', buyShield);

export default router;
