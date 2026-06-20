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

  const data: any = await res.json();
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

  const data: any = await res.json();
  return {
    batchId: data.batch_header?.payout_batch_id ?? '',
    status: data.batch_header?.batch_status ?? 'UNKNOWN',
  };
}

// ---------------------------------------------------------------------------
// Orders API — accept payments (buy-in / shield purchases)
// ---------------------------------------------------------------------------

export interface CreateOrderResult {
  orderId: string;
  approvalUrl: string;
}

export async function createOrder(
  amountUsd: string,
  description: string,
  referenceId: string,
): Promise<CreateOrderResult> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: referenceId,
          description,
          amount: {
            currency_code: 'USD',
            value: amountUsd,
          },
        },
      ],
      application_context: {
        brand_name: 'CoinProwl',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
        return_url: 'https://api.coinprowl.com/api/paypal/return',
        cancel_url: 'https://api.coinprowl.com/api/paypal/cancel',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal create order failed (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  const approvalLink = data.links?.find((l: any) => l.rel === 'approve');

  return {
    orderId: data.id,
    approvalUrl: approvalLink?.href ?? '',
  };
}

export interface CaptureResult {
  orderId: string;
  status: string;
  payerEmail: string;
  captureId: string;
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayPal capture failed (${res.status}): ${body}`);
  }

  const data: any = await res.json();
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

  return {
    orderId: data.id,
    status: data.status,
    payerEmail: data.payer?.email_address ?? '',
    captureId: capture?.id ?? '',
  };
}

export async function getOrderDetails(orderId: string): Promise<any> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`PayPal get order failed (${res.status})`);
  }

  return res.json();
}

export async function getPayoutStatus(batchId: string): Promise<string> {
  const token = await getAccessToken();

  const res = await fetch(`${BASE_URL}/v1/payments/payouts/${batchId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`PayPal payout status check failed (${res.status})`);
  }

  const data: any = await res.json();
  return data.batch_header?.batch_status ?? 'UNKNOWN';
}
