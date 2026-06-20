import { Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { getCoinTier } from '../utils/coins';
import { createOrder, captureOrder } from '../services/paypal';

const createBuyInOrderSchema = z.object({
  tierDollars: z.number().int().min(1).max(25),
});

const captureOrderSchema = z.object({
  orderId: z.string().min(1),
});

const createShieldOrderSchema = z.object({
  type: z.enum(['standard', 'gold']).default('standard'),
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

// POST /api/paypal/buyin/create — create PayPal order for buy-in
export async function createBuyInOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = createBuyInOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { tierDollars } = parsed.data;
    const userId = req.user!.id;
    const tierCents = tierDollars * 100;
    const tier = getCoinTier(tierCents);
    const mapCoins = tierDollars * 10;

    const result = await createOrder(
      tierDollars.toFixed(2),
      `CoinProwl ${tier.name} Buy-In — ${mapCoins} Prowl Coins`,
      `buyin-${userId}-${Date.now()}`,
    );

    // Store pending order in DB
    await query(
      `INSERT INTO paypal_orders (order_id, user_id, type, amount_cents, tier_dollars, status)
       VALUES ($1, $2, 'buyin', $3, $4, 'CREATED')`,
      [result.orderId, userId, tierCents, tierDollars],
    );

    res.json({
      orderId: result.orderId,
      approvalUrl: result.approvalUrl,
    });
  } catch (err: any) {
    console.error('createBuyInOrder error:', err);
    res.status(500).json({ error: 'Failed to create payment. Please try again.' });
  }
}

// POST /api/paypal/buyin/capture — capture PayPal order and create game session
export async function captureBuyInOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = captureOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { orderId } = parsed.data;
    const userId = req.user!.id;

    // Verify the order belongs to this user
    const orderRow = await query(
      `SELECT * FROM paypal_orders WHERE order_id = $1 AND user_id = $2`,
      [orderId, userId],
    );

    if (orderRow.rows.length === 0) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const order = orderRow.rows[0];
    if (order.status === 'COMPLETED') {
      res.status(400).json({ error: 'This order has already been processed.' });
      return;
    }

    // Capture the payment
    const capture = await captureOrder(orderId);

    if (capture.status !== 'COMPLETED') {
      await query(
        `UPDATE paypal_orders SET status = $1 WHERE order_id = $2`,
        [capture.status, orderId],
      );
      res.status(400).json({ error: `Payment not completed. Status: ${capture.status}` });
      return;
    }

    // Update order status
    await query(
      `UPDATE paypal_orders SET status = 'COMPLETED', capture_id = $1, payer_email = $2 WHERE order_id = $3`,
      [capture.captureId, capture.payerEmail, orderId],
    );

    // Deactivate any existing active session
    await query(
      `UPDATE game_sessions SET is_active = false WHERE user_id = $1 AND is_active = true`,
      [userId],
    );

    const tierDollars = order.tier_dollars;
    const tierCents = tierDollars * 100;
    const tier = getCoinTier(tierCents);
    const mapCoins = tierDollars * 10;

    // Ensure wallet row exists
    await query(
      `INSERT INTO wallets (user_id, balance) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
      [userId],
    );

    // Create game session
    const sessionResult = await query(
      `INSERT INTO game_sessions (
         user_id, buyin_amount, coin_tier, map_coins,
         shields_purchased, shields_remaining
       ) VALUES ($1, $2, $3, $4, 0, 0)
       RETURNING *`,
      [userId, tierCents, tier.name, mapCoins],
    );

    const session = sessionResult.rows[0];

    // Record transaction
    await query(
      `INSERT INTO transactions (user_id, type, amount, currency, description)
       VALUES ($1, 'buyin', $2, 'prowl', $3)`,
      [userId, -tierCents, `Purchased ${mapCoins} Prowl Coins ($${tierDollars} ${tier.name} tier) via PayPal`],
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
    console.error('captureBuyInOrder error:', err);
    res.status(500).json({ error: 'Failed to process payment. Please try again.' });
  }
}

// POST /api/paypal/shield/create — create PayPal order for shield purchase
export async function createShieldOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;

    // Check active session
    const sessionResult = await query(
      `SELECT * FROM game_sessions WHERE user_id = $1 AND is_active = true`,
      [userId],
    );

    if (sessionResult.rows.length === 0) {
      res.status(400).json({ error: 'No active session.' });
      return;
    }

    const session = sessionResult.rows[0];
    const shieldPrice = 0.99;

    const result = await createOrder(
      shieldPrice.toFixed(2),
      'CoinProwl Shield — 10 minute protection',
      `shield-${userId}-${Date.now()}`,
    );

    await query(
      `INSERT INTO paypal_orders (order_id, user_id, type, amount_cents, tier_dollars, status)
       VALUES ($1, $2, 'shield', $3, 0, 'CREATED')`,
      [result.orderId, userId, 99],
    );

    res.json({
      orderId: result.orderId,
      approvalUrl: result.approvalUrl,
    });
  } catch (err: any) {
    console.error('createShieldOrder error:', err);
    res.status(500).json({ error: 'Failed to create payment.' });
  }
}

// POST /api/paypal/shield/capture — capture shield payment and activate shield
export async function captureShieldOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = captureOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { orderId } = parsed.data;
    const userId = req.user!.id;

    const orderRow = await query(
      `SELECT * FROM paypal_orders WHERE order_id = $1 AND user_id = $2`,
      [orderId, userId],
    );

    if (orderRow.rows.length === 0) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const order = orderRow.rows[0];
    if (order.status === 'COMPLETED') {
      res.status(400).json({ error: 'This order has already been processed.' });
      return;
    }

    const capture = await captureOrder(orderId);

    if (capture.status !== 'COMPLETED') {
      await query(
        `UPDATE paypal_orders SET status = $1 WHERE order_id = $2`,
        [capture.status, orderId],
      );
      res.status(400).json({ error: `Payment not completed. Status: ${capture.status}` });
      return;
    }

    await query(
      `UPDATE paypal_orders SET status = 'COMPLETED', capture_id = $1, payer_email = $2 WHERE order_id = $3`,
      [capture.captureId, capture.payerEmail, orderId],
    );

    // Activate shield on current session
    const sessionResult = await query(
      `UPDATE game_sessions
       SET shields_purchased = shields_purchased + 1,
           shields_remaining = shields_remaining + 1,
           shield_active_until = now() + interval '10 minutes'
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
       VALUES ($1, 'shield', -99, 'usd', 'Shield purchased via PayPal')`,
      [userId],
    );

    res.json({ session: formatSession(sessionResult.rows[0]) });
  } catch (err: any) {
    console.error('captureShieldOrder error:', err);
    res.status(500).json({ error: 'Failed to process shield payment.' });
  }
}
