#!/usr/bin/env node
//
// Reconcile what Apple charged against what CoinProwl credited.
//
// Apple is the only place that knows every purchase a customer was billed for.
// Our iap_transactions table only knows the ones that made it through
// verification. Anything in the first set and not the second is money the user
// paid and never got coins for — which is exactly the class of bug this script
// was written to find (see the drain in mobile/src/services/iap.ts, which used
// to finish paid transactions without crediting them).
//
// Read-only. It never writes to the database and never touches Apple.
//
// Usage:
//   ASC_KEY=/path/to/AuthKey_9N5FFCA4C9.p8 \
//   DATABASE_URL=postgresql://... \
//   node scripts/reconcile-apple-purchases.mjs
//
// The DB may be reached over an SSH tunnel; this only needs a libpq URL.

import crypto from 'crypto';
import fs from 'fs';
import pg from 'pg';

const KEY_ID = process.env.ASC_KEY_ID || '9N5FFCA4C9';
const ISSUER_ID = process.env.ASC_ISSUER_ID || 'af651b63-096b-4071-b781-b421f383c27d';
const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'com.coinprowl.app';
const KEY_PATH = process.env.ASC_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!KEY_PATH || !DATABASE_URL) {
  console.error('Set ASC_KEY (path to the .p8) and DATABASE_URL.');
  process.exit(1);
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeJwt() {
  const p8 = fs.readFileSync(KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  // The StoreKit endpoints require the bundle id in the payload; the App Store
  // Connect endpoints ignore it. Same key works for both.
  const payload = b64u(JSON.stringify({ iss: ISSUER_ID, iat: now, exp: now + 900, aud: 'appstoreconnect-v1', bid: BUNDLE_ID }));
  const signingInput = `${header}.${payload}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: p8, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64u(sig)}`;
}

const decodeJws = (jws) => JSON.parse(Buffer.from(jws.split('.')[1], 'base64').toString());

// Apple's history endpoint is keyed by ANY transaction id belonging to the
// customer and returns every transaction that customer has for this app.
async function appleHistory(jwt, anyTransactionId) {
  const out = [];
  let revision = null;
  for (let page = 0; page < 20; page++) {
    const url = `https://api.storekit.itunes.apple.com/inApps/v2/history/${anyTransactionId}?sort=DESCENDING`
      + (revision ? `&revision=${revision}` : '');
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
    if (res.status !== 200) throw new Error(`Apple history ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    for (const signed of body.signedTransactions || []) out.push(decodeJws(signed));
    if (!body.hasMore) break;
    revision = body.revision;
  }
  return out;
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();

// One known transaction per customer is enough to unlock their whole history.
const { rows: users } = await db.query(`
  SELECT DISTINCT ON (i.user_id) i.user_id, u.username, u.email, i.transaction_id
  FROM iap_transactions i JOIN users u ON u.id = i.user_id
  WHERE i.sandbox = false
  ORDER BY i.user_id, i.created_at DESC
`);

const jwt = makeJwt();
let grandTotal = 0;
const owed = [];

for (const u of users) {
  let history;
  try {
    history = await appleHistory(jwt, u.transaction_id);
  } catch (err) {
    console.error(`  ! ${u.username}: could not read Apple history — ${err.message}`);
    continue;
  }

  const { rows: ours } = await db.query(
    `SELECT transaction_id FROM iap_transactions WHERE user_id = $1`,
    [u.user_id],
  );
  const credited = new Set(ours.map((r) => r.transaction_id));

  const billed = history.filter((t) => t.environment === 'Production' && !t.revocationDate);
  const missing = billed.filter((t) => !credited.has(t.transactionId));
  const paid = billed.reduce((s, t) => s + (t.price || 0) / 1000, 0);

  console.log(`\n${u.username} <${u.email}>`);
  console.log(`  Apple charged : ${billed.length} purchases, $${paid.toFixed(2)}`);
  // Count only the billed ones we matched — `credited` also holds sandbox rows,
  // which Apple's production history rightly never mentions.
  console.log(`  We credited   : ${billed.length - missing.length}`);

  if (missing.length === 0) {
    console.log('  RECONCILED — nothing owed.');
    continue;
  }

  let sum = 0;
  console.log(`  NOT CREDITED  : ${missing.length}`);
  for (const t of missing) {
    const usd = (t.price || 0) / 1000;
    sum += usd;
    const coins = /^coinprowl_buyin_(\d+)$/.exec(t.productId);
    console.log(`    ${new Date(t.purchaseDate).toISOString().slice(0, 16).replace('T', ' ')}  ${t.productId.padEnd(20)} $${usd.toFixed(2)}  tx=${t.transactionId}${coins ? `  (${Number(coins[1]) * 10} prowl coins)` : ''}`);
  }
  console.log(`  OWED          : $${sum.toFixed(2)}`);
  grandTotal += sum;
  owed.push({ username: u.username, email: u.email, userId: u.user_id, transactions: missing.length, usd: Number(sum.toFixed(2)) });
}

console.log(`\n=======================================`);
console.log(`TOTAL UNCREDITED ACROSS ALL USERS: $${grandTotal.toFixed(2)}`);
if (owed.length) console.log(JSON.stringify(owed, null, 2));
await db.end();
