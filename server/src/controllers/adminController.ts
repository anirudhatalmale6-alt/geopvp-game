import { Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { COIN_TIERS } from '../utils/coins';

const spawnBotsSchema = z.object({
  count: z.number().int().min(1).max(2000),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.1).max(3000).default(50),
});

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

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const result = await query(
      `SELECT u.id, u.username, u.email, u.is_admin, u.is_verified, u.created_at,
              gs.map_coins, gs.coin_tier, gs.buyin_amount, gs.is_active as has_active_session,
              gs.latitude, gs.longitude, gs.last_location_update
       FROM users u
       LEFT JOIN game_sessions gs ON gs.user_id = u.id AND gs.is_active = true
       ORDER BY u.created_at DESC`,
    );

    const users = result.rows.map((r) => ({
      id: r.id,
      username: r.username,
      email: r.email,
      isAdmin: r.is_admin,
      isVerified: r.is_verified,
      createdAt: r.created_at,
      activeSession: r.has_active_session ? {
        mapCoins: parseInt(r.map_coins || '0', 10),
        coinTier: r.coin_tier,
        buyinAmount: parseInt(r.buyin_amount || '0', 10),
        latitude: r.latitude ? parseFloat(r.latitude) : null,
        longitude: r.longitude ? parseFloat(r.longitude) : null,
        lastLocationUpdate: r.last_location_update,
      } : null,
    }));

    res.json({ users, count: users.length });
  } catch (err) {
    console.error('listUsers error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function toggleAdmin(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { id } = req.params;
    const result = await query(
      `UPDATE users SET is_admin = NOT is_admin WHERE id = $1 RETURNING id, username, is_admin`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('toggleAdmin error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function getActivePlayers(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const result = await query(
      `SELECT gs.id as session_id, gs.user_id, gs.latitude, gs.longitude,
              gs.map_coins, gs.coin_tier, gs.buyin_amount, gs.shield_active_until,
              gs.last_location_update, gs.created_at,
              u.username, u.email
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true AND gs.latitude IS NOT NULL
       ORDER BY gs.last_location_update DESC`,
    );

    const players = result.rows.map((r) => ({
      sessionId: r.session_id,
      userId: r.user_id,
      username: r.username,
      email: r.email,
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      mapCoins: parseInt(r.map_coins, 10),
      coinTier: r.coin_tier,
      buyinAmount: parseInt(r.buyin_amount, 10),
      shieldActive: r.shield_active_until ? new Date(r.shield_active_until) > new Date() : false,
      lastLocationUpdate: r.last_location_update,
      sessionStart: r.created_at,
    }));

    res.json({ players, count: players.length });
  } catch (err) {
    console.error('getActivePlayers error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function spawnBots(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const parsed = spawnBotsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { count, centerLat, centerLng, radiusKm } = parsed.data;
    const hashedPassword = await bcrypt.hash('BotPass123!', 4);
    let created = 0;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const dist = Math.sqrt(Math.random()) * radiusKm;
      const latOffset = (dist / 111.32) * Math.cos(angle);
      const lngOffset = (dist / (111.32 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
      const lat = Math.max(-90, Math.min(90, centerLat + latOffset));
      const lng = ((centerLng + lngOffset + 540) % 360) - 180;

      const botDollars = Math.floor(Math.random() * 15) + 1; // $1-$15
      const mapCoins = botDollars * 10;
      const botId = crypto.randomUUID();
      const prowlerNum = Math.floor(Math.random() * 9000 + 1000);
      const botName = `Prowler${prowlerNum}`;

      const userResult = await query(
        `INSERT INTO users (id, username, email, password_hash, is_verified)
         VALUES ($1, $2, $3, $4, true) RETURNING id`,
        [botId, botName, `${botName}@bot.local`, hashedPassword],
      );

      await query(
        `INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [userResult.rows[0].id],
      );

      const botShieldExpiry = new Date(Date.now() + 30 * 60 * 1000);
      await query(
        `INSERT INTO game_sessions (user_id, buyin_amount, coin_tier, map_coins, latitude, longitude, last_location_update, is_active, shields_purchased, shields_remaining, shield_active_until)
         VALUES ($1, $2, 'prowler', $3, $4, $5, now(), true, 0, 3, $6)`,
        [userResult.rows[0].id, botDollars * 100, mapCoins, lat, lng, botShieldExpiry],
      );

      created++;
    }

    res.status(201).json({ ok: true, botsCreated: created });
  } catch (err) {
    console.error('spawnBots error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function clearBots(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const sessions = await query(
      `DELETE FROM game_sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@bot.local') RETURNING id`,
    );
    const wallets = await query(
      `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@bot.local')`,
    );
    const users = await query(
      `DELETE FROM users WHERE email LIKE '%@bot.local' RETURNING id`,
    );

    res.json({
      ok: true,
      sessionsRemoved: sessions.rowCount,
      usersRemoved: users.rowCount,
    });
  } catch (err) {
    console.error('clearBots error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function resetDeviceLock(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { id } = req.params;
    const result = await query(
      `UPDATE users SET device_id = NULL WHERE id = $1 RETURNING id, username`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    res.json({ ok: true, user: result.rows[0], message: 'Device lock cleared. User can login from any device.' });
  } catch (err) {
    console.error('resetDeviceLock error:', err);
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
