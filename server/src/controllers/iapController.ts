import { Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getCoinTier } from '../utils/coins';
import { getFreeShieldsForBuyIn } from '../utils/rank';
import { checkLocationBlocked } from '../utils/geofence';

const APPLE_VERIFY_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET || '';

const verifyBuyInSchema = z.object({
  receiptData: z.string().min(1),
  productId: z.string().min(1),
  transactionId: z.string().min(1),
  tierDollars: z.number().int().min(1).max(25),
});

const verifyShieldSchema = z.object({
  receiptData: z.string().min(1),
  productId: z.string().min(1),
  transactionId: z.string().min(1),
});

function formatSession(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    buyinAmount: row.buyin_amount,
    coinTier: row.coin_tier,
    mapCoins: row.map_coins,
    shieldsPurchased: row.shields_purchased,
    shieldsBought24h: row.shields_bought_24h ?? 0,
    shieldsRemaining: row.shields_remaining,
    shieldActiveUntil: row.shield_active_until,
    latitude: row.latitude ? parseFloat(row.latitude) : null,
    longitude: row.longitude ? parseFloat(row.longitude) : null,
    lastLocationUpdate: row.last_location_update,
    isActive: row.is_active,
    createdAt: row.created_at,
    spawnedAt: row.spawned_at ?? row.created_at,
  };
}

async function verifyAppleReceipt(receiptData: string): Promise<{
  valid: boolean;
  sandbox: boolean;
  latestReceipt?: any;
}> {
  // Try production first
  let res = await fetch(APPLE_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'receipt-data': receiptData,
      password: APPLE_SHARED_SECRET,
      'exclude-old-transactions': true,
    }),
  });
  let data = await res.json();

  // Status 21007 means sandbox receipt sent to production — retry with sandbox
  if (data.status === 21007) {
    res = await fetch(APPLE_SANDBOX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receiptData,
        password: APPLE_SHARED_SECRET,
        'exclude-old-transactions': true,
      }),
    });
    data = await res.json();
    if (data.status === 0) {
      return { valid: true, sandbox: true, latestReceipt: data };
    }
  }

  if (data.status === 0) {
    return { valid: true, sandbox: false, latestReceipt: data };
  }

  console.error('[IAP] Apple verification failed, status:', data.status);
  return { valid: false, sandbox: false };
}

