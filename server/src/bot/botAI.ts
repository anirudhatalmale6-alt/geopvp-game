import { Server as SocketIOServer } from 'socket.io';
import { query, transaction } from '../config/database';
import { config } from '../config/env';
import { sendPushNotification } from '../utils/pushNotification';

const MPH_TO_DEG_PER_SEC = 1 / (69 * 3600);
const BOT_SPEED_MPH = 10;
const BOT_CHASE_SPEED_MPH = 18;
const TICK_INTERVAL_MS = 5000;
const BOT_ATTACK_RADIUS = 0.5;
const MAX_BOT_HITS_PER_PLAYER_PER_WEEK = 5;
const MIN_BOT_SPACING_MILES = 10;
const MIN_BOT_SPACING_DEGS = MIN_BOT_SPACING_MILES / 69;
const LEASH_RADIUS_DEGS = 2.0; // ~140 miles - bots stay within this radius of home
const MAX_CHASE_RADIUS_MILES = 50;

// Continental US bounds (with padding so bots don't pile up on borders)
const US_LAT_MIN = 26;
const US_LAT_MAX = 47;
const US_LNG_MIN = -123;
const US_LNG_MAX = -69;

let tickHandle: ReturnType<typeof setInterval> | null = null;

const BOT_VISUAL_TIERS = ['copper','silver','gold','emerald','ruby','sapphire','amethyst','topaz','aquamarine','pearl'];
const botVisualTiers = new Map<string, string>();
function getBotVisualTier(botId: string): string {
  if (!botVisualTiers.has(botId)) {
    botVisualTiers.set(botId, BOT_VISUAL_TIERS[Math.floor(Math.random() * BOT_VISUAL_TIERS.length)]);
  }
  return botVisualTiers.get(botId)!;
}

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
  // Larger random turns for more organic movement
  angle += (Math.random() - 0.5) * 0.6;
  // Occasional big direction change
  if (Math.random() < 0.05) angle += (Math.random() - 0.5) * Math.PI;
  botWanderAngles.set(botId, angle);
  return angle;
}

