import { query } from '../config/database';

const MAX_SPEED_MPH = 200;
const VIOLATION_THRESHOLD = 3;

const violationCounts = new Map<string, number>();

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
  if (elapsedMs < 500) return { valid: true };

  const dist = distanceMiles(prev.latitude, prev.longitude, newLat, newLng);
  const hours = elapsedMs / 3600000;
  const speed = hours > 0 ? dist / hours : 0;

  if (speed > MAX_SPEED_MPH) {
    const count = (violationCounts.get(userId) ?? 0) + 1;
    violationCounts.set(userId, count);

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

    return { valid: false, reason: 'Location update rejected: movement too fast.' };
  }

  if (violationCounts.has(userId)) {
    violationCounts.delete(userId);
  }

  return { valid: true };
}
