import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

const HMAC_SECRET = 'cpwl-integrity-2026-kx9m';

export function checkMockLocation(location: any): boolean {
  if (Platform.OS === 'android') {
    if (location?.mocked === true) return true;
    if (location?.extras?.isFromMockProvider) return true;
  }
  return false;
}

export async function signRequest(payload: Record<string, any>): Promise<string> {
  const sorted = JSON.stringify(payload, Object.keys(payload).sort());
  const ts = Date.now().toString();
  const raw = sorted + '|' + ts + '|' + HMAC_SECRET;
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw,
  );
  return `${ts}.${hash}`;
}

export function detectSpeedAnomaly(
  prevLat: number,
  prevLng: number,
  newLat: number,
  newLng: number,
  elapsedMs: number,
): boolean {
  const R = 3958.8;
  const dLat = (newLat - prevLat) * Math.PI / 180;
  const dLng = (newLng - prevLng) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(prevLat * Math.PI / 180) *
      Math.cos(newLat * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
  const distMiles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const hours = elapsedMs / 3600000;
  if (hours <= 0) return false;
  const mph = distMiles / hours;
  return mph > 200;
}