function clampToUS(lat: number, lng: number): { lat: number; lng: number } {
  // Add small random offset when hitting boundary to prevent alignment
  let newLat = lat;
  let newLng = lng;
  if (newLat <= US_LAT_MIN) newLat = US_LAT_MIN + Math.random() * 0.5;
  if (newLat >= US_LAT_MAX) newLat = US_LAT_MAX - Math.random() * 0.5;
  if (newLng <= US_LNG_MIN) newLng = US_LNG_MIN + Math.random() * 0.5;
  if (newLng >= US_LNG_MAX) newLng = US_LNG_MAX - Math.random() * 0.5;
  return { lat: newLat, lng: newLng };
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
         AND gs.last_location_update > now() - interval '24 hours'
         AND (gs.spawned_at IS NULL OR gs.spawned_at < now() - interval '5 minutes')`,
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
    const wanderDegs = BOT_SPEED_MPH * MPH_TO_DEG_PER_SEC * dtSeconds;
    const chaseDegs = BOT_CHASE_SPEED_MPH * MPH_TO_DEG_PER_SEC * dtSeconds;
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
      const moveDegs = nearest ? chaseDegs : wanderDegs;

      if (nearest) {
        playerBeingChased.add(nearest.user_id);
        const dLat = nearest.latitude - bot.latitude;
        const dLng = nearest.longitude - bot.longitude;
        const rawDist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (rawDist > 0.0001) {
          moveLat = (dLat / rawDist) * chaseDegs;
          moveLng = (dLng / rawDist) * chaseDegs;
        }
      } else {
        // Wander with persistent heading
        const angle = getWanderAngle(bot.user_id);
        moveLat = Math.cos(angle) * wanderDegs;
        moveLng = Math.sin(angle) * wanderDegs;
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

      const clamped = clampToUS(
        bot.latitude + moveLat,
        bot.longitude + moveLng,
      );

      // If hitting US boundary, flip wander angle
      if (clamped.lat !== bot.latitude + moveLat ||
          clamped.lng !== bot.longitude + moveLng) {
        botWanderAngles.set(bot.user_id, Math.random() * 2 * Math.PI);
      }

      updatedPositions.set(bot.user_id, clamped);

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

    // Batch DB update: one query for all bot positions
    if (updatedPositions.size > 0) {
      const values: string[] = [];
      const params: any[] = [];
      let idx = 1;
      for (const bot of allBots) {
        const pos = updatedPositions.get(bot.user_id);
        if (!pos) continue;
        values.push(`($${idx}::text, $${idx + 1}::float, $${idx + 2}::float)`);
        params.push(bot.session_id, pos.lat, pos.lng);
        idx += 3;
      }
      if (values.length > 0) {
        await query(
          `UPDATE game_sessions AS gs SET
            latitude = v.lat, longitude = v.lng, last_location_update = now()
          FROM (VALUES ${values.join(', ')}) AS v(id, lat, lng)
          WHERE gs.id = v.id`,
          params,
        );
      }
    }

    // Batch socket emission: one event with all bot positions
    const botUpdates: Array<{userId: string; sessionId: string; username: string; lat: number; lng: number; ts: number; coinTier: string}> = [];
    const now = Date.now();
    for (const bot of allBots) {
      const pos = updatedPositions.get(bot.user_id);
      if (!pos) continue;
      botUpdates.push({
        userId: bot.user_id,
        sessionId: bot.session_id,
        username: bot.username,
        lat: pos.lat,
        lng: pos.lng,
        ts: now,
        coinTier: getBotVisualTier(bot.user_id),
      });
    }
    if (botUpdates.length > 0) {
      io.to('game').emit('players:batch-update', botUpdates);
      io.of('/spectator').emit('players:batch-update', botUpdates);
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

      // Bot attacks player: check if player has an active shield
      const playerShieldActive = defender.shield_active_until
        ? new Date(defender.shield_active_until) > new Date()
        : false;

      if (playerShieldActive) {
        // Shield blocks the bot attack — clear the shield timer
        await q(
          `UPDATE game_sessions SET shield_active_until = NULL WHERE id = $1`,
          [target.session_id],
        );
      }

      if (!playerShieldActive) {
        // No shield — bot eliminates the player
        const playerCoins = parseInt(defender.map_coins || '0', 10);
        await q(
          `UPDATE game_sessions SET map_coins = 0, is_active = false WHERE id = $1`,
          [target.session_id],
        );
        await q(
          `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
           VALUES ($1, $2, $3, $4, $5, false, true, $6, $7)`,
          [bot.user_id, defender.user_id, bot.map_coins, defender.map_coins, playerCoins, bot.latitude, bot.longitude],
        );

        io.to(`user:${defender.user_id}`).emit('session:eliminated', {
          attackerName: bot.username,
          coinsLost: playerCoins,
        });

        sendPushNotification(
          defender.user_id,
          'You were eliminated!',
          `${bot.username} attacked you and took all ${playerCoins} coins!`,
        ).catch(() => {});

        console.log(`[BotAI] ${bot.username} ELIMINATED ${defender.username} (${playerCoins} coins taken)`);
      } else {
        // Shield absorbed the hit
        await q(
          `INSERT INTO attacks (attacker_id, defender_id, attacker_coins, defender_coins, coins_stolen, defender_had_shield, success, latitude, longitude)
           VALUES ($1, $2, $3, $4, 0, true, false, $5, $6)`,
          [bot.user_id, defender.user_id, bot.map_coins, defender.map_coins, bot.latitude, bot.longitude],
        );

        io.to(`user:${defender.user_id}`).emit('bot:hit-you', {
          botName: bot.username,
          shieldTaken: true,
          message: `${bot.username} attacked you! Your shield blocked the attack.`,
        });

        sendPushNotification(
          defender.user_id,
          'Attack Blocked!',
          `${bot.username} attacked you but your shield blocked it!`,
        ).catch(() => {});

        console.log(`[BotAI] ${bot.username} hit ${defender.username} — SHIELD BLOCKED`);
      }
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
