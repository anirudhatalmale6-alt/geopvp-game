/**
 * Game API functions for CoinProwl
 */

import { api } from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameSession {
  id: string;
  userId: string;
  buyinAmount: number;
  coinTier: string;
  mapCoins: number;
  shieldsPurchased: number;
  shieldsBought24h: number;
  shieldsRemaining: number;
  shieldActiveUntil: string | null;
  latitude: number | null;
  longitude: number | null;
  lastLocationUpdate: string | null;
  isActive: boolean;
  createdAt: string;
  spawnedAt: string;
}

export interface NearbyPlayer {
  id: string;
  username: string;
  latitude: number;
  longitude: number;
  mapCoins: number;
  shieldActive: boolean;
  sessionId: string;
  distanceMiles?: number;
  coinTier?: string;
  prowlBalance?: number;
}

export interface AttackResult {
  success: boolean;
  coinsStolen: number;
  defenderHadShield: boolean;
  message: string;
}

export interface CoinDrop {
  id: string;
  amount: number;
  latitude: number;
  longitude: number;
  createdAt: string;
}

export interface CollectResult {
  collected: boolean;
  amount: number;
  mapCoins: number;
}

export interface PayoutMethods {
  paypal: boolean;
  venmo: boolean;
  debit: boolean;
}

export interface WalletData {
  balance: number;
  sweepBalance: number;
  prowlBalance: number;
  canClaimDaily: boolean;
  userId: string;
  payoutMethods?: PayoutMethods;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  prowlCoins: number;
  isYou: boolean;
}

export interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  myRank: number;
  myProwlCoins: number;
}

export interface CombatStats {
  sessions: number;
  coinsEarned: number;
  attacksWon: number;
  attacksLost: number;
  shieldsUsed: number;
  playersHit: number;
}

export interface Transaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  relatedUserId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Game Session API
// ---------------------------------------------------------------------------

export interface GeoFenceResult {
  blocked: boolean;
  state?: string;
  stateCode?: string;
  blockedStates?: Record<string, string>;
}

export async function checkGeoFence(lat: number, lng: number): Promise<GeoFenceResult> {
  try {
    const { data } = await api.get<GeoFenceResult>(`/game/geofence?lat=${lat}&lng=${lng}`);
    return data;
  } catch {
    return { blocked: false };
  }
}

export async function createSession(tierDollars: number): Promise<GameSession> {
  const { data } = await api.post<{ session: GameSession }>('/game/sessions', {
    tierDollars,
  });
  return data.session;
}

export async function getActiveSession(): Promise<GameSession | null> {
  const { data } = await api.get<{ session: GameSession | null }>('/game/sessions/active');
  return data.session;
}

export async function updateLocation(lat: number, lng: number): Promise<void> {
  await api.post('/game/sessions/location', { latitude: lat, longitude: lng });
}

export async function getNearbyPlayers(): Promise<NearbyPlayer[]> {
  try {
    const { data } = await api.get<{ players: NearbyPlayer[] }>('/game/nearby');
    return data.players;
  } catch {
    return [];
  }
}

export async function getAllPlayers(): Promise<{ players: NearbyPlayer[]; totalOnMap: number }> {
  try {
    const { data } = await api.get<{ players: NearbyPlayer[]; totalOnMap: number }>('/game/players');
    return { players: data.players, totalOnMap: data.totalOnMap ?? data.players.length };
  } catch {
    return { players: [], totalOnMap: 0 };
  }
}

export async function attackPlayer(targetSessionId: string): Promise<AttackResult> {
  const { data } = await api.post<AttackResult>('/game/attack', {
    targetSessionId,
  });
  return data;
}

export async function buyShield(type: 'standard' | 'gold' = 'standard'): Promise<GameSession> {
  const { data } = await api.post<{ session: GameSession }>('/game/shield', { type });
  return data.session;
}

/** Spend one of the free shields granted by the Mythic Prowler rank. No payment. */
export async function activateFreeShield(): Promise<GameSession> {
  const { data } = await api.post<{ session: GameSession }>('/game/shield/free');
  return data.session;
}

// ---------------------------------------------------------------------------
// Coin Drop API
// ---------------------------------------------------------------------------

export async function getCoinDrops(): Promise<CoinDrop[]> {
  try {
    const { data } = await api.get<{ coins: CoinDrop[] }>('/game/coins');
    return data.coins;
  } catch {
    return [];
  }
}

export async function collectCoinDrop(dropId: string): Promise<CollectResult> {
  const { data } = await api.post<CollectResult>(`/game/coins/${dropId}/collect`);
  return data;
}

// ---------------------------------------------------------------------------
// Combat Stats API
// ---------------------------------------------------------------------------

