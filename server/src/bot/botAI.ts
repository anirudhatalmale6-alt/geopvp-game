import { Server as SocketIOServer } from 'socket.io';
import { query, transaction } from '../config/database';
import { config } from '../config/env';

const MPH_TO_DEG_PER_SEC = 1 / (69 * 3600);
const BOT_SPEED_MPH = 30;
const TICK_INTERVAL_MS = 3000;
const ATTACK_RADIUS = config.attackRadiusMiles;
const BOT_ATTACK_RADIUS = 0.5;
const MAX_HUNT_RADIUS_MILES = 150;
const MAX_BOT_HITS_PER_PLAYER_PER_WEEK = 2;

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

    if (Date.now() % 60000 < TICK_INTERVAL_MS) {
      console.log(`[BotAI] ${realPlayers.length} real players online`);
    }

    // Query database for bot attack history this week (survives server restarts)
    const weeklyHitsRes = await query(
      `SELECT a.attacker_id, a.defender_id, MAX(a.created_at) as last_hit
       FROM attacks a
       JOIN users u ON u.id = a.attacker_id
       WHERE u.email LIKE '%@bot.local'
         AND a.created_at > now() - interval '7 days'
       GROUP BY a.attacker_id, a.defender_id`,
    );

    // Build cooldown map from DB: "botUserId:playerUserId" -> last hit timestamp
    const dbCooldowns = new Map<string, number>();
    // Build per-player hit count: how many distinct bots hit each player this week
    const playerDistinctBotHits = new Map<string, Set<string>>();
    for (const row of weeklyHitsRes.rows) {
      const key = `${row.attacker_id}:${row.defender_id}`;
      dbCooldowns.set(key, new Date(row.last_hit).getTime());
      if (!playerDistinctBotHits.has(row.defender_id)) {
        playerDistinctBotHits.set(row.defender_id, new Set());
      }
      playerDistinctBotHits.get(row.defender_id)!.add(row.attacker_id);
    }

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

    const playerBeingChased = new Set<string>();

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
      let nearest = null;
      let nearestDist = Infinity;
      for (const p of realPlayers) {
        if (playerBeingChased.has(p.user_id)) continue;
        // Skip if this bot already hit this player this week (DB-backed)
        const cooldownKey = `${bot.user_id}:${p.user_id}`;
        if (dbCooldowns.has(cooldownKey)) continue;
        // Skip if this player already got hit by MAX distinct bots this week
        const distinctBots = playerDistinctBotHits.get(p.user_id);
        if (distinctBots && distinctBots.size >= MAX_BOT_HITS_PER_PLAYER_PER_WEEK) continue;
        const d = distanceMiles(bot.latitude, bot.longitude, p.latitude, p.longitude);
        if (d < nearestDist && d <= MAX_HUNT_RADIUS_MILES) {
          nearestDist = d;
          nearest = p;
        }
      }

      let newLat = bot.latitude;
      let newLng = bot.longitude;

      if (!nearest) {
        // No valid target - wander away from nearest player in a random direction
        const angle = Math.random() * 2 * Math.PI;
        newLat = bot.latitude + Math.cos(angle) * moveDegs;
        newLng = bot.longitude + Math.sin(angle) * moveDegs;
      } else {
        playerBeingChased.add(nearest.user_id);

        const dLat = nearest.latitude - bot.latitude;
        const dLng = nearest.longitude - bot.longitude;
        const rawDist = Math.sqrt(dLat * dLat + dLng * dLng);

        if (rawDist > 0.0001) {
          const step = Math.min(moveDegs, rawDist);
          newLat = bot.latitude + (dLat / rawDist) * step;
          newLng = bot.longitude + (dLng / rawDist) * step;
        }
      }

      await query(
        `UPDATE game_sessions SET latitude = $1, longitude = $2, last_location_update = now() WHERE id = $3`,
        [newLat, newLng, bot.session_id],
      );

      io.to('game').emit('players:update', {
        userId: bot.user_id,
        username: bot.username,
        lat: newLat,
        lng: newLng,
        ts: Date.now(),
      });

      if (nearest) {
        const currentDist = distanceMiles(newLat, newLng, nearest.latitude, nearest.longitude);
        const cooldownKey = `${bot.user_id}:${nearest.user_id}`;
        if (currentDist <= BOT_ATTACK_RADIUS && !dbCooldowns.has(cooldownKey)) {
          const distinctBots = playerDistinctBotHits.get(nearest.user_id);
          if (!distinctBots || distinctBots.size < MAX_BOT_HITS_PER_PLAYER_PER_WEEK) {
            dbCooldowns.set(cooldownKey, Date.now());
            if (!playerDistinctBotHits.has(nearest.user_id)) {
              playerDistinctBotHits.set(nearest.user_id, new Set());
            }
            playerDistinctBotHits.get(nearest.user_id)!.add(bot.user_id);
            await botAttack(bot, nearest, io);
          }
        }
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

      const botHitsLeft = parseInt(bot.shields_remaining || '0', 10);
      if (botHitsLeft <= 0) return;

      const playerShieldsPurchased = parseInt(defender.shields_purchased || '0', 10);
      const shieldTaken = playerShieldsPurchased < 3;
      if (shieldTaken) {
        await q(
          `UPDATE game_sessions SET shields_purchased = shields_purchased + 1, shield_active_until = NULL WHERE id = $1`,
          [target.session_id],
        );
      }

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

      io.to('game').emit('bot:attacked', {
        botUserId: bot.user_id,
        botName: bot.username,
        targetUserId: defender.user_id,
        shieldTaken,
        botHitsLeft: newBotHits,
      });

      console.log(`[BotAI] ${bot.username} hit ${defender.username} (shield taken: ${shieldTaken}, bot hits left: ${newBotHits})`);
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
