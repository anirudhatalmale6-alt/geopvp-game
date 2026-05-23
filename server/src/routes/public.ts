import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { getTierByName } from '../utils/coins';

const router = Router();

router.get('/players', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT
         gs.user_id AS id,
         gs.latitude,
         gs.longitude,
         gs.map_coins,
         gs.coin_tier,
         u.username,
         u.email
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true
         AND gs.latitude IS NOT NULL
         AND (gs.last_location_update > now() - interval '30 minutes' OR u.email LIKE '%@bot.local')
       LIMIT 2000`,
    );

    const players = result.rows.map((row) => {
      const isBot = row.email?.endsWith('@bot.local') || false;
      const tier = getTierByName(row.coin_tier);
      return {
        id: row.id,
        username: row.username,
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude),
        mapCoins: parseInt(row.map_coins, 10),
        isBot,
        tierColor: tier?.color || '#ffd700',
      };
    });

    res.json({ players });
  } catch (err) {
    console.error('public/players error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
