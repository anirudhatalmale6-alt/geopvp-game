import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';

/**
 * Web only: is this a phone/tablet browser? The map game needs a real phone GPS — a desktop browser can fake
 * its location in two clicks (dev tools), so on a computer players get their account but not the map.
 */
export function isPhoneBrowser(): boolean {
  if (!isWeb || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS reports itself as a Mac: tell it apart by touch
  return /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
}

/** web: also show the URL-based message ("buy coins in the app") */
export const WEB_BUY_MESSAGE =
  'Buying coins on the website is coming soon. For now, buy in from the CoinProwl app, then play here with the same account.';
