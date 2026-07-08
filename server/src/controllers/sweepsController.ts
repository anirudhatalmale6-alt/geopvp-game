import { Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../config/database';
import { AuthRequest } from '../middleware/auth';

// ---------------------------------------------------------------------------
// Sweep Coins — the FREE, redeemable currency (sweepstakes model).
//
// Sweep Coins are never sold. They are only obtained through free paths:
//   1. Daily login bonus
//   2. AMOE (mail-in) / promo codes issued by an admin
//   3. A free bonus bundled with a Prowl Coin purchase (see iap/paypal controllers)
// They are the ONLY currency redeemable for cash. Balances and amounts are in
// CENTS (100 = $1.00), matching the rest of the wallet/transaction ledger.
//
// The values below are business/marketing knobs — safe defaults, overridable
// via env so they can be tuned without a code change.
// ---------------------------------------------------------------------------

// Free Sweep Coins granted once per calendar day (UTC). Default $0.25/day.
const DAILY_SWEEP_BONUS_CENTS = parseInt(process.env.DAILY_SWEEP_BONUS_CENTS || '25', 10);

// Sweep balance = sum of the sweep-currency ledger.
async function getSweepBalanceCents(userId: string): Promise<number> {
  const r = await query(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM transactions WHERE user_id = $1 AND currency = 'sweep'`,
    [userId],
  );
  return parseInt(r.rows[0].balance, 10);
}

// Has the user already claimed today's daily bonus (UTC calendar day)?
async function hasClaimedToday(userId: string): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM daily_bonuses
     WHERE user_id = $1 AND claimed_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
     LIMIT 1`,
    [userId],
  );
  return r.rows.length > 0;
}

// ---------------------------------------------------------------------------
// GET /api/sweeps/status — balance, daily-bonus availability, KYC state
// ---------------------------------------------------------------------------
export async function getSweepStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const [balance, claimedToday, userRow] = await Promise.all([
      getSweepBalanceCents(userId),
      hasClaimedToday(userId),
      query(`SELECT kyc_status FROM users WHERE id = $1`, [userId]),
    ]);

    res.json({
      sweepBalance: balance,
      canClaimDaily: !claimedToday,
      dailyBonusCents: DAILY_SWEEP_BONUS_CENTS,
      kycStatus: userRow.rows[0]?.kyc_status || 'unverified',
    });
  } catch (err) {
    console.error('getSweepStatus error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/sweeps/daily — claim the free daily Sweep Coin bonus
// ---------------------------------------------------------------------------
export async function claimDailyBonus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    const result = await transaction(async (q) => {
      // Re-check inside the transaction to prevent double-claims.
      const already = await q(
        `SELECT 1 FROM daily_bonuses
         WHERE user_id = $1 AND claimed_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
         LIMIT 1`,
        [userId],
      );
      if (already.rows.length > 0) {
        return { alreadyClaimed: true as const };
      }

      await q(
        `INSERT INTO daily_bonuses (user_id, amount) VALUES ($1, $2)`,
        [userId, DAILY_SWEEP_BONUS_CENTS],
      );
      await q(
        `INSERT INTO transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'daily_bonus', $2, 'sweep', $3)`,
        [userId, DAILY_SWEEP_BONUS_CENTS, `Daily free Sweep Coin bonus ($${(DAILY_SWEEP_BONUS_CENTS / 100).toFixed(2)})`],
      );
      return { alreadyClaimed: false as const };
    });

    if (result.alreadyClaimed) {
      res.status(400).json({ error: 'Daily bonus already claimed today. Come back tomorrow!' });
      return;
    }

    const balance = await getSweepBalanceCents(userId);
    res.json({ granted: DAILY_SWEEP_BONUS_CENTS, sweepBalance: balance });
  } catch (err) {
    console.error('claimDailyBonus error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}

// ---------------------------------------------------------------------------
// POST /api/sweeps/redeem-code — redeem an AMOE (mail-in) or promo code
// ---------------------------------------------------------------------------
const redeemCodeSchema = z.object({
  code: z.string().min(3, 'Enter a valid code').max(32),
});

export async function redeemSweepCode(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = redeemCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const userId = req.user!.id;
    const code = parsed.data.code.trim().toUpperCase();

    const outcome = await transaction(async (q) => {
      // Lock the code row so concurrent redemptions can't exceed max_redemptions.
      const codeRes = await q(
        `SELECT id, amount, max_redemptions, redemption_count, per_user_once, expires_at, is_active
         FROM sweep_codes WHERE code = $1 FOR UPDATE`,
        [code],
      );
      if (codeRes.rows.length === 0) {
        return { error: 'Code not found.' };
      }
      const c = codeRes.rows[0];
      if (!c.is_active) return { error: 'This code is no longer active.' };
      if (c.expires_at && new Date(c.expires_at) < new Date()) {
        return { error: 'This code has expired.' };
      }
      if (c.redemption_count >= c.max_redemptions) {
        return { error: 'This code has already been fully redeemed.' };
      }
      if (c.per_user_once) {
        const dup = await q(
          `SELECT 1 FROM sweep_code_redemptions WHERE code_id = $1 AND user_id = $2 LIMIT 1`,
          [c.id, userId],
        );
        if (dup.rows.length > 0) return { error: 'You have already redeemed this code.' };
      }

      await q(
        `INSERT INTO sweep_code_redemptions (code_id, user_id, amount) VALUES ($1, $2, $3)`,
        [c.id, userId, c.amount],
      );
      await q(
        `UPDATE sweep_codes SET redemption_count = redemption_count + 1 WHERE id = $1`,
        [c.id],
      );
      await q(
        `INSERT INTO transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'promo_code', $2, 'sweep', $3)`,
        [userId, c.amount, `Redeemed code ${code} — free Sweep Coins ($${(c.amount / 100).toFixed(2)})`],
      );
      return { granted: c.amount as number };
    });

    if ('error' in outcome) {
      res.status(400).json({ error: outcome.error });
      return;
    }

    const balance = await getSweepBalanceCents(userId);
    res.json({ granted: outcome.granted, sweepBalance: balance });
  } catch (err) {
    console.error('redeemSweepCode error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
}
