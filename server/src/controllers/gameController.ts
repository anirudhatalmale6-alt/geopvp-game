import { Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../config/database';
import { config } from '../config/env';
import { AuthRequest } from '../middleware/auth';
import { distanceMiles } from '../utils/geo';
import { getCoinTier } from '../utils/coins';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSessionSchema = z.object({
  tierDollars: z.number().int().min(1).max(25),
});

const updateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const attackSchema = z.object({
  targetSessionId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function centsToDollars(cents: number): number {
  return Math.floor(cents / 100);
}

// ---------------------------------------------------------------------------
// POST /api/game/sessions  — create session (buy-in)
// ---------------------------------------------------------------------------

export async function createGameSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { tierDollars } = parsed.data;
    const userId = req.user!.id;

    // Deactivate any existing active session first
    await query(
      `UPDATE game_sessions SET is_active = false WHERE user_id = $1 AND is_active = true`,
      [userId],
    );

    const tierCents = tierDollars * 100;
    const tier = getCoinTier(tierCents);
    const mapCoins = tierDollars * 10; // 10 coins per dollar
    const maxShields = config.maxShieldsPerBuyin;

    // Deduct from wallet (or allow negative balance for now — game mechanics TBD)
    const walletResult = await query(
      `SELECT balance FROM wallets WHERE user_id = $1`,
      [userId],
    );

    if (walletResult.rows.length === 0) {
      // Auto-create wallet
      await query(`INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [userId]);
    }

    // Create session
    const sessionResult = await query(
      `INSERT INTO game_sessions (
         user_id, buyin_amount, coin_tier, map_coins,
         shields_purchased, shields_remaining
       ) VALUES ($1, $2, $3, $4, $5, $5)
       RETURNING *`,
      [userId, tierCents, tier.name, mapCoins, maxShields],
    );

    const session = sessionResult.rows[0];

    // Record transaction
    await query(
      `INSERT INTO transactions (user_id, type, amount, description)
       VALUES ($1, 'buyin', $2, $3)`,
      [userId, -tierCents, `Buy-in: $${tierDollars} ${tier.name} tier`],
    );

    res.status(201).json({ session: formatSession(session) });
  } catch (err) {
    console.error('createGameSession error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/game/sessions/active  — get active session
// ---------------------------------------------------------------------------

export async function getActiveSession(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT * FROM game_sessions WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) {
      res.json({ session: null });
      return;
    }

    res.json({ session: formatSession(result.rows[0]) });
  } catch (err) {
    console.error('getActiveSession error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/game/sessions/location  — update player location
// ---------------------------------------------------------------------------

export async function updatePlayerLocation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = updateLocationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { latitude, longitude } = parsed.data;
    const userId = req.user!.id;

    const result = await query(
      `UPDATE game_sessions
       SET latitude = $1, longitude = $2, last_location_update = now()
       WHERE user_id = $3 AND is_active = true
       RETURNING id`,
      [latitude, longitude, userId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'No active session found.' });
      return;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('updatePlayerLocation error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/game/nearby  — get nearby players
// ---------------------------------------------------------------------------

export async function getNearbyPlayers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    // Get current player location
    const mySession = await query(
      `SELECT latitude, longitude FROM game_sessions
       WHERE user_id = $1 AND is_active = true AND latitude IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    if (mySession.rows.length === 0 || !mySession.rows[0].latitude) {
      res.json({ players: [] });
      return;
    }

    const { latitude: myLat, longitude: myLng } = mySession.rows[0];

    // Bounding box approximation: ~0.25 miles ≈ 0.0036 degrees lat/lng
    const delta = config.attackRadiusMiles * 1.5 * (1 / 69);

    const result = await query(
      `SELECT
         gs.id AS session_id,
         gs.user_id,
         gs.latitude,
         gs.longitude,
         gs.map_coins,
         gs.shield_active_until,
         u.username
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true
         AND gs.user_id != $1
         AND gs.latitude IS NOT NULL
         AND gs.latitude BETWEEN $2 AND $3
         AND gs.longitude BETWEEN $4 AND $5
         AND gs.last_location_update > now() - interval '5 minutes'`,
      [userId, myLat - delta, myLat + delta, myLng - delta, myLng + delta],
    );

    const players = result.rows
      .map((row) => {
        const dist = distanceMiles(myLat, myLng, row.latitude, row.longitude);
        const shieldActive = row.shield_active_until
          ? new Date(row.shield_active_until) > new Date()
          : false;
        return {
          sessionId: row.session_id,
          id: row.user_id,
          username: row.username,
          latitude: row.latitude,
          longitude: row.longitude,
          mapCoins: row.map_coins,
          shieldActive,
          distanceMiles: Math.round(dist * 1000) / 1000,
        };
      })
      .filter((p) => p.distanceMiles <= config.attackRadiusMiles);

    res.json({ players });
  } catch (err) {
    console.error('getNearbyPlayers error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/game/attack  — attack a nearby player
// ---------------------------------------------------------------------------

export async function attackPlayer(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = attackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { targetSessionId } = parsed.data;
    const attackerId = req.user!.id;

    // Wrap in a transaction for consistency
    const result = await transaction(async (q) => {
      // Get attacker session
      const [attackerRes, defenderRes] = await Promise.all([
        q(
          `SELECT gs.*, u.username as attacker_name
           FROM game_sessions gs JOIN users u ON u.id = gs.user_id
           WHERE gs.user_id = $1 AND gs.is_active = true LIMIT 1`,
          [attackerId],
        ),
        q(
          `SELECT gs.*, u.username as defender_name, u.id as defender_user_id
           FROM game_sessions gs JOIN users u ON u.id = gs.user_id
           WHERE gs.id = $1 AND gs.is_active = true LIMIT 1`,
          [targetSessionId],
        ),
      ]);

      if (attackerRes.rows.length === 0) {
        throw new Error('No active session. Start a session to attack.');
      }

      if (defenderRes.rows.length === 0) {
        throw new Error('Target player not found or not active.');
      }

      const attacker = attackerRes.rows[0];
      const defender = defenderRes.rows[0];

      if (attacker.user_id === defender.user_id) {
        throw new Error('Cannot attack yourself.');
      }

      // Verify within attack radius
      if (!attacker.latitude || !defender.latitude) {
        throw new Error('Location not available. Enable GPS and wait for location update.');
      }

      const dist = distanceMiles(
        attacker.latitude, attacker.longitude,
        defender.latitude, defender.longitude,
      );

      if (dist > config.attackRadiusMiles) {
        throw new Error(`Target is too far away (${dist.toFixed(2)} miles). Max: ${config.attackRadiusMiles} miles.`);
      }

      // Check if defender has active shield
      const defenderHasShield = defender.shield_active_until
        ? new Date(defender.shield_active_until) > new Date()
        : false;

      if (defenderHasShield) {
        // Attack blocked
        await q(
          `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
           VALUES ($1, $2, $3, $4, 0, true, false, $5, $6)`,
          [attacker.user_id, defender.user_id, attacker.map_coins, defender.map_coins, attacker.latitude, attacker.longitude],
        );
        return { success: false, coinsStolen: 0, defenderHadShield: true, message: 'Attack blocked by shield!' };
      }

      // Steal 20% of defender's coins (min 1, max 50)
      const coinsStolen = Math.max(1, Math.min(50, Math.floor(defender.map_coins * 0.2)));

      // Update sessions
      await Promise.all([
        q(
          `UPDATE game_sessions SET map_coins = map_coins + $1 WHERE id = $2`,
          [coinsStolen, attacker.id],
        ),
        q(
          `UPDATE game_sessions SET map_coins = GREATEST(0, map_coins - $1) WHERE id = $2`,
          [coinsStolen, defender.id],
        ),
      ]);

      // Record attack
      await q(
        `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)`,
        [attacker.user_id, defender.user_id, attacker.map_coins, defender.map_coins, coinsStolen, attacker.latitude, attacker.longitude],
      );

      // Record transactions
      await Promise.all([
        q(
          `INSERT INTO transactions (user_id, type, amount, description, related_user_id)
           VALUES ($1, 'attack_win', $2, $3, $4)`,
          [attacker.user_id, coinsStolen, `Stole ${coinsStolen} coins from ${defender.defender_name}`, defender.user_id],
        ),
        q(
          `INSERT INTO transactions (user_id, type, amount, description, related_user_id)
           VALUES ($1, 'attack_loss', $2, $3, $4)`,
          [defender.user_id, -coinsStolen, `Lost ${coinsStolen} coins to ${attacker.attacker_name}`, attacker.user_id],
        ),
      ]);

      return {
        success: true,
        coinsStolen,
        defenderHadShield: false,
        message: `Attack successful! Stole ${coinsStolen} coins from ${defender.defender_name}!`,
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error('attackPlayer error:', err);
    const status = err.message?.includes('No active session') ||
                   err.message?.includes('Cannot attack') ||
                   err.message?.includes('too far') ||
                   err.message?.includes('Location not') ? 400 : 500;
    res.status(status).json({ error: err.message || 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/game/shield  — buy/activate a shield
// ---------------------------------------------------------------------------

export async function buyShield(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const sessionResult = await query(
      `SELECT * FROM game_sessions WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    if (sessionResult.rows.length === 0) {
      res.status(400).json({ error: 'No active session. Start a session first.' });
      return;
    }

    const session = sessionResult.rows[0];

    if (session.shields_remaining <= 0) {
      res.status(400).json({ error: 'No shields remaining for this session.' });
      return;
    }

    // Check if shield is already active
    if (session.shield_active_until && new Date(session.shield_active_until) > new Date()) {
      res.status(400).json({ error: 'Shield is already active.' });
      return;
    }

    const shieldExpiry = new Date(Date.now() + config.shieldDurationMinutes * 60 * 1000);

    const updated = await query(
      `UPDATE game_sessions
       SET shields_remaining = shields_remaining - 1,
           shields_purchased = shields_purchased + 1,
           shield_active_until = $1
       WHERE id = $2
       RETURNING *`,
      [shieldExpiry, session.id],
    );

    // Record transaction
    await query(
      `INSERT INTO transactions (user_id, type, amount, description)
       VALUES ($1, 'shield', 0, $2)`,
      [userId, `Shield activated for ${config.shieldDurationMinutes} minutes`],
    );

    res.json({ session: formatSession(updated.rows[0]) });
  } catch (err) {
    console.error('buyShield error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/wallet  — get wallet balance
// ---------------------------------------------------------------------------

export async function getWallet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT user_id, balance FROM wallets WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      // Auto-create
      await query(`INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [userId]);
      res.json({ userId, balance: 0 });
      return;
    }

    res.json({
      userId: result.rows[0].user_id,
      balance: parseInt(result.rows[0].balance, 10),
    });
  } catch (err) {
    console.error('getWallet error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/wallet/transactions  — get transaction history
// ---------------------------------------------------------------------------

export async function getTransactions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT id, type, amount, description, related_user_id, created_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId],
    );

    const transactions = result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: parseInt(row.amount, 10),
      description: row.description,
      relatedUserId: row.related_user_id,
      createdAt: row.created_at,
    }));

    res.json({ transactions });
  } catch (err) {
    console.error('getTransactions error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSession(row: Record<string, any>) {
  return {
    id: row.id,
    userId: row.user_id,
    buyinAmount: parseInt(row.buyin_amount, 10),
    coinTier: row.coin_tier,
    mapCoins: parseInt(row.map_coins, 10),
    shieldsPurchased: parseInt(row.shields_purchased, 10),
    shieldsRemaining: parseInt(row.shields_remaining, 10),
    shieldActiveUntil: row.shield_active_until,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    lastLocationUpdate: row.last_location_update,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}
