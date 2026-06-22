import { Platform } from 'react-native';
import {
  initConnection,
  endConnection,
  getProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  type ProductPurchase,
  type PurchaseError,
  type Product,
  flushFailedPurchasesCachedAsPendingAndroid,
} from 'react-native-iap';

const BUYIN_PRODUCT_IDS = Array.from({ length: 25 }, (_, i) => `coinprowl_buyin_${i + 1}`);
const SHIELD_PRODUCT_ID = 'coinprowl_shield';
export const ALL_PRODUCT_IDS = [...BUYIN_PRODUCT_IDS, SHIELD_PRODUCT_ID];

export function getBuyInProductId(tierDollars: number): string {
  return `coinprowl_buyin_${tierDollars}`;
}

let purchaseUpdateSubscription: ReturnType<typeof purchaseUpdatedListener> | null = null;
let purchaseErrorSubscription: ReturnType<typeof purchaseErrorListener> | null = null;
let products: Product[] = [];

export async function setupIAP(): Promise<void> {
  if (Platform.OS !== 'ios') return;

  try {
    await initConnection();
    await flushFailedPurchasesCachedAsPendingAndroid();
  } catch (err) {
    console.warn('[IAP] Init failed:', err);
  }
}

export async function loadProducts(): Promise<Product[]> {
  if (Platform.OS !== 'ios') return [];

  try {
    products = await getProducts({ skus: ALL_PRODUCT_IDS });
    return products;
  } catch (err) {
    console.warn('[IAP] Failed to load products:', err);
    return [];
  }
}

export function getLoadedProducts(): Product[] {
  return products;
}

export function getProductPrice(productId: string): string | null {
  const product = products.find(p => p.productId === productId);
  return product?.localizedPrice ?? null;
}

export async function purchaseProduct(productId: string): Promise<void> {
  await requestPurchase({ sku: productId });
}

export function listenForPurchases(
  onPurchase: (purchase: ProductPurchase) => void,
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

export async function acknowledgePurchase(purchase: ProductPurchase): Promise<void> {
  await finishTransaction({ purchase, isConsumable: true });
}

export async function teardownIAP(): Promise<void> {
  purchaseUpdateSubscription?.remove();
  purchaseErrorSubscription?.remove();
  purchaseUpdateSubscription = null;
  purchaseErrorSubscription = null;
  await endConnection();
}

export { SHIELD_PRODUCT_ID, BUYIN_PRODUCT_IDS };
export type { ProductPurchase, PurchaseError, Product };
