import { Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

const dropCoinSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  amount: z.number().int().min(1).max(1000),
});

const bulkDropSchema = z.object({
  drops: z.array(dropCoinSchema).min(1).max(100),
});

async function requireAdmin(req: AuthRequest, res: Response): Promise<boolean> {
  const userId = req.user!.id;
  const result = await query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
  if (result.rows.length === 0 || !result.rows[0].is_admin) {
    res.status(403).json({ error: 'Admin access required.' });
    return false;
  }
  return true;
}

export async function dropCoin(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const parsed = dropCoinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { latitude, longitude, amount } = parsed.data;
    const result = await query(
      `INSERT INTO coin_drops (amount, latitude, longitude, created_by, is_active)
       VALUES ($1, $2, $3, $4, true) RETURNING *`,
      [amount, latitude, longitude, req.user!.id],
    );

    res.status(201).json({ drop: formatDrop(result.rows[0]) });
  } catch (err) {
    console.error('dropCoin error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function bulkDropCoins(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const parsed = bulkDropSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const created = [];
    for (const drop of parsed.data.drops) {
      const result = await query(
        `INSERT INTO coin_drops (amount, latitude, longitude, created_by, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [drop.amount, drop.latitude, drop.longitude, req.user!.id],
      );
      created.push(formatDrop(result.rows[0]));
    }

    res.status(201).json({ drops: created, count: created.length });
  } catch (err) {
    console.error('bulkDropCoins error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function listCoinDrops(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const activeOnly = req.query.active !== 'false';
    const result = await query(
      activeOnly
        ? `SELECT * FROM coin_drops WHERE is_active = true ORDER BY created_at DESC LIMIT 200`
        : `SELECT * FROM coin_drops ORDER BY created_at DESC LIMIT 200`,
    );

    res.json({ drops: result.rows.map(formatDrop), count: result.rows.length });
  } catch (err) {
    console.error('listCoinDrops error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function deleteCoinDrop(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { id } = req.params;
    await query(`UPDATE coin_drops SET is_active = false WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('deleteCoinDrop error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function clearAllDrops(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const result = await query(`UPDATE coin_drops SET is_active = false WHERE is_active = true`);
    res.json({ ok: true, cleared: result.rowCount });
  } catch (err) {
    console.error('clearAllDrops error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function getStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const [sessions, players, drops, users] = await Promise.all([
      query(`SELECT COUNT(*) FROM game_sessions WHERE is_active = true`),
      query(`SELECT COUNT(*) FROM game_sessions WHERE is_active = true AND latitude IS NOT NULL AND last_location_update > now() - interval '30 minutes'`),
      query(`SELECT COUNT(*) FROM coin_drops WHERE is_active = true`),
      query(`SELECT COUNT(*) FROM users`),
    ]);

    res.json({
      activeSessions: parseInt(sessions.rows[0].count),
      onlinePlayers: parseInt(players.rows[0].count),
      activeDrops: parseInt(drops.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
    });
  } catch (err) {
    console.error('getStats error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

function formatDrop(row: Record<string, any>) {
  return {
    id: row.id,
    amount: parseInt(row.amount, 10),
    latitude: parseFloat(row.latitude),
    longitude: parseFloat(row.longitude),
    isActive: row.is_active,
    pickedUpBy: row.picked_up_by,
    pickedUpAt: row.picked_up_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
