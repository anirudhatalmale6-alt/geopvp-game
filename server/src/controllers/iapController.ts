import { Response } from 'express';
import { z } from 'zod';
import { query, transaction } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getCoinTier } from '../utils/coins';
import { getFreeShieldsForBuyIn } from '../utils/rank';
import { checkLocationBlocked } from '../utils/geofence';
import { looksLikeJws, verifyStoreKit2Jws } from '../utils/appleJws';

const APPLE_VERIFY_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET || '';

const verifyBuyInSchema = z.object({
  receiptData: z.string().min(1),
  productId: z.string().min(1),
  transactionId: z.string().min(1),
  // Optional. A purchase the app is replaying (one that was paid for but never
  // credited — app killed mid-flow, network dropped, backgrounded during
  // Apple's sheet) has no screen state behind it to say which tier it was, so
  // the client can't send this. We derive it from the product id Apple signed,
  // which is the authoritative value anyway.
  tierDollars: z.number().int().min(1).max(25).optional(),
});

// "coinprowl_buyin_7" -> 7. Returns null for anything that isn't a buy-in SKU.
function tierFromProductId(productId: string): number | null {
  const m = /^coinprowl_buyin_(\d{1,2})$/.exec(productId);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 25 ? n : null;
}

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
  transactionId?: string;
  productId?: string;
}> {
  // StoreKit 2 (current app builds) sends a JWS-signed transaction, not the
  // legacy base64 receipt. Verify it offline against Apple's pinned root CA.
  if (looksLikeJws(receiptData)) {
    const jws = verifyStoreKit2Jws(receiptData);
    if (!jws.valid) {
      console.error('[IAP] StoreKit2 JWS verification failed:', jws.reason);
    }
    return {
      valid: jws.valid,
      sandbox: jws.sandbox,
      transactionId: jws.transactionId,
      productId: jws.productId,
    };
  }

  // Legacy fallback: classic /verifyReceipt for older StoreKit 1 receipts.
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
  let data = (await res.json()) as any;

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
    data = (await res.json()) as any;
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

    const parsedTier = parsed.data;
    const userId = req.user!.id;

    // Verify with Apple first, then trust the transaction id / product id that
    // Apple signed over the values the client claimed (defense in depth).
    const verification = await verifyAppleReceipt(parsedTier.receiptData);
    if (!verification.valid) {
      res.status(400).json({ error: 'Receipt verification failed.' });
      return;
    }

    const transactionId = verification.transactionId || parsedTier.transactionId;
    const productId = verification.productId || parsedTier.productId;

    // The tier always comes from the product id Apple signed. The client may
    // send one too, but it is only ever used to cross-check.
    const tierDollars = tierFromProductId(productId);
    if (tierDollars === null) {
      res.status(400).json({ error: 'Not a buy-in product.' });
      return;
    }
    if (parsedTier.tierDollars !== undefined && parsedTier.tierDollars !== tierDollars) {
      res.status(400).json({ error: 'Product ID does not match tier.' });
      return;
    }

    // Already credited. This is a SUCCESS for the caller, not an error: the app
    // replays unfinished transactions until the server confirms they landed, and
    // a 400 here would make it treat a paid-and-credited purchase as failed and
    // replay it forever.
    if (await isTransactionProcessed(transactionId)) {
      res.status(200).json({ alreadyProcessed: true });
      return;
    }

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

    const tierCents = tierDollars * 100;
    const tier = getCoinTier(tierCents);
    const mapCoins = tierDollars * 10;

    // Mythic Prowler perk: free shields on every buy-in.
    const freeShields = await getFreeShieldsForBuyIn(userId, mapCoins);

    // Mark the purchase spent and hand over the coins in ONE database
    // transaction. These used to be separate statements, so a failure partway
    // through could record the purchase as COMPLETED while crediting nothing —
    // and because that row is what blocks replays, the money became
    // unrecoverable. All of it commits or none of it does.
    const session = await transaction(async (q) => {
      // The INSERT is the lock: a second concurrent verify of the same
      // transaction id hits the unique constraint and credits nothing.
      const claimed = await q(
        `INSERT INTO iap_transactions (transaction_id, user_id, product_id, type, tier_dollars, status, sandbox)
         VALUES ($1, $2, $3, 'buyin', $4, 'COMPLETED', $5)
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING id`,
        [transactionId, userId, productId, tierDollars, verification.sandbox],
      );
      if (claimed.rows.length === 0) return null; // raced; already credited

      await q(
        `UPDATE game_sessions SET is_active = false WHERE user_id = $1 AND is_active = true`,
        [userId],
      );
      await q(
        `INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [userId],
      );
      const sessionResult = await q(
        `INSERT INTO game_sessions (
           user_id, buyin_amount, coin_tier, map_coins,
           shields_purchased, shields_remaining
         ) VALUES ($1, $2, $3, $4, 0, $5)
         RETURNING *`,
        [userId, tierCents, tier.name, mapCoins, freeShields],
      );
      await q(
        `INSERT INTO transactions (user_id, type, amount, currency, description)
         VALUES ($1, 'buyin', $2, 'prowl', $3)`,
        [userId, -tierCents, `Purchased ${mapCoins} Prowl Coins ($${tierDollars} ${tier.name} tier) via Apple IAP`],
      );
      await q(
        `INSERT INTO prowl_balances (user_id, balance, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (user_id) DO UPDATE SET balance = prowl_balances.balance + $2, updated_at = now()`,
        [userId, mapCoins],
      );
      return sessionResult.rows[0];
    });

    if (!session) {
      res.status(200).json({ alreadyProcessed: true });
      return;
    }

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

    const parsedShield = parsed.data;
    const userId = req.user!.id;

    const verification = await verifyAppleReceipt(parsedShield.receiptData);
    if (!verification.valid) {
      res.status(400).json({ error: 'Receipt verification failed.' });
      return;
    }

    const transactionId = verification.transactionId || parsedShield.transactionId;
    const productId = verification.productId || parsedShield.productId;

    if (await isTransactionProcessed(transactionId)) {
      res.status(400).json({ error: 'This purchase has already been processed.' });
      return;
    }

    const isGold = productId === 'coinprowl_shield_premium';
    if (productId !== 'coinprowl_shield' && !isGold) {
      res.status(400).json({ error: 'Invalid shield product ID.' });
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
