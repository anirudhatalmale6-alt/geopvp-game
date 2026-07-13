import { query } from '../config/database';

/**
 * Player rank is derived from lifetime Prowl Coins (prowl_balances.balance).
 * These thresholds mirror RANK_TIERS in the mobile app — keep them in sync.
 */
export const MYTHIC_PROWLER_MIN_PROWL = 50000;

/** Free shields granted on every buy-in once a player reaches Mythic Prowler. */
export const MYTHIC_FREE_SHIELDS = 3;

/**
 * How many free shields this user's buy-in should grant.
 *
 * Mythic Prowler (50,000+ Prowl Coins) gets MYTHIC_FREE_SHIELDS free shields on
 * every single buy-in, for the life of the account. Everyone else gets 0.
 *
 * `coinsBeingCredited` is the Prowl Coin amount this buy-in is about to add. We
 * count it toward the total so the buy-in that *tips* a player into Mythic also
 * grants the shields — otherwise their profile would read MYTHIC PROWLER while
 * that same buy-in silently gave them nothing.
 */
export async function getFreeShieldsForBuyIn(
  userId: string,
  coinsBeingCredited: number,
): Promise<number> {
  const result = await query(
    `SELECT COALESCE(balance, 0) AS balance FROM prowl_balances WHERE user_id = $1`,
    [userId],
  );

  const current = result.rows.length ? parseInt(result.rows[0].balance, 10) : 0;
  const totalAfterBuyIn = current + coinsBeingCredited;

  return totalAfterBuyIn >= MYTHIC_PROWLER_MIN_PROWL ? MYTHIC_FREE_SHIELDS : 0;
}
