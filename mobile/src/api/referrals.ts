import { api } from './client';

export interface ReferralInfo {
  code: string;
  link: string;
  ratePct: number;
  days: number;
  welcomeCoins: number;
  friendsJoined: number;
  friendsPlayed: number;
  earnedCents: number;
  recent: { friend: string; buyinCents: number; rewardCents: number; at: string }[];
  invitedBy: string | null;
  canClaim: boolean;
  claimWindowDays: number;
}

export async function getMyReferrals(): Promise<ReferralInfo> {
  const { data } = await api.get<ReferralInfo>('/referrals/me');
  return data;
}

export async function claimReferral(code: string): Promise<{ invitedBy: string }> {
  const { data } = await api.post<{ invitedBy: string }>('/referrals/claim', { code });
  return data;
}

// Website: an invite link (coinprowl.com/r/CODE -> /play/?ref=CODE) is remembered until sign-up
const REF_KEY = 'coinprowl_ref';
export function rememberRefFromUrl(): void {
  try {
    if (typeof window === 'undefined' || !window.location) return;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem(REF_KEY, ref.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16));
  } catch {}
}
export function rememberedRef(): string {
  try { return (typeof localStorage !== 'undefined' && localStorage.getItem(REF_KEY)) || ''; } catch { return ''; }
}
export function forgetRef(): void {
  try { typeof localStorage !== 'undefined' && localStorage.removeItem(REF_KEY); } catch {}
}
