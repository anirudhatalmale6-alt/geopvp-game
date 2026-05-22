import { Server as SocketIOServer } from 'socket.io';
import { query, transaction } from '../config/database';
import { config } from '../config/env';

const MPH_TO_DEG_PER_SEC = 1 / (69 * 3600); // ~1 degree lat ≈ 69 miles
const BOT_SPEED_MPH = 10;
const TICK_INTERVAL_MS = 5000;
const ATTACK_RADIUS = config.attackRadiusMiles;

let tickHandle: ReturnType<typeof setInterval> | null = null;

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function botTick(io: SocketIOServer) {
  try {
    // Get all active real players (non-bots) with location
    const realPlayersRes = await query(
      `SELECT gs.id AS session_id, gs.user_id, gs.latitude, gs.longitude, gs.map_coins,
              gs.shield_active_until, u.username
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true
         AND gs.latitude IS NOT NULL
         AND u.email NOT LIKE '%@bot.local'
         AND gs.last_location_update > now() - interval '30 minutes'`,
    );
    const realPlayers = realPlayersRes.rows;
    if (realPlayers.length === 0) return;

    // Get all active bots
    const botsRes = await query(
      `SELECT gs.id AS session_id, gs.user_id, gs.latitude, gs.longitude, gs.map_coins,
              gs.shield_active_until, gs.shields_remaining, u.username
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true
         AND gs.latitude IS NOT NULL
         AND u.email LIKE '%@bot.local'`,
    );

    const dtSeconds = TICK_INTERVAL_MS / 1000;
    const moveDegs = BOT_SPEED_MPH * MPH_TO_DEG_PER_SEC * dtSeconds;

    for (const bot of botsRes.rows) {
      const botShielded = bot.shield_active_until
        ? new Date(bot.shield_active_until) > new Date()
        : false;

      // Find nearest real player
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of realPlayers) {
        const d = distanceMiles(bot.latitude, bot.longitude, p.latitude, p.longitude);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = p;
        }
      }

      if (!nearest) continue;

      // Move toward nearest player
      const dLat = nearest.latitude - bot.latitude;
      const dLng = nearest.longitude - bot.longitude;
      const rawDist = Math.sqrt(dLat * dLat + dLng * dLng);

      let newLat = bot.latitude;
      let newLng = bot.longitude;

      if (rawDist > 0.0001) {
        const step = Math.min(moveDegs, rawDist);
        newLat = bot.latitude + (dLat / rawDist) * step;
        newLng = bot.longitude + (dLng / rawDist) * step;
      }

      // Update bot position
      await query(
        `UPDATE game_sessions SET latitude = $1, longitude = $2, last_location_update = now() WHERE id = $3`,
        [newLat, newLng, bot.session_id],
      );

      // Broadcast bot movement via socket
      io.to('game').emit('players:update', {
        userId: bot.user_id,
        username: bot.username,
        lat: newLat,
        lng: newLng,
        ts: Date.now(),
      });

      // If within attack range and bot is NOT shielded, attack the nearest player
      const currentDist = distanceMiles(newLat, newLng, nearest.latitude, nearest.longitude);
      if (currentDist <= ATTACK_RADIUS && !botShielded) {
        await botAttack(bot, nearest, io);
      }
    }
  } catch (err) {
    console.error('[BotAI] tick error:', err);
  }
}

async function botAttack(
  bot: Record<string, any>,
  target: Record<string, any>,
  io: SocketIOServer,
) {
  try {
    await transaction(async (q) => {
      // Check target still has active session
      const tRes = await q(
        `SELECT gs.*, u.username FROM game_sessions gs JOIN users u ON u.id = gs.user_id
         WHERE gs.id = $1 AND gs.is_active = true LIMIT 1`,
        [target.session_id],
      );
      if (tRes.rows.length === 0) return;
      const defender = tRes.rows[0];

      // Check if defender has active shield
      const defenderShielded = defender.shield_active_until
        ? new Date(defender.shield_active_until) > new Date()
        : false;

      if (defenderShielded) {
        await q(
          `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
           VALUES ($1, $2, $3, $4, 0, true, false, $5, $6)`,
          [bot.user_id, defender.user_id, bot.map_coins, defender.map_coins, bot.latitude, bot.longitude],
        );
        return;
      }

      // Steal 20% of defender's coins (min 1, max 50)
      const coinsStolen = Math.max(1, Math.min(50, Math.floor(defender.map_coins * 0.2)));
      if (coinsStolen <= 0) return;

      await Promise.all([
        q(`UPDATE game_sessions SET map_coins = map_coins + $1 WHERE id = $2`, [coinsStolen, bot.session_id]),
        q(`UPDATE game_sessions SET map_coins = GREATEST(0, map_coins - $1) WHERE id = $2`, [coinsStolen, target.session_id]),
      ]);

      await q(
        `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
         VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)`,
        [bot.user_id, defender.user_id, bot.map_coins, defender.map_coins, coinsStolen, bot.latitude, bot.longitude],
      );

      await Promise.all([
        q(`INSERT INTO transactions (user_id, type, amount, description, related_user_id) VALUES ($1, 'attack_win', $2, $3, $4)`,
          [bot.user_id, coinsStolen, `Bot stole ${coinsStolen} coins from ${defender.username}`, defender.user_id]),
        q(`INSERT INTO transactions (user_id, type, amount, description, related_user_id) VALUES ($1, 'attack_loss', $2, $3, $4)`,
          [defender.user_id, -coinsStolen, `Lost ${coinsStolen} coins to bot ${bot.username}`, bot.user_id]),
      ]);

      console.log(`[BotAI] ${bot.username} attacked ${defender.username}, stole ${coinsStolen} coins`);
    });
  } catch (err) {
    console.error('[BotAI] attack error:', err);
  }
}

export function startBotAI(io: SocketIOServer): void {
  if (tickHandle) return;
  console.log(`[BotAI] Starting bot AI loop (${TICK_INTERVAL_MS}ms tick, ${BOT_SPEED_MPH}mph)`);
  tickHandle = setInterval(() => botTick(io), TICK_INTERVAL_MS);
}

export function stopBotAI(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
    console.log('[BotAI] Stopped');
  }
}
