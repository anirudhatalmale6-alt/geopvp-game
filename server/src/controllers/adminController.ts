import { Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { COIN_TIERS, getCoinTier } from '../utils/coins';
import { sendPayout } from '../services/paypal';
import * as tabapay from '../services/tabapay';
import { setBotHome } from '../bot/botAI';
import { getIO } from '../socket/ioInstance';

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

const moveBotSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const setCoinsSchema = z.object({
  coins: z.number().int().min(0).max(1000000),
});

// Single active admin session — only one admin can be logged into the panel at a time
let activeAdminSession: { userId: string; token: string; loginAt: number } | null = null;

async function requireAdmin(req: AuthRequest, res: Response): Promise<boolean> {
  const userId = req.user!.id;
  const result = await query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
  if (result.rows.length === 0 || !result.rows[0].is_admin) {
    res.status(403).json({ error: 'Admin access required.' });
    return false;
  }

  // Check if this is the active admin session
  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  if (activeAdminSession && activeAdminSession.token !== token) {
    res.status(401).json({ error: 'Session expired. Another admin has logged in.' });
    return false;
  }

  return true;
}

export async function adminLogin(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await query(`SELECT is_admin, username FROM users WHERE id = $1`, [userId]);
  if (result.rows.length === 0 || !result.rows[0].is_admin) {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }

  const token = req.headers.authorization?.replace('Bearer ', '') || '';

  // Invalidate any previous admin session
  activeAdminSession = { userId, token, loginAt: Date.now() };

  res.json({ success: true, message: 'Admin session activated.' });
}

export async function adminLogout(req: AuthRequest, res: Response): Promise<void> {
  const token = req.headers.authorization?.replace('Bearer ', '') || '';
  if (activeAdminSession && activeAdminSession.token === token) {
    activeAdminSession = null;
  }
  res.json({ success: true });
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
              gs.latitude, gs.longitude, gs.last_location_update,
              EXISTS (SELECT 1 FROM game_sessions s WHERE s.user_id = u.id) AS ever_played
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
      everPlayed: r.ever_played,
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

// Manually relocate a prowler bot to a new spot on the map. Updates the bot's
// active session position AND its in-memory "home" anchor so the AI leash keeps
// it in the new area instead of dragging it back to its spawn point.
export async function moveBot(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { userId } = req.params;
    const parsed = moveBotSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const { latitude, longitude } = parsed.data;

    // Confirm this is actually a bot session (safety — don't teleport real users)
    const sessionRes = await query(
      `SELECT gs.id AS session_id, u.username
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.user_id = $1 AND gs.is_active = true AND u.email LIKE '%@bot.local'
       LIMIT 1`,
      [userId],
    );
    if (sessionRes.rows.length === 0) {
      res.status(404).json({ error: 'Active bot not found for that id.' });
      return;
    }
    const { session_id, username } = sessionRes.rows[0];

    await query(
      `UPDATE game_sessions SET latitude = $1, longitude = $2, last_location_update = now() WHERE id = $3`,
      [latitude, longitude, session_id],
    );

    // Move its home anchor so the AI doesn't walk it back
    setBotHome(userId, latitude, longitude);

    // Push the new position to live maps immediately
    const io = getIO();
    if (io) {
      const update = [{
        userId,
        sessionId: session_id,
        username,
        lat: latitude,
        lng: longitude,
        ts: Date.now(),
        coinTier: 'prowler',
      }];
      io.to('game').emit('players:batch-update', update);
      io.of('/spectator').emit('players:batch-update', update);
    }

    res.json({ ok: true, username, latitude, longitude });
  } catch (err) {
    console.error('moveBot error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// Set a player's on-map coin count to an exact value (admin override). Works on
// any active session — real player or bot. Records an audit transaction of the
// difference so the change is traceable in the ledger.
export async function setPlayerCoins(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { userId } = req.params;
    const parsed = setCoinsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const { coins } = parsed.data;

    const sessionRes = await query(
      `SELECT gs.id AS session_id, gs.map_coins, u.username
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.user_id = $1 AND gs.is_active = true
       LIMIT 1`,
      [userId],
    );
    if (sessionRes.rows.length === 0) {
      res.status(404).json({ error: 'Player has no active game session. They need to be in a live game to adjust coins.' });
      return;
    }

    const { session_id, username } = sessionRes.rows[0];
    const oldCoins = parseInt(sessionRes.rows[0].map_coins || '0', 10);
    const delta = coins - oldCoins;

    await query(
      `UPDATE game_sessions SET map_coins = $1 WHERE id = $2`,
      [coins, session_id],
    );

    // Best-effort audit log — never let a ledger issue break the adjustment
    if (delta !== 0) {
      try {
        await query(
          `INSERT INTO transactions (user_id, type, amount, currency, description)
           VALUES ($1, 'deposit', $2, 'prowl', $3)`,
          [userId, delta, `Admin coin adjustment (${oldCoins} -> ${coins}) by ${req.user!.id}`],
        );
      } catch (logErr) {
        console.error('setPlayerCoins audit log failed (non-fatal):', logErr);
      }
    }

    // Nudge the player's app to refresh its wallet/session
    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit('session:coins-updated', { mapCoins: coins });
    }

    res.json({ ok: true, username, oldCoins, newCoins: coins });
  } catch (err) {
    console.error('setPlayerCoins error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// Pre-load coins onto an account BEFORE the user plays. If the user has no
// active game session (they signed up but haven't bought in), this creates one
// pre-filled with the given coins so the balance is waiting for them the moment
// they open the app. If they already have an active session, it just sets the
// coins (same as setPlayerCoins). Location stays null until the app shares GPS,
// so they won't appear on the map or be attackable until they actually play.
export async function loadCoins(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;

    const { userId } = req.params;
    const parsed = setCoinsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const { coins } = parsed.data;

    const userRes = await query(`SELECT id, username FROM users WHERE id = $1`, [userId]);
    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    const username = userRes.rows[0].username;

    const sessRes = await query(
      `SELECT id, map_coins FROM game_sessions WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId],
    );

    const buyinCents = coins * 10; // 10 coins per dollar -> value in cents
    const tier = getCoinTier(buyinCents);

    let created = false;
    let oldCoins = 0;

    if (sessRes.rows.length > 0) {
      oldCoins = parseInt(sessRes.rows[0].map_coins || '0', 10);
      await query(`UPDATE game_sessions SET map_coins = $1 WHERE id = $2`, [coins, sessRes.rows[0].id]);
    } else {
      await query(`INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [userId]);
      await query(
        `INSERT INTO game_sessions (user_id, buyin_amount, coin_tier, map_coins, shields_purchased, shields_remaining, is_active)
         VALUES ($1, $2, $3, $4, 0, 0, true)`,
        [userId, buyinCents, tier.name, coins],
      );
      created = true;
    }

    // Best-effort audit — never let a ledger issue break the load
    try {
      await query(
        `INSERT INTO transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'deposit', $2, 'prowl', $3)`,
        [userId, coins - oldCoins, `Admin ${created ? 'loaded new account with' : 'set'} ${coins} coins by ${req.user!.id}`],
      );
    } catch (logErr) {
      console.error('loadCoins audit log failed (non-fatal):', logErr);
    }

    const io = getIO();
    if (io) io.to(`user:${userId}`).emit('session:coins-updated', { mapCoins: coins });

    res.json({ ok: true, username, created, newCoins: coins });
  } catch (err) {
    console.error('loadCoins error:', err);
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

export async function listTransactions(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;
    const typeFilter = req.query.type as string;
    const userFilter = req.query.userId as string;

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;
    if (typeFilter) { where += ` AND t.type = $${idx}`; params.push(typeFilter); idx++; }
    if (userFilter) { where += ` AND t.user_id = $${idx}`; params.push(userFilter); idx++; }

    const [txResult, countResult] = await Promise.all([
      query(
        `SELECT t.*, u.username, u.email FROM transactions t JOIN users u ON u.id = t.user_id ${where} ORDER BY t.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`,
        [...params, limit, offset]
      ),
      query(`SELECT COUNT(*) FROM transactions t ${where}`, params),
    ]);

    res.json({
      transactions: txResult.rows.map(r => ({
        id: r.id, type: r.type, amount: parseInt(r.amount), currency: r.currency,
        description: r.description, username: r.username, email: r.email,
        userId: r.user_id, relatedUserId: r.related_user_id, createdAt: r.created_at,
      })),
      total: parseInt(countResult.rows[0].count),
      page, limit,
    });
  } catch (err) {
    console.error('listTransactions error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function listAttacks(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!(await requireAdmin(req, res))) return;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT a.*, u1.username as attacker_name, u1.email as attacker_email,
              u2.username as defender_name, u2.email as defender_email
       FROM attacks a
       JOIN users u1 ON u1.id = a.attacker_id
       JOIN users u2 ON u2.id = a.defender_id
       ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      attacks: result.rows.map(r => ({
        id: r.id, attackerName: r.attacker_name, attackerEmail: r.attacker_email,
        defenderName: r.defender_name, defenderEmail: r.defender_email,
        coinsStolen: parseInt(r.coins_stolen), success: r.success,
        defenderHadShield: r.defender_had_shield, createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('listAttacks error:', err);
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

// ---------------------------------------------------------------------------
// Withdrawal Management
// ---------------------------------------------------------------------------

export async function listWithdrawals(req: AuthRequest, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  try {
    const status = (req.query.status as string) || 'pending';
    const result = await query(
      `SELECT w.*, u.username, u.email
       FROM withdrawals w
       JOIN users u ON u.id = w.user_id
       WHERE w.status = $1
       ORDER BY w.created_at DESC
       LIMIT 100`,
      [status],
    );

    const withdrawals = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      email: row.email,
      amount: row.amount,
      method: row.method,
      status: row.status,
      payoutDetails: row.payout_details,
      adminNotes: row.admin_notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    res.json({ withdrawals });
  } catch (err) {
    console.error('listWithdrawals error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function approveWithdrawal(req: AuthRequest, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { id } = req.params;

    const result = await query(
      `SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending'`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pending withdrawal not found.' });
      return;
    }

    const withdrawal = result.rows[0];
    const details = withdrawal.payout_details || {};
    const recipient = details.recipient;
    const senderItemId = details.senderItemId || `coinprowl-approve-${Date.now()}`;
    const amountDollars = (withdrawal.amount / 100).toFixed(2);
    const method = withdrawal.method || 'paypal';

    // -----------------------------------------------------------------------
    // Debit card (Tabapay push-to-card)
    // -----------------------------------------------------------------------
    if (method === 'debit') {
      const accountID = details.tabapayAccountID;
      if (!accountID) {
        res.status(400).json({ error: 'No debit card token found on this withdrawal.' });
        return;
      }
      try {
        const push = await tabapay.pushToCard(accountID, amountDollars, senderItemId);
        await query(
          `UPDATE withdrawals
           SET status = 'completed',
               payout_details = payout_details || $1,
               admin_notes = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [
            JSON.stringify({ tabapayTransactionID: push.transactionID, tabapayStatus: push.status }),
            `Approved by admin ${req.user!.id}`,
            id,
          ],
        );
        res.json({ success: true, message: `$${amountDollars} sent to ${details.network || 'debit'} card •••• ${details.last4 || ''}.` });
      } catch (payoutErr: any) {
        console.error('Tabapay payout error during approval:', payoutErr);
        res.status(500).json({ error: `Debit card payout failed: ${payoutErr.message}` });
      }
      return;
    }

    // -----------------------------------------------------------------------
    // PayPal / Venmo
    // -----------------------------------------------------------------------
    if (!recipient) {
      res.status(400).json({ error: 'No recipient found in withdrawal details.' });
      return;
    }

    try {
      const payoutResult = await sendPayout(
        recipient,
        amountDollars,
        senderItemId,
        `CoinProwl sweep coin redemption — $${amountDollars}`,
        method,
      );

      await query(
        `UPDATE withdrawals
         SET status = 'completed',
             payout_details = payout_details || $1,
             admin_notes = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [
          JSON.stringify({ batchId: payoutResult.batchId, paypalStatus: payoutResult.status }),
          `Approved by admin ${req.user!.id}`,
          id,
        ],
      );

      res.json({ success: true, message: `$${amountDollars} sent to ${recipient} via ${method}.` });
    } catch (payoutErr: any) {
      console.error('Payout error during approval:', payoutErr);
      res.status(500).json({ error: `PayPal payout failed: ${payoutErr.message}` });
    }
  } catch (err) {
    console.error('approveWithdrawal error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// Mark a pending withdrawal as PAID manually — used when the admin sends the
// money themselves (e.g. straight from the PayPal/Venmo app) instead of through
// an automated payout API. Coins were already deducted when the user requested,
// so this just closes out the record. This is the interim cash-out method while
// an automated payout processor (Tabapay) is being set up.
export async function markWithdrawalPaid(req: AuthRequest, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { id } = req.params;
    const reference = (req.body?.reference as string) || '';

    const result = await query(
      `SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending'`,
      [id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pending withdrawal not found.' });
      return;
    }

    const withdrawal = result.rows[0];
    const amountDollars = (withdrawal.amount / 100).toFixed(2);
    const method = (withdrawal.method || 'paypal').toString();

    await query(
      `UPDATE withdrawals
       SET status = 'completed',
           payout_details = payout_details || $1,
           admin_notes = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [
        JSON.stringify({ manualPaid: true, manualReference: reference }),
        `Paid manually via ${method}${reference ? ` (ref: ${reference})` : ''} by admin ${req.user!.id}`,
        id,
      ],
    );

    res.json({ success: true, message: `Marked $${amountDollars} as paid manually.` });
  } catch (err) {
    console.error('markWithdrawalPaid error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

export async function denyWithdrawal(req: AuthRequest, res: Response): Promise<void> {
  if (!(await requireAdmin(req, res))) return;

  try {
    const { id } = req.params;
    const reason = (req.body.reason as string) || 'Denied by admin';

    const result = await query(
      `SELECT * FROM withdrawals WHERE id = $1 AND status = 'pending'`,
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Pending withdrawal not found.' });
      return;
    }

    const withdrawal = result.rows[0];

    // Refund sweep coins
    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'deposit', $2, 'sweep', $3)`,
      [withdrawal.user_id, withdrawal.amount, `Redemption denied: ${reason}`],
    );

    await query(
      `UPDATE withdrawals
       SET status = 'denied',
           admin_notes = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [`Denied: ${reason}`, id],
    );

    res.json({ success: true, message: 'Withdrawal denied. Sweep coins refunded to user.' });
  } catch (err) {
    console.error('denyWithdrawal error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}