async function isTransactionProcessed(transactionId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1 FROM iap_transactions WHERE transaction_id = $1 AND status = 'COMPLETED'`,
    [transactionId],
  );
  return result.rows.length > 0;
}

// POST /api/iap/buyin/verify
export async function verifyBuyIn(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = verifyBuyInSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { receiptData, productId, transactionId, tierDollars } = parsed.data;
    const userId = req.user!.id;

    // Prevent replay
    if (await isTransactionProcessed(transactionId)) {
      res.status(400).json({ error: 'This purchase has already been processed.' });
      return;
    }

    // Validate product ID matches tier
    const expectedProductId = `coinprowl_buyin_${tierDollars}`;
    if (productId !== expectedProductId) {
      res.status(400).json({ error: 'Product ID does not match tier.' });
      return;
    }

    // Verify with Apple
    const verification = await verifyAppleReceipt(receiptData);
    if (!verification.valid) {
      res.status(400).json({ error: 'Receipt verification failed.' });
      return;
    }

    // Record the IAP transaction
    await query(
      `INSERT INTO iap_transactions (transaction_id, user_id, product_id, type, tier_dollars, status, sandbox)
       VALUES ($1, $2, $3, 'buyin', $4, 'COMPLETED', $5)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [transactionId, userId, productId, tierDollars, verification.sandbox],
    );

    // Geo check
    const lastLoc = await query(
      `SELECT latitude, longitude FROM game_sessions WHERE user_id = $1 AND latitude IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    if (lastLoc.rows.length > 0) {
      const geoCheck = checkLocationBlocked(
        parseFloat(lastLoc.rows[0].latitude),
        parseFloat(lastLoc.rows[0].longitude),
      );
      if (geoCheck.blocked) {
        res.status(403).json({ error: `CoinProwl is not available in ${geoCheck.state} due to local regulations.` });
        return;
      }
    }

    // Deactivate any existing active session
    await query(
      `UPDATE game_sessions SET is_active = false WHERE user_id = $1 AND is_active = true`,
      [userId],
    );

    const tierCents = tierDollars * 100;
    const tier = getCoinTier(tierCents);
    const mapCoins = tierDollars * 10;

    // Ensure wallet row exists
    await query(
      `INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
      [userId],
    );

    // Mythic Prowler perk: free shields on every buy-in.
    const freeShields = await getFreeShieldsForBuyIn(userId, mapCoins);

    // Create game session
    const sessionResult = await query(
      `INSERT INTO game_sessions (
         user_id, buyin_amount, coin_tier, map_coins,
         shields_purchased, shields_remaining
       ) VALUES ($1, $2, $3, $4, 0, $5)
       RETURNING *`,
      [userId, tierCents, tier.name, mapCoins, freeShields],
    );

    const session = sessionResult.rows[0];

    // Record transaction
    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'buyin', $2, 'prowl', $3)`,
      [userId, -tierCents, `Purchased ${mapCoins} Prowl Coins ($${tierDollars} ${tier.name} tier) via Apple IAP`],
    );

    // Credit Prowl Coins
    await query(
      `INSERT INTO prowl_balances (user_id, balance, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET balance = prowl_balances.balance + $2, updated_at = now()`,
      [userId, mapCoins],
    );

    res.json({ session: formatSession(session) });
  } catch (err: any) {
    console.error('verifyBuyIn error:', err);
    res.status(500).json({ error: 'Failed to process purchase. Please try again.' });
  }
}

// POST /api/iap/shield/verify
export async function verifyShield(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = verifyShieldSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { receiptData, productId, transactionId } = parsed.data;
    const userId = req.user!.id;

    if (await isTransactionProcessed(transactionId)) {
      res.status(400).json({ error: 'This purchase has already been processed.' });
      return;
    }

    const isGold = productId === 'coinprowl_shield_premium';
    if (productId !== 'coinprowl_shield' && !isGold) {
      res.status(400).json({ error: 'Invalid shield product ID.' });
      return;
    }

    const verification = await verifyAppleReceipt(receiptData);
    if (!verification.valid) {
      res.status(400).json({ error: 'Receipt verification failed.' });
      return;
    }

    await query(
      `INSERT INTO iap_transactions (transaction_id, user_id, product_id, type, tier_dollars, status, sandbox)
       VALUES ($1, $2, $3, 'shield', 0, 'COMPLETED', $4)
       ON CONFLICT (transaction_id) DO NOTHING`,
      [transactionId, userId, productId, verification.sandbox],
    );

    const durationMinutes = isGold ? 120 : 10;
    const costCents = isGold ? -499 : -99;
    const label = isGold ? 'Gold Shield ($4.99) — 2 hours via Apple IAP' : 'Shield ($0.99) — 10 minutes via Apple IAP';

    // Activate shield
    const sessionResult = await query(
      `UPDATE game_sessions
       SET shields_purchased = shields_purchased + 1,
           shields_remaining = shields_remaining + 1,
           shield_active_until = now() + interval '${durationMinutes} minutes'
       WHERE user_id = $1 AND is_active = true
       RETURNING *`,
      [userId],
    );

    if (sessionResult.rows.length === 0) {
      res.status(400).json({ error: 'No active session to apply shield to.' });
      return;
    }

    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'shield', $2, 'usd', $3)`,
      [userId, costCents, label],
    );

    res.json({ session: formatSession(sessionResult.rows[0]) });
  } catch (err: any) {
    console.error('verifyShield error:', err);
    res.status(500).json({ error: 'Failed to process shield purchase.' });
  }
}
