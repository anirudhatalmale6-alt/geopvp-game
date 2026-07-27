import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getReceiptDataIOS,
  requestReceiptRefreshIOS,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type Purchase,
  type PurchaseError,
  type Product,
} from 'react-native-iap';

const BUYIN_PRODUCT_IDS = Array.from({ length: 25 }, (_, i) => `coinprowl_buyin_${i + 1}`);
const SHIELD_PRODUCT_ID = 'coinprowl_shield';
const SHIELD_PREMIUM_PRODUCT_ID = 'coinprowl_shield_premium';
export const ALL_PRODUCT_IDS = [...BUYIN_PRODUCT_IDS, SHIELD_PRODUCT_ID, SHIELD_PREMIUM_PRODUCT_ID];

export function getBuyInProductId(tierDollars: number): string {
  return `coinprowl_buyin_${tierDollars}`;
}

let purchaseUpdateSubscription: ReturnType<typeof purchaseUpdatedListener> | null = null;
let purchaseErrorSubscription: ReturnType<typeof purchaseErrorListener> | null = null;
let products: Product[] = [];
let connected = false;
let lastError: string | null = null;

function describeError(err: any): string {
  if (!err) return 'unknown';
  return String(err?.code || err?.message || err);
}

export async function setupIAP(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  try {
    await initConnection();
    connected = true;
  } catch (err) {
    connected = false;
    lastError = `init: ${describeError(err)}`;
    console.warn('[IAP] Init failed:', err);
  }
}

export async function loadProducts(): Promise<Product[]> {
  if (Platform.OS !== 'ios') return [];

  try {
    const fetched = await fetchProducts({ skus: ALL_PRODUCT_IDS, type: 'in-app' });
    products = (Array.isArray(fetched) ? fetched : []) as Product[];
    lastError = products.length === 0 ? 'no_products_returned' : null;
    return products;
  } catch (err) {
    lastError = `load: ${describeError(err)}`;
    console.warn('[IAP] Failed to load products:', err);
    return [];
  }
}

// Guarantees an active StoreKit connection and a fresh product fetch. Safe to
// call repeatedly (e.g. every time the buy-in screen opens). This is what lets
// the app self-heal: if products weren't available at startup — App Store still
// propagating a fresh approval, a transient network blip, etc. — reopening the
// buy-in screen re-checks Apple instead of staying stuck on a stale empty list.
export async function ensureProducts(): Promise<Product[]> {
  if (Platform.OS !== 'ios') return [];
  if (products.length > 0) return products;
  if (!connected) await setupIAP();
  return loadProducts();
}

export function getLoadedProducts(): Product[] {
  return products;
}

export function getLastError(): string | null {
  return lastError;
}

export function getProductPrice(productId: string): string | null {
  const product = products.find(p => p.id === productId);
  return product?.displayPrice ?? null;
}

export async function purchaseProduct(productId: string): Promise<void> {
  // react-native-iap v15 reads `request.apple` (falling back to `request.ios`).
  // We pass both so the call is robust across patch versions.
  await requestPurchase({
    request: { apple: { sku: productId }, ios: { sku: productId } },
    type: 'in-app',
  });
}

// Under StoreKit 2 (react-native-iap v15 / Nitro) the completed purchase carries
// a JWS-signed transaction in `purchaseToken`. This is the token the server
// verifies — Apple no longer populates the legacy on-device base64 receipt, so
// `getReceiptDataIOS()` comes back empty on modern builds (which is exactly what
// produced the "Could not read the App Store receipt" error). We prefer the
// StoreKit 2 token and only fall back to the legacy receipt for older devices.
export async function getPurchaseReceipt(purchase?: any): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;

  // StoreKit 2 signed transaction (preferred).
  const token = purchase?.purchaseToken;
  if (typeof token === 'string' && token.length > 0) return token;

  // Legacy StoreKit 1 fallback.
  try {
    const receipt = await getReceiptDataIOS();
    if (receipt) return receipt;
  } catch (err) {
    console.warn('[IAP] getReceiptDataIOS failed, will refresh:', err);
  }
  try {
    const refreshed = await requestReceiptRefreshIOS();
    return refreshed || null;
  } catch (err) {
    console.warn('[IAP] Failed to refresh receipt:', err);
    return null;
  }
}

export function listenForPurchases(
  onPurchase: (purchase: Purchase) => void,
  onError: (error: PurchaseError) => void,
): () => void {
  purchaseUpdateSubscription = purchaseUpdatedListener(onPurchase);
  purchaseErrorSubscription = purchaseErrorListener(onError);

  return () => {
    purchaseUpdateSubscription?.remove();
    purchaseErrorSubscription?.remove();
    purchaseUpdateSubscription = null;
    purchaseErrorSubscription = null;
  };
}

export async function acknowledgePurchase(purchase: Purchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: true });
}

export async function teardownIAP(): Promise<void> {
  purchaseUpdateSubscription?.remove();
  purchaseErrorSubscription?.remove();
  purchaseUpdateSubscription = null;
  purchaseErrorSubscription = null;
  await endConnection();
  connected = false;
}

export { SHIELD_PRODUCT_ID, SHIELD_PREMIUM_PRODUCT_ID, BUYIN_PRODUCT_IDS };
export type { Purchase, Purchase as ProductPurchase, PurchaseError, Product };
