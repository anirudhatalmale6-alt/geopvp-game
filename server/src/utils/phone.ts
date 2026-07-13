/**
 * Normalise a US mobile number into the country-code + digits form PayPal's
 * Payouts API expects for a PHONE receiver (e.g. "14155551234").
 *
 * Venmo payouts are US-only and PayPal requires a US mobile number as the
 * receiver, so anything that isn't a plausible 10-digit US number is rejected
 * here rather than failing later at payout time.
 */
export function normalizeUsPhone(input: string): string | null {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return null;
}

/** "14155551234" -> "(415) 555-1234" for display in labels and the admin panel. */
export function formatUsPhone(normalized: string): string {
  const d = normalized.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return normalized;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