export async function getCombatStats(): Promise<CombatStats> {
  try {
    const { data } = await api.get<CombatStats>('/game/stats');
    return data;
  } catch {
    return { sessions: 0, coinsEarned: 0, attacksWon: 0, attacksLost: 0, shieldsUsed: 0, playersHit: 0 };
  }
}

// ---------------------------------------------------------------------------
// Wallet API
// ---------------------------------------------------------------------------

export async function getWallet(): Promise<WalletData> {
  const { data } = await api.get<WalletData>('/wallet');
  return data;
}

export async function getTransactions(): Promise<Transaction[]> {
  try {
    const { data } = await api.get<{ transactions: Transaction[] }>('/wallet/transactions');
    return data.transactions;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Redemption API
// ---------------------------------------------------------------------------

export interface RedeemResult {
  success: boolean;
  message: string;
  withdrawalId: string;
  batchId: string;
}

export interface Redemption {
  id: string;
  amount: number;
  method: string;
  status: string;
  paypalEmail: string | null;
  createdAt: string;
}

export interface DebitCardInput {
  number: string;
  expiry: string;
  cvc: string;
  firstName: string;
  lastName: string;
  zip: string;
}

/**
 * @param recipient PayPal email, or — for Venmo — the US mobile number on the account.
 * @param email     Venmo only: the email on the account (required alongside the phone).
 */
export async function redeemSweepCoins(
  recipient: string,
  amountCents: number,
  method: 'paypal' | 'venmo' | 'debit' = 'paypal',
  card?: DebitCardInput,
  email?: string,
): Promise<RedeemResult> {
  const payload: Record<string, unknown> = { amountCents, method };
  if (method === 'debit') {
    payload.card = card;
  } else {
    payload.recipient = recipient;
    if (method === 'venmo') payload.email = email;
  }
  const { data } = await api.post<RedeemResult>('/wallet/redeem', payload);
  return data;
}

export async function getRedemptions(): Promise<Redemption[]> {
  try {
    const { data } = await api.get<{ redemptions: Redemption[] }>('/wallet/redemptions');
    return data.redemptions;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Leaderboard API
// ---------------------------------------------------------------------------

export async function getLeaderboard(): Promise<LeaderboardData> {
  try {
    const { data } = await api.get<LeaderboardData>('/game/leaderboard');
    return data;
  } catch {
    return { leaderboard: [], myRank: 0, myProwlCoins: 0 };
  }
}

// ---------------------------------------------------------------------------
// Block User API
// ---------------------------------------------------------------------------

export interface BlockedUser {
  userId: string;
  username: string;
  blockedAt: string;
}

export async function blockUser(targetUserId: string): Promise<void> {
  await api.post('/game/block', { targetUserId });
}

export async function unblockUser(targetUserId: string): Promise<void> {
  await api.delete(`/game/block/${targetUserId}`);
}

export async function getBlockedUsers(): Promise<BlockedUser[]> {
  try {
    const { data } = await api.get<{ blockedUsers: BlockedUser[] }>('/game/blocked');
    return data.blockedUsers;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// PayPal Payment API
// ---------------------------------------------------------------------------

export interface PayPalOrderResult {
  orderId: string;
  approvalUrl: string;
}

export async function createBuyInOrder(tierDollars: number): Promise<PayPalOrderResult> {
  const { data } = await api.post<PayPalOrderResult>('/paypal/buyin/create', { tierDollars });
  return data;
}

export async function captureBuyInOrder(orderId: string): Promise<{ session: GameSession }> {
  const { data } = await api.post<{ session: GameSession }>('/paypal/buyin/capture', { orderId });
  return data;
}

export async function createShieldOrder(type: 'standard' | 'gold' = 'standard'): Promise<PayPalOrderResult> {
  const { data } = await api.post<PayPalOrderResult>('/paypal/shield/create', { type });
  return data;
}

export async function captureShieldOrder(orderId: string): Promise<{ session: GameSession }> {
  const { data } = await api.post<{ session: GameSession }>('/paypal/shield/capture', { orderId });
  return data;
}

// ---------------------------------------------------------------------------
// Apple In-App Purchase API
// ---------------------------------------------------------------------------

export async function verifyBuyInReceipt(
  receiptData: string,
  productId: string,
  transactionId: string,
  tierDollars: number,
): Promise<{ session: GameSession }> {
  const { data } = await api.post<{ session: GameSession }>('/iap/buyin/verify', {
    receiptData,
    productId,
    transactionId,
    tierDollars,
  });
  return data;
}

export async function verifyShieldReceipt(
  receiptData: string,
  productId: string,
  transactionId: string,
): Promise<{ session: GameSession }> {
  const { data } = await api.post<{ session: GameSession }>('/iap/shield/verify', {
    receiptData,
    productId,
    transactionId,
  });
  return data;
}
