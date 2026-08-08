import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  getReceiptDataIOS,
  requestReceiptRefreshIOS,
  getPendingTransactionsIOS,
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
let drainSubscription: ReturnType<typeof purchaseUpdatedListener> | null = null;
let products: Product[] = [];
let connected = false;
let lastError: string | null = null;

// True only while the buy-in screen is actively driving a purchase it intends to
// verify and credit. The global drain listener below uses this to know which
// transactions it may finish on sight (stray leftovers) versus which it must
// leave alone (the live purchase, which the screen finishes itself after the
// server verifies the receipt). Set via setPurchaseActive() from the screen.
let purchaseActive = false;
export function setPurchaseActive(active: boolean): void {
  purchaseActive = active;
}

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
    return;
  }

  // Start the global drain BEFORE anything else can replay. StoreKit re-delivers
  // every unfinished transaction through the purchase listener when the app
  // launches / the connection opens. If nothing finishes those replays, an old
  // consumable stays unfinished forever and — critically — while one sits
  // unfinished for a given product, re-buying that SAME tier neither presents a
  // fresh sheet nor emits a purchase event, so the buy-in button spins with no
  // resolution. That is exactly what stranded the $1 tier: bought in an early
  // test before the receipt fix, verification failed, the transaction was never
  // finished, and getPendingTransactionsIOS() does not surface it. Listening for
  // the replay and finishing it is what actually clears it.
  startGlobalTransactionDrain();

  // Belt-and-suspenders: also try the queue-query path (some stranded
  // transactions surface here instead of via replay).
  await flushPendingTransactions();
}

// Finish stray StoreKit transactions the moment they replay, so a leftover from
// a previous run can never sit unfinished and block re-purchase of that
// consumable. Guarded by purchaseActive: while the buy-in screen is driving a
// live purchase, that transaction is ITS to verify + finish (finishing it here
// first would take the user's money without crediting), so we leave it alone.
// Any transaction arriving when no purchase is active is by definition a
// leftover — finish it and drop it (no credit; it isn't tied to a live buy-in).
export function startGlobalTransactionDrain(): void {
  if (Platform.OS !== 'ios') return;
  if (drainSubscription) return;
  drainSubscription = purchaseUpdatedListener((purchase) => {
    if (purchaseActive) return;
    finishTransaction({ purchase: purchase as Purchase, isConsumable: true })
      .then(() => console.warn('[IAP] Drained a stray transaction from a previous run.'))
      .catch((err) => console.warn('[IAP] Failed to drain a stray transaction:', err));
  });
}

// Finish (drain) every StoreKit transaction left unfinished from a prior run so
// it stops blocking re-purchase of the same consumable. Returns how many it
// cleared. Never throws — flushing is best-effort startup hygiene.
export async function flushPendingTransactions(): Promise<number> {
  if (Platform.OS !== 'ios') return 0;
  try {
    const pending = await getPendingTransactionsIOS();
    if (!Array.isArray(pending) || pending.length === 0) return 0;
    let cleared = 0;
    for (const purchase of pending) {
      try {
        await finishTransaction({ purchase: purchase as Purchase, isConsumable: true });
        cleared++;
      } catch (err) {
        console.warn('[IAP] Failed to finish a stranded transaction:', err);
      }
    }
    if (cleared > 0) console.warn(`[IAP] Cleared ${cleared} stranded transaction(s) from a previous run.`);
    return cleared;
  } catch (err) {
    console.warn('[IAP] Could not read pending transactions:', err);
    return 0;
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
  drainSubscription?.remove();
  purchaseUpdateSubscription = null;
  purchaseErrorSubscription = null;
  drainSubscription = null;
  await endConnection();
  connected = false;
}

export { SHIELD_PRODUCT_ID, SHIELD_PREMIUM_PRODUCT_ID, BUYIN_PRODUCT_IDS };
export type { Purchase, Purchase as ProductPurchase, PurchaseError, Product };
