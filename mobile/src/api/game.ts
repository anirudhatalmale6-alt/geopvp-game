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
  shieldsRemaining: number;
  shieldActiveUntil: string | null;
  latitude: number | null;
  longitude: number | null;
  lastLocationUpdate: string | null;
  isActive: boolean;
  createdAt: string;
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

export interface WalletData {
  balance: number;
  userId: string;
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

export async function createSession(tierDollars: number): Promise<GameSession> {
  const { data } = await api.post<{ session: GameSession }>('/game/sessions', {
    tierDollars,
  });
  return data.session;
}

export async function getActiveSession(): Promise<GameSession | null> {
  try {
    const { data } = await api.get<{ session: GameSession | null }>('/game/sessions/active');
    return data.session;
  } catch {
    return null;
  }
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

export async function getAllPlayers(): Promise<NearbyPlayer[]> {
  try {
    const { data } = await api.get<{ players: NearbyPlayer[] }>('/game/players');
    return data.players;
  } catch {
    return [];
  }
}

export async function attackPlayer(targetSessionId: string): Promise<AttackResult> {
  const { data } = await api.post<AttackResult>('/game/attack', {
    targetSessionId,
  });
  return data;
}

export async function buyShield(): Promise<GameSession> {
  const { data } = await api.post<{ session: GameSession }>('/game/shield');
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
