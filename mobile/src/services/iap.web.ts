/**
 * Web build: there is no App Store / Google Play billing in a browser.
 * Same exports as iap.ts so every import keeps working; nothing here talks to a store.
 * (Metro picks this file over iap.ts for the web bundle.)
 */
export const BUYIN_PRODUCT_IDS = Array.from({ length: 25 }, (_, i) => `coinprowl_buyin_${i + 1}`);
export const SHIELD_PRODUCT_ID = 'coinprowl_shield';
export const SHIELD_PREMIUM_PRODUCT_ID = 'coinprowl_shield_premium';
export const ALL_PRODUCT_IDS = [...BUYIN_PRODUCT_IDS, SHIELD_PRODUCT_ID, SHIELD_PREMIUM_PRODUCT_ID];

export type Purchase = any;
export type ProductPurchase = any;
export type PurchaseError = any;
export type Product = any;

export function getBuyInProductId(tierDollars: number): string { return `coinprowl_buyin_${tierDollars}`; }
export function setPurchaseActive(_active: boolean): void {}
export async function setupIAP(): Promise<void> {}
export async function redeemAndFinish(_purchase: Purchase): Promise<boolean> { return false; }
export function startGlobalTransactionDrain(): void {}
export async function flushPendingTransactions(): Promise<number> { return 0; }
export async function loadProducts(): Promise<Product[]> { return []; }
export async function ensureProducts(): Promise<Product[]> { return []; }
export function getLoadedProducts(): Product[] { return []; }
export function getLastError(): string | null { return null; }
export function getProductPrice(_productId: string): string | null { return null; }
export async function purchaseProduct(_productId: string): Promise<void> { throw new Error('Purchases are not available in the browser'); }
export async function getPurchaseReceipt(_purchase?: any): Promise<string | null> { return null; }
export function listenForPurchases(..._args: any[]): () => void { return () => {}; }
export async function acknowledgePurchase(_purchase: Purchase): Promise<void> {}
export async function teardownIAP(): Promise<void> {}
