import { config } from '../config/env';

const EARTH_RADIUS_MILES = 3958.8;

export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_MILES * c;
}

export function isWithinAttackRadius(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): boolean {
  return distanceMiles(lat1, lon1, lat2, lon2) <= config.attackRadiusMiles;
}
