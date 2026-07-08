import { Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../config/database';
import { config } from '../config/env';
import { AuthRequest } from '../middleware/auth';
import { distanceMiles } from '../utils/geo';
import { getCoinTier } from '../utils/coins';
import { getIO } from '../socket/ioInstance';
import { sendPushNotification } from '../utils/pushNotification';
import { checkLocationBlocked, isBlockedState, getBlockedStates } from '../utils/geofence';
import { sendPayout } from '../services/paypal';

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

const redeemSchema = z.object({
  recipient: z.string().min(1, 'Email or phone number required'),
  amountCents: z.number().int().min(1000, 'Minimum redemption is $10.00'),
  method: z.enum(['paypal', 'venmo']).default('paypal'),
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

    // Ensure wallet row exists
    await query(`INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`, [userId]);

    // Create session — shields start at 0, purchased separately.
    // Paid buy-ins are always the 'prowl' (non-redeemable) currency. Free-entry
    // 'sweep' sessions are a Phase 2 addition once the sweepstakes model is live.
    const sessionResult = await query(
      `INSERT INTO game_sessions (
         user_id, buyin_amount, coin_tier, map_coins,
         shields_purchased, shields_remaining, currency
       ) VALUES ($1, $2, $3, $4, 0, 0, 'prowl')
       RETURNING *`,
      [userId, tierCents, tier.name, mapCoins],
    );

    const session = sessionResult.rows[0];

    // Record purchase transaction
    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'buyin', $2, 'prowl', $3)`,
      [userId, -tierCents, `Purchased ${mapCoins} Prowl Coins ($${tierDollars} ${tier.name} tier)`],
    );

    // Credit Prowl Coins (permanent rank)
    await query(
      `INSERT INTO prowl_balances (user_id, balance, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET balance = prowl_balances.balance + $2, updated_at = now()`,
      [userId, mapCoins],
    );

    res.status(201).json({ session: formatSession(session) });
  } catch (err) {
    console.error('createGameSession error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/game/geofence  — check if player's location is blocked
// ---------------------------------------------------------------------------

export async function checkGeoFence(req: AuthRequest, res: Response): Promise<void> {
  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);
  const state = req.query.state as string | undefined;

  if (state && isBlockedState(state)) {
    res.json({ blocked: true, state: getBlockedStates()[state.toUpperCase()], stateCode: state.toUpperCase(), blockedStates: getBlockedStates() });
    return;
  }

  if (!isNaN(lat) && !isNaN(lng)) {
    const check = checkLocationBlocked(lat, lng);
    res.json({ ...check, blockedStates: getBlockedStates() });
    return;
  }

  res.json({ blocked: false, blockedStates: getBlockedStates() });
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
      console.log(`[getActiveSession] NULL for user ${userId} (${req.user!.email})`);
      res.json({ session: null });
      return;
    }

    const shieldsRes = await query(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE user_id = $1 AND type = 'shield' AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId],
    );
    const shieldsBought24h = parseInt(shieldsRes.rows[0].count, 10);

    res.json({ session: formatSession(result.rows[0], shieldsBought24h) });
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
         gs.shields_remaining,
         u.username,
         u.email
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true
         AND gs.user_id != $1
         AND gs.latitude IS NOT NULL
         AND gs.latitude BETWEEN $2 AND $3
         AND gs.longitude BETWEEN $4 AND $5
         AND gs.user_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $1)
         AND gs.user_id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = $1)
`,
      [userId, myLat - delta, myLat + delta, myLng - delta, myLng + delta],
    );

    const players = result.rows
      .map((row) => {
        const dist = distanceMiles(myLat, myLng, row.latitude, row.longitude);
        const shieldActive = row.shield_active_until ? new Date(row.shield_active_until) > new Date() : false;
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
// GET /api/game/players  — get ALL active players on the map
// ---------------------------------------------------------------------------

export async function getAllPlayers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    // Get caller's location to sort by proximity
    const mySession = await query(
      `SELECT latitude, longitude FROM game_sessions WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId],
    );
    const myLat = mySession.rows[0]?.latitude ?? 0;
    const myLng = mySession.rows[0]?.longitude ?? 0;

    const [result, countResult] = await Promise.all([
      query(
        `SELECT
           gs.id AS session_id,
           gs.user_id,
           gs.latitude,
           gs.longitude,
           gs.map_coins,
           gs.shield_active_until,
           gs.shields_remaining,
           gs.coin_tier,
           u.username,
           u.email,
           COALESCE(pb.balance, 0) AS prowl_balance
         FROM game_sessions gs
         JOIN users u ON u.id = gs.user_id
         LEFT JOIN prowl_balances pb ON pb.user_id = gs.user_id
         WHERE gs.is_active = true
           AND gs.user_id != $1
           AND gs.latitude IS NOT NULL
           AND gs.user_id NOT IN (SELECT blocked_id FROM blocked_users WHERE blocker_id = $1)
           AND gs.user_id NOT IN (SELECT blocker_id FROM blocked_users WHERE blocked_id = $1)
         ORDER BY (gs.latitude - $2)*(gs.latitude - $2) + (gs.longitude - $3)*(gs.longitude - $3) ASC
         LIMIT 1500`,
        [userId, myLat, myLng],
      ),
      query(
        `SELECT COUNT(*) AS total FROM game_sessions gs
         WHERE gs.is_active = true
           AND gs.latitude IS NOT NULL`,
      ),
    ]);

    const totalOnMap = parseInt(countResult.rows[0]?.total || '0', 10);

    const players = result.rows.map((row) => {
      const shieldActive = row.shield_active_until ? new Date(row.shield_active_until) > new Date() : false;
      return {
        sessionId: row.session_id,
        id: row.user_id,
        username: row.username,
        latitude: parseFloat(row.latitude),
        longitude: parseFloat(row.longitude),
        mapCoins: parseInt(row.map_coins, 10),
        coinTier: row.coin_tier,
        shieldActive,
        prowlBalance: parseInt(row.prowl_balance, 10),
      };
    });

    res.json({ players, totalOnMap });
  } catch (err) {
    console.error('getAllPlayers error:', err);
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

      // Sweepstakes model: winnings are minted in the SAME currency the session
      // is played in. Paid 'prowl' games mint non-redeemable Prowl Coins (pure
      // entertainment). Only free-entry 'sweep' sessions mint redeemable Sweep
      // Coins. Column defaults to 'prowl', so the paid game is never cashable.
      const winCurrency = attacker.currency === 'sweep' ? 'sweep' : 'prowl';

      // Check if either player has blocked the other
      const blockCheck = await q(
        `SELECT id FROM blocked_users WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1) LIMIT 1`,
        [attacker.user_id, defender.defender_user_id || defender.user_id],
      );
      if (blockCheck.rows.length > 0) {
        throw new Error('Cannot attack this player.');
      }

      // Verify within attack radius
      if (!attacker.latitude || !defender.latitude) {
        throw new Error('Location not available. Enable GPS and wait for location update.');
      }

      // Location freshness check — prevent ambush from stale GPS
      const LOCATION_STALE_MS = 60 * 1000;
      const lastUpdate = attacker.last_location_update
        ? new Date(attacker.last_location_update).getTime()
        : 0;
      if (Date.now() - lastUpdate > LOCATION_STALE_MS) {
        throw new Error('Your location is stale. Wait for GPS to refresh before attacking.');
      }

      const dist = distanceMiles(
        attacker.latitude, attacker.longitude,
        defender.latitude, defender.longitude,
      );

      if (dist > config.attackRadiusMiles) {
        throw new Error(`Target is too far away (${dist.toFixed(2)} miles). Max: ${config.attackRadiusMiles} miles.`);
      }

      // Spawn protection: 2-minute grace period after buy-in
      const SPAWN_PROTECTION_MS = 2 * 60 * 1000;
      const attackerSpawn = attacker.spawned_at ? new Date(attacker.spawned_at).getTime() : 0;
      const defenderSpawn = defender.spawned_at ? new Date(defender.spawned_at).getTime() : 0;
      const now = Date.now();

      if (now - attackerSpawn < SPAWN_PROTECTION_MS) {
        const secsLeft = Math.ceil((SPAWN_PROTECTION_MS - (now - attackerSpawn)) / 1000);
        throw new Error(`Spawn protection active! You can't attack for ${secsLeft} more seconds.`);
      }
      if (now - defenderSpawn < SPAWN_PROTECTION_MS) {
        const secsLeft = Math.ceil((SPAWN_PROTECTION_MS - (now - defenderSpawn)) / 1000);
        throw new Error(`That player just spawned and is protected for ${secsLeft} more seconds.`);
      }

      // Check if defender is a bot
      const defenderEmail = (await q(`SELECT email FROM users WHERE id = $1`, [defender.user_id])).rows[0]?.email;
      const isBot = defenderEmail?.endsWith('@bot.local');

      if (isBot) {
        // Check bot's time-based shield (30 min from spawn/renewal)
        const botShieldActive = defender.shield_active_until
          ? new Date(defender.shield_active_until) > new Date()
          : false;

        if (botShieldActive) {
          const shieldMinsLeft = Math.ceil((new Date(defender.shield_active_until).getTime() - Date.now()) / 60000);

          await q(
            `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
             VALUES ($1, $2, $3, $4, 0, true, false, $5, $6)`,
            [attacker.user_id, defender.user_id, attacker.map_coins, defender.map_coins, attacker.latitude, attacker.longitude],
          );

          return {
            success: false,
            coinsStolen: 0,
            defenderHadShield: true,
            shieldConsumed: false,
            message: `Attack blocked! Shield active for ${shieldMinsLeft} more minutes. Try another target!`,
          };
        }

        // Bot shields are down - player defeats it and takes all coins
        const botCoins = parseInt(defender.map_coins || '0', 10);

        // Respawn bot with $1-$15 value and 30-min shield at a new random location nearby
        const newLat = parseFloat(defender.latitude) + (Math.random() - 0.5) * 0.5;
        const newLng = parseFloat(defender.longitude) + (Math.random() - 0.5) * 0.5;
        const respawnDollars = Math.floor(Math.random() * 15) + 1;
        const respawnCoins = respawnDollars * 10;
        const botShieldExpiry = new Date(Date.now() + 30 * 60 * 1000);
        await q(
          `UPDATE game_sessions SET map_coins = $1, buyin_amount = $2, shields_remaining = 3, coin_tier = 'prowler', latitude = $3, longitude = $4, shield_active_until = $5 WHERE id = $6`,
          [respawnCoins, respawnDollars * 100, newLat, newLng, botShieldExpiry, defender.id],
        );

        await q(
          `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
           VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)`,
          [attacker.user_id, defender.user_id, attacker.map_coins, defender.map_coins, botCoins, attacker.latitude, attacker.longitude],
        );

        // Add coins to player's session
        await q(
          `UPDATE game_sessions SET map_coins = map_coins + $1 WHERE id = $2`,
          [botCoins, attacker.id],
        );

        // Record transaction so it shows in wallet history
        const stolenCents = botCoins * 10;
        await Promise.all([
          q(
            `INSERT INTO transactions (user_id, type, amount, currency, description, related_user_id)
             VALUES ($1, 'attack_win', $2, $5, $3, $4)`,
            [attacker.user_id, stolenCents, `Took ${botCoins} coins from ${defender.defender_name}!`, defender.user_id, winCurrency],
          ),
          q(
            `INSERT INTO prowl_balances (user_id, balance, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (user_id) DO UPDATE SET balance = prowl_balances.balance + $2, updated_at = now()`,
            [attacker.user_id, botCoins],
          ),
        ]);

        return {
          success: true,
          coinsStolen: botCoins,
          defenderHadShield: false,
          shieldConsumed: false,
          message: `You took ${botCoins} coins from ${defender.defender_name}!`,
        };
      }

      // Player-vs-player attack — big bank takes little bank
      const attackerBuyin = parseInt(attacker.buyin_amount, 10);
      const defenderBuyin = parseInt(defender.buyin_amount, 10);

      if (attackerBuyin < defenderBuyin) {
        throw new Error(`Cannot attack a higher-tier player. Your buy-in: $${attackerBuyin / 100}, theirs: $${defenderBuyin / 100}. You can only attack players at your tier or lower.`);
      }

      const defenderTimeShieldActive = defender.shield_active_until
        ? new Date(defender.shield_active_until) > new Date()
        : false;

      if (defenderTimeShieldActive) {
        await q(
          `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
           VALUES ($1, $2, $3, $4, 0, true, false, $5, $6)`,
          [attacker.user_id, defender.user_id, attacker.map_coins, defender.map_coins, attacker.latitude, attacker.longitude],
        );
        return { success: false, coinsStolen: 0, defenderHadShield: true, shieldsLeft: 0, message: 'Attack blocked by shield!' };
      }

      // Only take what the defender bought in with — excess coins are safe
      const defenderCoins = parseInt(defender.map_coins, 10);
      const defenderBuyinCoins = Math.floor(parseInt(defender.buyin_amount, 10) / 10);
      const coinsStolen = Math.min(defenderCoins, defenderBuyinCoins);
      const excessCoins = defenderCoins - coinsStolen;

      await q(
        `UPDATE game_sessions SET map_coins = 0, is_active = false WHERE id = $1`,
        [defender.id],
      );

      await q(
        `UPDATE game_sessions SET map_coins = map_coins + $1 WHERE id = $2`,
        [coinsStolen, attacker.id],
      );

      await q(
        `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)`,
        [attacker.user_id, defender.user_id, attacker.map_coins, defender.map_coins, coinsStolen, attacker.latitude, attacker.longitude],
      );

      const stolenCents = coinsStolen * 10;
      const txPromises = [
        q(
          `INSERT INTO transactions (user_id, type, amount, currency, description, related_user_id)
           VALUES ($1, 'attack_win', $2, $5, $3, $4)`,
          [attacker.user_id, stolenCents, `Took ${coinsStolen} coins from ${defender.defender_name}!`, defender.user_id, winCurrency],
        ),
        q(
          `INSERT INTO transactions (user_id, type, amount, currency, description, related_user_id)
           VALUES ($1, 'attack_loss', $2, 'prowl', $3, $4)`,
          [defender.user_id, -stolenCents, `Defeated by ${attacker.attacker_name}`, attacker.user_id],
        ),
        q(
          `INSERT INTO prowl_balances (user_id, balance, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (user_id) DO UPDATE SET balance = prowl_balances.balance + $2, updated_at = now()`,
          [attacker.user_id, coinsStolen],
        ),
      ];

      await Promise.all(txPromises);

      const eliminationMsg = `${attacker.attacker_name} took ${coinsStolen} coins! You've been eliminated.`;

      const io = getIO();
      if (io) {
        io.to(`user:${defender.user_id}`).emit('session:eliminated', {
          attackerName: attacker.attacker_name,
          coinsLost: coinsStolen,
          coinsSaved: excessCoins,
          message: eliminationMsg,
        });
      }

      sendPushNotification(
        defender.user_id,
        'You were attacked!',
        eliminationMsg,
      ).catch(() => {});

      return {
        success: true,
        coinsStolen,
        defenderHadShield: false,
        message: `Attack successful! Took ${coinsStolen} coins from ${defender.defender_name}! They've been eliminated.`,
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error('attackPlayer error:', err);
    const status = err.message?.includes('No active session') ||
                   err.message?.includes('Cannot attack') ||
                   err.message?.includes('too far') ||
                   err.message?.includes('location is stale') ||
                   err.message?.includes('Spawn protection') ||
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
    const shieldType = req.body?.type === 'gold' ? 'gold' : 'standard';

    const sessionResult = await query(
      `SELECT * FROM game_sessions WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    if (sessionResult.rows.length === 0) {
      res.status(400).json({ error: 'No active session. Start a session first.' });
      return;
    }

    const session = sessionResult.rows[0];

    if (session.shield_active_until && new Date(session.shield_active_until) > new Date()) {
      res.status(400).json({ error: 'Shield is already active.' });
      return;
    }

    // Check 24-hour rolling limit: max 3 shields per 24 hours across all sessions
    const recentShields = await query(
      `SELECT COUNT(*) AS count FROM transactions
       WHERE user_id = $1 AND type = 'shield' AND created_at > NOW() - INTERVAL '24 hours'`,
      [userId],
    );
    const shieldsBoughtLast24h = parseInt(recentShields.rows[0].count, 10);
    if (shieldsBoughtLast24h >= 3) {
      res.status(400).json({ error: 'Maximum 3 shields per 24 hours. Try again later.' });
      return;
    }

    const isGold = shieldType === 'gold';
    const costCents = isGold ? 500 : 100;
    const durationMinutes = isGold ? 120 : config.shieldDurationMinutes;
    const label = isGold ? 'Gold Shield ($5.00) — 2 hours' : `Shield ($1.00) — ${config.shieldDurationMinutes} minutes`;

    const shieldExpiry = new Date(Date.now() + durationMinutes * 60 * 1000);

    const updated = await query(
      `UPDATE game_sessions
       SET shields_purchased = shields_purchased + 1,
           shield_active_until = $1
       WHERE id = $2
       RETURNING *`,
      [shieldExpiry, session.id],
    );

    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'shield', $2, 'prowl', $3)`,
      [userId, -costCents, label],
    );

    res.json({ session: formatSession(updated.rows[0], shieldsBoughtLast24h + 1) });
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

    const [sweepResult, prowlResult] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(amount), 0) AS balance FROM transactions WHERE user_id = $1 AND currency = 'sweep'`,
        [userId],
      ),
      query(
        `SELECT COALESCE(balance, 0) AS balance FROM prowl_balances WHERE user_id = $1`,
        [userId],
      ),
    ]);

    const sweepBalance = parseInt(sweepResult.rows[0].balance, 10);
    const prowlBalance = prowlResult.rows.length > 0 ? parseInt(prowlResult.rows[0].balance, 10) : 0;

    res.json({
      userId,
      balance: sweepBalance,
      sweepBalance,
      prowlBalance,
      canClaimDaily: false,
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
// GET /api/game/stats  — combat stats for profile
// ---------------------------------------------------------------------------

export async function getCombatStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const [sessionsRes, winsRes, lossesRes, shieldsRes, playersHitRes, coinsEarnedRes] = await Promise.all([
      query(`SELECT COUNT(*) AS count FROM game_sessions WHERE user_id = $1`, [userId]),
      query(`SELECT COUNT(*) AS count FROM attacks WHERE attacker_id = $1 AND success = true`, [userId]),
      query(`SELECT COUNT(*) AS count FROM attacks WHERE defender_id = $1 AND success = true`, [userId]),
      query(`SELECT COUNT(*) AS count FROM transactions WHERE user_id = $1 AND type = 'shield'`, [userId]),
      query(`SELECT COUNT(DISTINCT defender_id) AS count FROM attacks WHERE attacker_id = $1 AND success = true`, [userId]),
      query(`SELECT COALESCE(SUM(coins_stolen), 0) AS total FROM attacks WHERE attacker_id = $1 AND success = true`, [userId]),
    ]);

    res.json({
      sessions: parseInt(sessionsRes.rows[0].count, 10),
      coinsEarned: parseInt(coinsEarnedRes.rows[0].total, 10),
      attacksWon: parseInt(winsRes.rows[0].count, 10),
      attacksLost: parseInt(lossesRes.rows[0].count, 10),
      shieldsUsed: parseInt(shieldsRes.rows[0].count, 10),
      playersHit: parseInt(playersHitRes.rows[0].count, 10),
    });
  } catch (err) {
    console.error('getCombatStats error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// Coin drops helpers
// ---------------------------------------------------------------------------

function randomOffset(maxDegrees: number): number {
  return (Math.random() * 2 - 1) * maxDegrees;
}

/** Generate 3-5 coin drops near a given lat/lng and insert them into the DB. */
export async function generateCoinDrops(
  lat: number,
  lng: number,
  createdBy: string,
  count = Math.floor(Math.random() * 3) + 3, // 3–5
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const dropLat = lat + randomOffset(0.005);
    const dropLng = lng + randomOffset(0.005);
    const amount = (Math.floor(Math.random() * 5) + 1) * 10; // 10–50 coins ($1–$5)
    await query(
      `INSERT INTO coin_drops (amount, latitude, longitude, created_by, is_active)
       VALUES ($1, $2, $3, $4, true)`,
      [amount, dropLat, dropLng, createdBy],
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/game/coins  — get active coin drops near player
// ---------------------------------------------------------------------------

export async function getActiveCoinDrops(req: AuthRequest, res: Response): Promise<void> {
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
      res.json({ coins: [] });
      return;
    }

    const { latitude: myLat, longitude: myLng } = mySession.rows[0];
    const delta = 0.01; // ~1 km bounding box

    const result = await query(
      `SELECT id, amount, latitude, longitude, created_at
       FROM coin_drops
       WHERE is_active = true
         AND latitude BETWEEN $1 AND $2
         AND longitude BETWEEN $3 AND $4`,
      [myLat - delta, myLat + delta, myLng - delta, myLng + delta],
    );

    const coins = result.rows.map((row) => ({
      id: row.id,
      amount: parseInt(row.amount, 10),
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      createdAt: row.created_at,
    }));

    res.json({ coins });
  } catch (err) {
    console.error('getActiveCoinDrops error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/game/coins/:id/collect  — collect a coin drop
// ---------------------------------------------------------------------------

// Distance in meters (Haversine)
function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const COLLECT_RADIUS_METERS = 500;

export async function collectCoinDrop(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id: dropId } = req.params;
    const userId = req.user!.id;

    // Fetch player location from active session
    const sessionResult = await query(
      `SELECT id, latitude, longitude FROM game_sessions
       WHERE user_id = $1 AND is_active = true LIMIT 1`,
      [userId],
    );

    if (sessionResult.rows.length === 0) {
      res.status(400).json({ error: 'No active session. Start a session to collect coins.' });
      return;
    }

    const session = sessionResult.rows[0];
    if (!session.latitude || !session.longitude) {
      res.status(400).json({ error: 'Location not available yet.' });
      return;
    }

    // Fetch coin drop
    const dropResult = await query(
      `SELECT id, amount, latitude, longitude, is_active, picked_up_by
       FROM coin_drops WHERE id = $1`,
      [dropId],
    );

    if (dropResult.rows.length === 0) {
      res.status(404).json({ error: 'Coin drop not found.' });
      return;
    }

    const drop = dropResult.rows[0];

    if (!drop.is_active || drop.picked_up_by) {
      res.status(409).json({ error: 'Coin already collected.' });
      return;
    }

    // Validate proximity
    const dist = distanceMeters(
      parseFloat(session.latitude), parseFloat(session.longitude),
      parseFloat(drop.latitude), parseFloat(drop.longitude),
    );

    if (dist > COLLECT_RADIUS_METERS) {
      res.status(400).json({
        error: `Too far away (${Math.round(dist)}m). Must be within ${COLLECT_RADIUS_METERS}m.`,
      });
      return;
    }

    // Mark collected — coins go straight to wallet via transaction
    await Promise.all([
      query(
        `UPDATE coin_drops SET is_active = false, picked_up_by = $1, picked_up_at = now() WHERE id = $2`,
        [userId, dropId],
      ),
      query(
        `INSERT INTO transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'coin_collect', $2, 'sweep', $3)`,
        [userId, drop.amount * 10, `Collected ${drop.amount} coin${drop.amount !== 1 ? 's' : ''} from map`],
      ),
    ]);

    // Return updated session coins
    const updatedSession = await query(
      `SELECT map_coins FROM game_sessions WHERE id = $1`,
      [session.id],
    );

    res.json({
      collected: true,
      amount: drop.amount,
      mapCoins: parseInt(updatedSession.rows[0].map_coins, 10),
    });
  } catch (err) {
    console.error('collectCoinDrop error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/game/leaderboard  — top players by Prowl Coins
// ---------------------------------------------------------------------------

export async function getLeaderboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT pb.user_id, pb.balance AS prowl_coins, u.username
       FROM prowl_balances pb
       JOIN users u ON u.id = pb.user_id
       WHERE pb.balance > 0
       ORDER BY pb.balance DESC
       LIMIT 100`,
    );

    const myRank = await query(
      `SELECT COUNT(*) + 1 AS rank FROM prowl_balances WHERE balance > (
         SELECT COALESCE(balance, 0) FROM prowl_balances WHERE user_id = $1
       )`,
      [userId],
    );

    const myProwl = await query(
      `SELECT COALESCE(balance, 0) AS balance FROM prowl_balances WHERE user_id = $1`,
      [userId],
    );

    const players = result.rows.map((row, idx) => ({
      rank: idx + 1,
      userId: row.user_id,
      username: row.username,
      prowlCoins: parseInt(row.prowl_coins, 10),
      isYou: row.user_id === userId,
    }));

    res.json({
      leaderboard: players,
      myRank: parseInt(myRank.rows[0]?.rank || '0', 10),
      myProwlCoins: parseInt(myProwl.rows[0]?.balance || '0', 10),
    });
  } catch (err) {
    console.error('getLeaderboard error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSession(row: Record<string, any>, shieldsBought24h?: number) {
  return {
    id: row.id,
    userId: row.user_id,
    buyinAmount: parseInt(row.buyin_amount, 10),
    coinTier: row.coin_tier,
    mapCoins: parseInt(row.map_coins, 10),
    shieldsPurchased: parseInt(row.shields_purchased, 10),
    shieldsBought24h: shieldsBought24h ?? parseInt(row.shields_purchased, 10),
    shieldsRemaining: parseInt(row.shields_remaining, 10),
    shieldActiveUntil: row.shield_active_until,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    lastLocationUpdate: row.last_location_update,
    isActive: row.is_active,
    createdAt: row.created_at,
    spawnedAt: row.spawned_at || row.created_at,
  };
}

// ---------------------------------------------------------------------------
// POST /api/wallet/redeem  — redeem sweep coins via PayPal
// ---------------------------------------------------------------------------

export async function redeemSweepCoins(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const parsed = redeemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { recipient, amountCents, method } = parsed.data;
    const methodLabel = method === 'venmo' ? 'Venmo' : 'PayPal';

    // Check for pending withdrawals
    const pendingCheck = await query(
      `SELECT id FROM withdrawals WHERE user_id = $1 AND status = 'pending' LIMIT 1`,
      [userId],
    );
    if (pendingCheck.rows.length > 0) {
      res.status(400).json({ error: 'You already have a pending redemption. Please wait for it to complete.' });
      return;
    }

    // Get sweep balance
    const sweepResult = await query(
      `SELECT COALESCE(SUM(amount), 0) AS balance FROM transactions WHERE user_id = $1 AND currency = 'sweep'`,
      [userId],
    );
    const sweepBalance = parseInt(sweepResult.rows[0].balance, 10);

    if (sweepBalance < amountCents) {
      res.status(400).json({ error: `Insufficient sweep coins. You have $${(sweepBalance / 100).toFixed(2)} available.` });
      return;
    }

    const amountDollars = (amountCents / 100).toFixed(2);
    const senderItemId = `coinprowl-${userId.slice(0, 8)}-${Date.now()}`;

    // Create withdrawal record as PENDING (requires admin approval)
    const withdrawalResult = await query(
      `INSERT INTO withdrawals (user_id, amount, method, payout_details, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id`,
      [userId, amountCents, method, JSON.stringify({ recipient, senderItemId })],
    );
    const withdrawalId = withdrawalResult.rows[0].id;

    // Deduct sweep coins immediately (held until approved/denied)
    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'withdrawal', $2, 'sweep', $3)`,
      [userId, -amountCents, `Redemption pending: $${amountDollars} via ${methodLabel}`],
    );

    res.json({
      success: true,
      message: `Your redemption of $${amountDollars} via ${methodLabel} has been submitted and is pending approval. You'll receive the funds once approved.`,
      withdrawalId,
    });
  } catch (err) {
    console.error('redeemSweepCoins error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/wallet/redemptions  — get redemption history
// ---------------------------------------------------------------------------

export async function getRedemptions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT id, amount, method, status, payout_details, created_at, updated_at
       FROM withdrawals
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId],
    );

    const redemptions = result.rows.map((row) => ({
      id: row.id,
      amount: parseInt(row.amount, 10),
      method: row.method,
      status: row.status,
      paypalEmail: row.payout_details?.email ?? null,
      createdAt: row.created_at,
    }));

    res.json({ redemptions });
  } catch (err) {
    console.error('getRedemptions error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/game/block  — block a user
// ---------------------------------------------------------------------------

export async function blockUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { targetUserId } = req.body;

    if (!targetUserId) {
      res.status(400).json({ error: 'targetUserId is required.' });
      return;
    }

    if (targetUserId === userId) {
      res.status(400).json({ error: 'Cannot block yourself.' });
      return;
    }

    await query(
      `INSERT INTO blocked_users (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, targetUserId],
    );

    res.json({ blocked: true });
  } catch (err) {
    console.error('blockUser error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/game/block/:userId  — unblock a user
// ---------------------------------------------------------------------------

export async function unblockUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const targetUserId = req.params.userId;

    await query(
      `DELETE FROM blocked_users WHERE blocker_id = $1 AND blocked_id = $2`,
      [userId, targetUserId],
    );

    res.json({ unblocked: true });
  } catch (err) {
    console.error('unblockUser error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// GET /api/game/blocked  — get list of blocked users
// ---------------------------------------------------------------------------

export async function getBlockedUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT bu.blocked_id, u.username, bu.created_at
       FROM blocked_users bu
       JOIN users u ON u.id = bu.blocked_id
       WHERE bu.blocker_id = $1
       ORDER BY bu.created_at DESC`,
      [userId],
    );

    res.json({ blockedUsers: result.rows.map(r => ({ userId: r.blocked_id, username: r.username, blockedAt: r.created_at })) });
  } catch (err) {
    console.error('getBlockedUsers error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}
