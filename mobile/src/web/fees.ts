/**
 * Website prices include PayPal's processing fee (2.9% + $0.49), so the full buy-in / shield price is left after
 * PayPal's cut. Same formula as the server's withProcessingFee (server/src/services/paypal.ts) — the server's
 * number is what PayPal actually charges; this one is only for showing it before the player pays.
 */
export function withProcessingFee(amountUsd: number): { totalUsd: number; feeUsd: number } {
  const cents = Math.round(amountUsd * 100);
  const total = Math.ceil((cents + 49) / (1 - 0.029));
  return { totalUsd: total / 100, feeUsd: (total - cents) / 100 };
}
export const usd = (n: number) => `$${n.toFixed(2)}`;
