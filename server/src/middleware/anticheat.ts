import { query } from '../config/database';

const MAX_SPEED_MPH = 300;
const VIOLATION_THRESHOLD = 5;
const GPS_NOISE_MILES = 0.5;
const MIN_ELAPSED_MS = 3000;
const VIOLATION_DECAY_MS = 30000;

const violationCounts = new Map<string, { count: number; lastViolation: number }>();

function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function validateLocationUpdate(
  userId: string,
  sessionId: string,
  newLat: number,
  newLng: number,
): Promise<{ valid: boolean; reason?: string }> {
  const result = await query(
    `SELECT latitude, longitude, last_location_update
     FROM game_sessions WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [sessionId, userId],
  );

  if (result.rows.length === 0) return { valid: true };

  const prev = result.rows[0];
  if (!prev.latitude || !prev.longitude || !prev.last_location_update) {
    return { valid: true };
  }

  const elapsedMs = Date.now() - new Date(prev.last_location_update).getTime();
  if (elapsedMs < MIN_ELAPSED_MS) return { valid: true };

  const dist = distanceMiles(prev.latitude, prev.longitude, newLat, newLng);

  // Short GPS jumps under 0.5 miles are normal noise, not spoofing
  if (dist < GPS_NOISE_MILES) return { valid: true };

  const hours = elapsedMs / 3600000;
  const speed = hours > 0 ? dist / hours : 0;

  if (speed > MAX_SPEED_MPH) {
    const now = Date.now();
    const prev = violationCounts.get(userId);
    // Decay violations if last one was more than 30s ago
    const stale = prev && (now - prev.lastViolation > VIOLATION_DECAY_MS);
    const count = (stale || !prev) ? 1 : prev.count + 1;
    violationCounts.set(userId, { count, lastViolation: now });

    console.warn(`[AntiCheat] Speed violation: user=${userId}, speed=${speed.toFixed(0)}mph, dist=${dist.toFixed(2)}mi, count=${count}`);

    if (count >= VIOLATION_THRESHOLD) {
      await query(
        `UPDATE game_sessions SET is_active = false WHERE id = $1`,
        [sessionId],
      );
      violationCounts.delete(userId);
      console.warn(`[AntiCheat] Session terminated for user=${userId} after ${count} speed violations`);
      return { valid: false, reason: 'Session terminated: GPS spoofing detected.' };
    }

    return { valid: true };
  }

  if (violationCounts.has(userId)) {
    violationCounts.delete(userId);
  }

  return { valid: true };
}
