import { Server as SocketIOServer } from 'socket.io';
import { query, transaction } from '../config/database';
import { config } from '../config/env';

const MPH_TO_DEG_PER_SEC = 1 / (69 * 3600); // ~1 degree lat ≈ 69 miles
const BOT_SPEED_MPH = 30;
const TICK_INTERVAL_MS = 3000;
const ATTACK_RADIUS = config.attackRadiusMiles;
const BOT_ATTACK_RADIUS = 0.5;
const MAX_HUNT_RADIUS_MILES = 150;

let tickHandle: ReturnType<typeof setInterval> | null = null;
// Key: "botUserId:playerUserId", Value: timestamp of last bot->player attack
const botPlayerCooldowns = new Map<string, number>();
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

    // Debug: log once per minute
    if (Date.now() % 60000 < TICK_INTERVAL_MS) {
      console.log(`[BotAI] ${realPlayers.length} real players online`);
    }

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

    // Track which players already have a bot chasing them this tick
    const playerBeingChased = new Set<string>();

    // Sort bots by distance to nearest player so closer bots get first pick
    const botsWithDist = botsRes.rows.map((bot: any) => {
      let minDist = Infinity;
      for (const p of realPlayers) {
        const d = distanceMiles(bot.latitude, bot.longitude, p.latitude, p.longitude);
        if (d < minDist) minDist = d;
      }
      return { ...bot, _minDist: minDist };
    });
    botsWithDist.sort((a: any, b: any) => a._minDist - b._minDist);

    for (const bot of botsWithDist) {
      // Find nearest real player within hunt radius that isn't already being chased
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of realPlayers) {
        if (playerBeingChased.has(p.user_id)) continue;
        const d = distanceMiles(bot.latitude, bot.longitude, p.latitude, p.longitude);
        if (d < nearestDist && d <= MAX_HUNT_RADIUS_MILES) {
          nearestDist = d;
          nearest = p;
        }
      }

      if (!nearest) continue;
      playerBeingChased.add(nearest.user_id);

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

      // If within attack range and this bot hasn't hit this player in the last week
      const currentDist = distanceMiles(newLat, newLng, nearest.latitude, nearest.longitude);
      const cooldownKey = `${bot.user_id}:${nearest.user_id}`;
      const lastHit = botPlayerCooldowns.get(cooldownKey) || 0;
      if (currentDist <= BOT_ATTACK_RADIUS && Date.now() - lastHit > ONE_WEEK_MS) {
        botPlayerCooldowns.set(cooldownKey, Date.now());
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
      const tRes = await q(
        `SELECT gs.*, u.username FROM game_sessions gs JOIN users u ON u.id = gs.user_id
         WHERE gs.id = $1 AND gs.is_active = true LIMIT 1`,
        [target.session_id],
      );
      if (tRes.rows.length === 0) return;
      const defender = tRes.rows[0];

      // Check bot's remaining hit points
      const botHitsLeft = parseInt(bot.shields_remaining || '0', 10);
      if (botHitsLeft <= 0) return;

      // Bot takes 1 shield from the player (if they have any)
      const playerShieldsRemaining = parseInt(defender.shields_remaining || '0', 10);
      if (playerShieldsRemaining > 0) {
        await q(
          `UPDATE game_sessions SET shields_remaining = shields_remaining - 1 WHERE id = $1`,
          [target.session_id],
        );
      }

      // Bot loses 1 hit point
      const newBotHits = botHitsLeft - 1;
      if (newBotHits <= 0) {
        await q(
          `UPDATE game_sessions SET shields_remaining = 0, is_active = false WHERE id = $1`,
          [bot.session_id],
        );
      } else {
        await q(
          `UPDATE game_sessions SET shields_remaining = $1 WHERE id = $2`,
          [newBotHits, bot.session_id],
        );
      }

      await q(
        `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
         VALUES ($1, $2, $3, $4, 0, false, true, $5, $6)`,
        [bot.user_id, defender.user_id, bot.map_coins, defender.map_coins, bot.latitude, bot.longitude],
      );

      // Notify the player via socket
      io.to('game').emit('bot:attacked', {
        botUserId: bot.user_id,
        botName: bot.username,
        targetUserId: defender.user_id,
        shieldTaken: playerShieldsRemaining > 0,
        botHitsLeft: newBotHits,
      });

      console.log(`[BotAI] ${bot.username} hit ${defender.username} (shield taken: ${playerShieldsRemaining > 0}, bot hits left: ${newBotHits})`);
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
