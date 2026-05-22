import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  let raw: string;

  if (Platform.OS === 'ios') {
    raw = (await Application.getIosIdForVendorAsync()) ?? 'unknown-ios';
  } else if (Platform.OS === 'android') {
    raw = Application.getAndroidId() ?? 'unknown-android';
  } else {
    raw = 'web-' + navigator.userAgent;
  }

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    raw + 'coinprowl-salt-2026',
  );

  cachedDeviceId = hash;
  return hash;
}
