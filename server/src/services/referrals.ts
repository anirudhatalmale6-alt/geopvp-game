// ---------------------------------------------------------------------------
// Referrals (Jet, 26/10/2026)
//
// Every player has an invite code (coinprowl.com/r/CODE). A friend who signs up with it is tied to the inviter.
// For the friend's first REFERRAL_DAYS days, each REAL buy-in (Apple purchase or PayPal) pays the inviter
// REFERRAL_RATE of it in Sweep coins (cents, cash-out-able, same ledger as everything else). The friend gets
// WELCOME_COINS extra map coins on their first real buy-in.
//
// One level only (no rewards from friends-of-friends). Admin-loaded coins and winnings never count: only the
// two paid buy-in paths call onPaidBuyIn. Each purchase pays at most once (referral_rewards.source_ref unique).
// A failure here never fails the purchase itself — callers ignore errors (they are logged).
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import { query } from '../config/database';

export const REFERRAL_RATE = 0.10;
export const REFERRAL_DAYS = 90;
export const WELCOME_COINS = 10;
export const CLAIM_WINDOW_DAYS = 7;   // a code can still be added after sign-up, within this window, before any buy-in

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I

function randomSuffix(n: number): string {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;
}

export function normalizeCode(code: string): string {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

/** The player's invite code, created the first time it is asked for. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const r = await query(`SELECT referral_code, username FROM users WHERE id = $1`, [userId]);
  if (!r.rows.length) throw new Error('user not found');
  if (r.rows[0].referral_code) return r.rows[0].referral_code;
  const base = String(r.rows[0].username || 'HUNTER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'HUNTER';
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = base + randomSuffix(attempt < 4 ? 3 : 5);
    const u = await query(
      `UPDATE users SET referral_code = $1 WHERE id = $2 AND referral_code IS NULL
         AND NOT EXISTS (SELECT 1 FROM users WHERE referral_code = $1)
       RETURNING referral_code`,
      [code, userId],
    );
    if (u.rows.length) return u.rows[0].referral_code;
    const again = await query(`SELECT referral_code FROM users WHERE id = $1`, [userId]);
    if (again.rows[0]?.referral_code) return again.rows[0].referral_code;   // set concurrently
  }
  throw new Error('could not create a referral code');
}

/** Tie a new player to the owner of `code`. Returns the inviter's username, or null if the code is not usable. */
export async function linkReferral(userId: string, code: string): Promise<string | null> {
  const c = normalizeCode(code);
  if (!c) return null;
  const inviter = await query(`SELECT id, username FROM users WHERE referral_code = $1`, [c]);
  if (!inviter.rows.length || inviter.rows[0].id === userId) return null;
  const u = await query(
    `UPDATE users SET referred_by = $1, referred_at = now() WHERE id = $2 AND referred_by IS NULL RETURNING id`,
    [inviter.rows[0].id, userId],
  );
  return u.rows.length ? inviter.rows[0].username : null;
}

/** Can this player still add a friend's code? (not referred yet, account young, no buy-in yet) */
export async function canClaim(userId: string): Promise<boolean> {
  const r = await query(
    `SELECT (u.referred_by IS NULL)
        AND u.created_at > now() - ($2 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id AND t.type = 'buyin') AS ok
       FROM users u WHERE u.id = $1`,
    [userId, String(CLAIM_WINDOW_DAYS)],
  );
  return !!r.rows[0]?.ok;
}

/**
 * Call after a REAL buy-in has been credited. sourceRef = the purchase's own id (PayPal order / Apple transaction).
 * Returns the welcome coins added to `sessionId` (0 if none).
 */
export async function onPaidBuyIn(userId: string, tierCents: number, sessionId: string, sourceRef: string): Promise<number> {
  const r = await query(
    `SELECT referred_by, referred_at, referral_welcome_at, username FROM users WHERE id = $1`,
    [userId],
  );
  const u = r.rows[0];
  if (!u || !u.referred_by) return 0;
  const withinWindow = u.referred_at && Date.now() - new Date(u.referred_at).getTime() <= REFERRAL_DAYS * 86400000;
  if (!withinWindow) return 0;

  const rewardCents = Math.floor(tierCents * REFERRAL_RATE);
  if (rewardCents > 0) {
    const ins = await query(
      `INSERT INTO referral_rewards (referrer_id, friend_id, source_ref, buyin_cents, reward_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source_ref) DO NOTHING
       RETURNING id`,
      [u.referred_by, userId, sourceRef, tierCents, rewardCents],
    );
    if (ins.rows.length) {
      await query(
        `INSERT INTO transactions (user_id, type, amount, currency, description, related_user_id)
         VALUES ($1, 'referral', $2, 'sweep', $3, $4)`,
        [u.referred_by, rewardCents, `Referral reward: 10% of ${u.username}'s $${(tierCents / 100).toFixed(2)} buy-in`, userId],
      );
    }
  }

  // welcome bonus, once, on the friend's first real buy-in
  const w = await query(
    `UPDATE users SET referral_welcome_at = now() WHERE id = $1 AND referral_welcome_at IS NULL RETURNING id`,
    [userId],
  );
  if (!w.rows.length) return 0;
  await query(`UPDATE game_sessions SET map_coins = map_coins + $1 WHERE id = $2`, [WELCOME_COINS, sessionId]);
  await query(
    `INSERT INTO transactions (user_id, type, amount, currency, description)
     VALUES ($1, 'referral_welcome', $2, 'bonus', $3)`,
    [userId, WELCOME_COINS, `Welcome bonus: +${WELCOME_COINS} coins for joining with a friend's invite`],
  );
  return WELCOME_COINS;
}

/** Run onPaidBuyIn without ever failing the purchase. */
export async function onPaidBuyInSafe(userId: string, tierCents: number, sessionId: string, sourceRef: string): Promise<number> {
  try {
    return await onPaidBuyIn(userId, tierCents, sessionId, sourceRef);
  } catch (err) {
    console.error('[Referral] reward failed for', sourceRef, err);
    return 0;
  }
}

export const REFERRAL_SCHEMA = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code) WHERE referral_code IS NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_welcome_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
CREATE TABLE IF NOT EXISTS referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  friend_id UUID REFERENCES users(id) ON DELETE CASCADE,
  source_ref VARCHAR(120) NOT NULL UNIQUE,
  buyin_cents INTEGER NOT NULL,
  reward_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);
`;
