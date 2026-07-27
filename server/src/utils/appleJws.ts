import crypto, { X509Certificate } from 'crypto';

// StoreKit 2 (react-native-iap v15 / Nitro) no longer produces the legacy
// base64 App Store receipt. Purchases now carry a JWS-signed transaction
// (`purchase.purchaseToken`) — a JWT of the form header.payload.signature,
// signed by Apple with an ES256 leaf certificate chained to Apple Root CA - G3.
//
// This module verifies that JWS entirely on-device-independent, offline crypto:
//   1. the x5c certificate chain is intact (leaf ← intermediate ← root),
//   2. the root is pinned to Apple Root CA - G3 (SHA-256 fingerprint),
//   3. the ES256 signature over header.payload is valid for the leaf key.
// Only then do we trust the decoded payload (bundleId, productId, transactionId,
// environment). No shared secret and no network round-trip to Apple required.

const EXPECTED_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.coinprowl.app';

// SHA-256 fingerprint of Apple Root CA - G3 (DER), colons stripped, uppercase.
// Source: https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
const APPLE_ROOT_CA_G3_FINGERPRINT =
  '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179';

export interface DecodedTransaction {
  bundleId?: string;
  productId?: string;
  transactionId?: string;
  originalTransactionId?: string;
  purchaseDate?: number;
  type?: string;
  environment?: string; // 'Production' | 'Sandbox'
}

export interface JwsVerifyResult {
  valid: boolean;
  sandbox: boolean;
  transactionId?: string;
  productId?: string;
  reason?: string;
}

function b64urlToBuffer(part: string): Buffer {
  return Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function certFingerprint(cert: X509Certificate): string {
  return crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase();
}

// A StoreKit 2 token is a compact JWS: three base64url segments separated by
// dots, whose header carries an `x5c` certificate chain. A legacy base64
// receipt has none of that structure, so this cleanly distinguishes the two.
export function looksLikeJws(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8'));
    return Array.isArray(header.x5c) && header.x5c.length > 0;
  } catch {
    return false;
  }
}

export function verifyStoreKit2Jws(token: string): JwsVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, sandbox: false, reason: 'not_a_jws' };

  let header: any;
  try {
    header = JSON.parse(b64urlToBuffer(parts[0]).toString('utf8'));
  } catch {
    return { valid: false, sandbox: false, reason: 'bad_header' };
  }

  const x5c: string[] = header.x5c;
  if (!Array.isArray(x5c) || x5c.length < 2) {
    return { valid: false, sandbox: false, reason: 'missing_chain' };
  }

  // Build the certificate chain (leaf → intermediate → root).
  let chain: X509Certificate[];
  try {
    chain = x5c.map(
      (der) => new X509Certificate(Buffer.from(der, 'base64')),
    );
  } catch {
    return { valid: false, sandbox: false, reason: 'bad_cert' };
  }

  const leaf = chain[0];
  const root = chain[chain.length - 1];

  // 1. Pin the root to Apple Root CA - G3.
  if (certFingerprint(root) !== APPLE_ROOT_CA_G3_FINGERPRINT) {
    return { valid: false, sandbox: false, reason: 'untrusted_root' };
  }

  // 2. Each certificate must be signed by the next one up the chain.
  for (let i = 0; i < chain.length - 1; i++) {
    if (!chain[i].verify(chain[i + 1].publicKey)) {
      return { valid: false, sandbox: false, reason: `chain_break_${i}` };
    }
  }
  // Root must be self-signed.
  if (!root.verify(root.publicKey)) {
    return { valid: false, sandbox: false, reason: 'root_not_self_signed' };
  }

  // 3. Certificate validity window (allow small clock skew).
  const now = Date.now();
  const skew = 5 * 60 * 1000;
  for (const cert of chain) {
    const notBefore = Date.parse(cert.validFrom);
    const notAfter = Date.parse(cert.validTo);
    if (Number.isFinite(notBefore) && now + skew < notBefore) {
      return { valid: false, sandbox: false, reason: 'cert_not_yet_valid' };
    }
    if (Number.isFinite(notAfter) && now - skew > notAfter) {
      return { valid: false, sandbox: false, reason: 'cert_expired' };
    }
  }

  // 4. Verify the ES256 signature over `header.payload` with the leaf key.
  // JWS ES256 signatures are raw R||S (IEEE P1363), not DER.
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii');
  const signature = b64urlToBuffer(parts[2]);
  let sigOk = false;
  try {
    sigOk = crypto.verify(
      'sha256',
      signingInput,
      { key: leaf.publicKey, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return { valid: false, sandbox: false, reason: 'bad_signature' };
  }

  // 5. Signature is trustworthy — decode and sanity-check the payload.
  let payload: DecodedTransaction;
  try {
    payload = JSON.parse(b64urlToBuffer(parts[1]).toString('utf8'));
  } catch {
    return { valid: false, sandbox: false, reason: 'bad_payload' };
  }

  if (payload.bundleId && payload.bundleId !== EXPECTED_BUNDLE_ID) {
    return { valid: false, sandbox: false, reason: 'bundle_mismatch' };
  }

  return {
    valid: true,
    sandbox: (payload.environment || '').toLowerCase() === 'sandbox',
    transactionId: payload.transactionId,
    productId: payload.productId,
  };
}
