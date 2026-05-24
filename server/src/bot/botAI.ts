import { Server as SocketIOServer } from 'socket.io';
import { query, transaction } from '../config/database';
import { config } from '../config/env';

const MPH_TO_DEG_PER_SEC = 1 / (69 * 3600);
const BOT_SPEED_MPH = 5;
const TICK_INTERVAL_MS = 3000;
const BOT_ATTACK_RADIUS = 0.5;
const MAX_BOT_HITS_PER_PLAYER_PER_WEEK = 2;
const MIN_BOT_SPACING_MILES = 10;
const MIN_BOT_SPACING_DEGS = MIN_BOT_SPACING_MILES / 69;
const LEASH_RADIUS_DEGS = 1.5; // ~100 miles - bots stay within this radius of home
const MAX_CHASE_RADIUS_MILES = 30;

// Continental US bounds
const US_LAT_MIN = 25;
const US_LAT_MAX = 48;
const US_LNG_MIN = -125;
const US_LNG_MAX = -67;

let tickHandle: ReturnType<typeof setInterval> | null = null;

const botWanderAngles = new Map<string, number>();
const botHomePositions = new Map<string, { lat: number; lng: number }>();

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getWanderAngle(botId: string): number {
  if (!botWanderAngles.has(botId)) {
    botWanderAngles.set(botId, Math.random() * 2 * Math.PI);
  }
  let angle = botWanderAngles.get(botId)!;
  angle += (Math.random() - 0.5) * 0.2;
  botWanderAngles.set(botId, angle);
  return angle;
}

function clampToUS(lat: number, lng: number): { lat: number; lng: number } {
  return {
    lat: Math.max(US_LAT_MIN, Math.min(US_LAT_MAX, lat)),
    lng: Math.max(US_LNG_MIN, Math.min(US_LNG_MAX, lng)),
  };
}

