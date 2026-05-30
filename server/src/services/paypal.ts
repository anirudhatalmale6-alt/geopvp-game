import { config } from '../config/env';

const BASE_URL =
  config.paypal.mode === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const auth = Buffer.from(
    `${config.paypal.clientId}:${config.paypal.clientSecret}`,
  ).toString('base64');

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal auth failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

export interface PayoutResult {
  batchId: string;
  status: string;
}

export async function sendPayout(
  recipient: string,
  amountUsd: string,
  senderItemId: string,
  note: string,
  method: 'paypal' | 'venmo' = 'paypal',
): Promise<PayoutResult> {
  const token = await getAccessToken();

  const isVenmo = method === 'venmo';
  const isPhone = /^\+?\d{10,15}$/.test(recipient.replace(/[\s()-]/g, ''));

  const item: Record<string, unknown> = {
    recipient_type: isPhone ? 'PHONE' : 'EMAIL',
    amount: { value: amountUsd, currency: 'USD' },
    receiver: recipient,
    note,
    sender_item_id: senderItemId,
  };

  if (isVenmo) {
    item.recipient_wallet = 'VENMO';
  }

  const res = await fetch(`${BASE_URL}/v1/payments/payouts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: senderItemId,
        email_subject: isVenmo
          ? 'CoinProwl — Venmo Redemption'
          : 'CoinProwl — Sweep Coin Redemption',
        email_message:
          'You have received a payout from your CoinProwl sweep coin redemption.',
      },
      items: [item],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal payout failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    batchId: data.batch_header?.payout_batch_id ?? '',
    status: data.batch_header?.batch_status ?? 'UNKNOWN',
  };
}

export async function getPayoutStatus(batchId: string): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/payments/payouts/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`PayPal payout status check failed (${res.status})`);
  }

  const data = await res.json();
  return data.batch_header?.batch_status ?? 'UNKNOWN';
}
