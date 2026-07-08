import { config } from '../config/env';

// ---------------------------------------------------------------------------
// Tabapay — push-to-debit-card payouts.
//
// Flow for a cash-out to a debit card:
//   1. createCardAccount(...) tokenizes the user's debit card into a Tabapay
//      accountID. We store ONLY that token + last4 — never the raw card number.
//   2. pushToCard(accountID, amount) sends money from our settlement account
//      to that card (Visa Direct / Mastercard Send), usually landing in seconds.
//
// Requires a Tabapay account (bearer token + client ID + a funded settlement
// account ID). Until those env vars are set, isConfigured() is false and the
// debit-card option stays disabled.
// ---------------------------------------------------------------------------

const BASE_URL =
  config.tabapay.mode === 'production'
    ? 'https://api.tabapay.net:10443'
    : 'https://api.sandbox.tabapay.net:10443';

export function isConfigured(): boolean {
  return Boolean(
    config.tabapay.bearerToken &&
      config.tabapay.clientId &&
      config.tabapay.settlementAccountId,
  );
}

function clientPath(suffix: string): string {
  return `${BASE_URL}/v1/clients/${config.tabapay.clientId}${suffix}`;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.tabapay.bearerToken}`,
    'Content-Type': 'application/json',
  };
}

// Normalize a user-entered expiry ("MM/YY", "MMYY", "MM/YYYY", "YYYYMM") to the
// Tabapay format YYYYMM.
export function normalizeExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 6) {
    // Either YYYYMM already, or MMYYYY.
    if (parseInt(digits.slice(0, 2), 10) > 12) return digits; // YYYYMM
    return digits.slice(2) + digits.slice(0, 2); // MMYYYY -> YYYYMM
  }
  if (digits.length === 4) {
    // MMYY
    const mm = digits.slice(0, 2);
    const yy = digits.slice(2);
    return `20${yy}${mm}`;
  }
  throw new Error('Invalid card expiry date.');
}

export interface CardInput {
  number: string;
  expiry: string; // any common format; normalized internally
  cvc: string;
  firstName: string;
  lastName: string;
  zip: string;
}

export interface CardAccountResult {
  accountID: string;
  last4: string;
  network: string; // Visa / Mastercard / ...
  pushAvailable: boolean;
}

export async function createCardAccount(
  card: CardInput,
  referenceID: string,
): Promise<CardAccountResult> {
  if (!isConfigured()) throw new Error('Tabapay is not configured.');

  const body = {
    referenceID,
    card: {
      accountNumber: card.number.replace(/\s/g, ''),
      expirationDate: normalizeExpiry(card.expiry),
      securityCode: card.cvc,
    },
    owner: {
      name: { first: card.firstName, last: card.lastName },
      address: { zipcode: card.zip },
    },
  };

  const res = await fetch(clientPath('/accounts'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (data.EC && data.EC !== '0')) {
    throw new Error(
      `Tabapay card tokenization failed (${res.status}): ${data.EM || JSON.stringify(data)}`,
    );
  }

  const pushAvailable =
    data.card?.pushAvailable === true ||
    data.card?.pushAvailable === 'Yes' ||
    data.card?.pushAvailable === 'yes';

  return {
    accountID: data.accountID,
    last4: data.card?.last4 || card.number.replace(/\s/g, '').slice(-4),
    network: data.card?.network || 'Card',
    pushAvailable,
  };
}

export interface PushResult {
  transactionID: string;
  status: string;
  network: string;
  approvalCode: string;
}

export async function pushToCard(
  destinationAccountID: string,
  amountUsd: string,
  referenceID: string,
): Promise<PushResult> {
  if (!isConfigured()) throw new Error('Tabapay is not configured.');

  const body = {
    referenceID,
    type: 'push',
    accounts: {
      sourceAccountID: config.tabapay.settlementAccountId,
      destinationAccountID,
    },
    currency: '840', // USD (ISO 4217 numeric)
    amount: amountUsd,
  };

  const res = await fetch(clientPath('/transactions'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || (data.EC && data.EC !== '0')) {
    throw new Error(
      `Tabapay push-to-card failed (${res.status}): ${data.EM || JSON.stringify(data)}`,
    );
  }

  // Tabapay returns status COMPLETED / PENDING; networkRC "00" == approved.
  const status = data.status || (data.networkRC === '00' ? 'COMPLETED' : 'UNKNOWN');
  if (status !== 'COMPLETED' && status !== 'PENDING' && status !== 'BATCH') {
    throw new Error(`Tabapay push not approved (status ${status}, RC ${data.networkRC}).`);
  }

  return {
    transactionID: data.transactionID || '',
    status,
    network: data.network || 'Card',
    approvalCode: data.approvalCode || '',
  };
}