async function botTick(io: SocketIOServer) {
  try {
    const realPlayersRes = await query(
      `SELECT gs.id AS session_id, gs.user_id, gs.latitude, gs.longitude, gs.map_coins,
              gs.shield_active_until, gs.spawned_at, u.username
       FROM game_sessions gs
       JOIN users u ON u.id = gs.user_id
       WHERE gs.is_active = true
         AND gs.latitude IS NOT NULL
         AND u.email NOT LIKE '%@bot.local'
         AND gs.last_location_update > now() - interval '30 minutes'
         AND (gs.spawned_at IS NULL OR gs.spawned_at < now() - interval '2 minutes')`,
    );
    const realPlayers = realPlayersRes.rows;

    const weeklyHitsRes = await query(
      `SELECT a.attacker_id, a.defender_id, MAX(a.created_at) as last_hit
       FROM attacks a
       JOIN users u ON u.id = a.attacker_id
       WHERE u.email LIKE '%@bot.local'
         AND a.created_at > now() - interval '7 days'
       GROUP BY a.attacker_id, a.defender_id`,
    );

    const dbCooldowns = new Map<string, number>();
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
    const allBots = botsRes.rows;

    // Record home positions for new bots
    for (const bot of allBots) {
      if (!botHomePositions.has(bot.user_id)) {
        botHomePositions.set(bot.user_id, { lat: bot.latitude, lng: bot.longitude });
      }
    }

    const playerBeingChased = new Set<string>();
    const updatedPositions = new Map<string, { lat: number; lng: number }>();

    for (const bot of allBots) {
      const home = botHomePositions.get(bot.user_id)!;

      // Only chase players within a short radius (keeps bots near their area)
      let nearest = null;
      let nearestDist = Infinity;
      if (realPlayers.length > 0) {
        for (const p of realPlayers) {
          if (playerBeingChased.has(p.user_id)) continue;
          const cooldownKey = `${bot.user_id}:${p.user_id}`;
          if (dbCooldowns.has(cooldownKey)) continue;
          const distinctBots = playerDistinctBotHits.get(p.user_id);
          if (distinctBots && distinctBots.size >= MAX_BOT_HITS_PER_PLAYER_PER_WEEK) continue;
          const d = distanceMiles(bot.latitude, bot.longitude, p.latitude, p.longitude);
          if (d < nearestDist && d <= MAX_CHASE_RADIUS_MILES) {
            nearestDist = d;
            nearest = p;
          }
        }
      }

      let moveLat = 0;
      let moveLng = 0;

      if (nearest) {
        playerBeingChased.add(nearest.user_id);
        const dLat = nearest.latitude - bot.latitude;
        const dLng = nearest.longitude - bot.longitude;
        const rawDist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (rawDist > 0.0001) {
          moveLat = (dLat / rawDist) * moveDegs;
          moveLng = (dLng / rawDist) * moveDegs;
        }
      } else {
        // Wander with persistent heading
        const angle = getWanderAngle(bot.user_id);
        moveLat = Math.cos(angle) * moveDegs;
        moveLng = Math.sin(angle) * moveDegs;
      }

      // Leash: pull back toward home if too far
      const dHomeLat = bot.latitude - home.lat;
      const dHomeLng = bot.longitude - home.lng;
      const homeDist = Math.sqrt(dHomeLat * dHomeLat + dHomeLng * dHomeLng);
      if (homeDist > LEASH_RADIUS_DEGS * 0.7) {
        const pullStrength = Math.min(1, (homeDist - LEASH_RADIUS_DEGS * 0.7) / (LEASH_RADIUS_DEGS * 0.3));
        moveLat -= (dHomeLat / homeDist) * moveDegs * pullStrength * 3;
        moveLng -= (dHomeLng / homeDist) * moveDegs * pullStrength * 3;
        // Flip wander angle toward home
        if (pullStrength > 0.5) {
          botWanderAngles.set(bot.user_id, Math.atan2(-dHomeLng, -dHomeLat));
        }
      }

      // Bot-to-bot repulsion
      let repelLat = 0;
      let repelLng = 0;
      for (const other of allBots) {
        if (other.user_id === bot.user_id) continue;
        const oPos = updatedPositions.get(other.user_id) || { lat: other.latitude, lng: other.longitude };
        const dLat = bot.latitude - oPos.lat;
        const dLng = bot.longitude - oPos.lng;
        const degDist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (degDist < MIN_BOT_SPACING_DEGS && degDist > 0.0001) {
          const strength = (MIN_BOT_SPACING_DEGS - degDist) / MIN_BOT_SPACING_DEGS;
          repelLat += (dLat / degDist) * moveDegs * strength * 2;
          repelLng += (dLng / degDist) * moveDegs * strength * 2;
        }
      }

      const clamped = clampToUS(
        bot.latitude + moveLat + repelLat,
        bot.longitude + moveLng + repelLng,
      );

      // If hitting US boundary, flip wander angle
      if (clamped.lat !== bot.latitude + moveLat + repelLat ||
          clamped.lng !== bot.longitude + moveLng + repelLng) {
        botWanderAngles.set(bot.user_id, Math.random() * 2 * Math.PI);
      }

      updatedPositions.set(bot.user_id, clamped);

      await query(
        `UPDATE game_sessions SET latitude = $1, longitude = $2, last_location_update = now() WHERE id = $3`,
        [clamped.lat, clamped.lng, bot.session_id],
      );

      const botUpdate = {
        userId: bot.user_id,
        username: bot.username,
        lat: clamped.lat,
        lng: clamped.lng,
        ts: Date.now(),
      };
      io.to('game').emit('players:update', botUpdate);
      io.of('/spectator').emit('players:update', botUpdate);

      if (nearest) {
        const currentDist = distanceMiles(clamped.lat, clamped.lng, nearest.latitude, nearest.longitude);
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
  console.log(`[BotAI] Starting bot AI loop (${TICK_INTERVAL_MS}ms tick, ${BOT_SPEED_MPH}mph, leash ${Math.round(LEASH_RADIUS_DEGS * 69)}mi)`);
  tickHandle = setInterval(() => botTick(io), TICK_INTERVAL_MS);
}

export function stopBotAI(): void {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
    console.log('[BotAI] Stopped');
  }
}
