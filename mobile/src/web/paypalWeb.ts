/**
 * Website checkout: the whole page goes to PayPal and PayPal sends it back to coinprowl.com/play?pp=ok|cancel
 * &kind=buyin|shield&token=<order id>. (The app uses an in-app browser instead; a web page can't watch another
 * window on another domain, and iPhone home-screen apps lose popups.) The server still checks the order belongs
 * to the logged-in player when it captures it.
 */
const KEY = 'coinprowl_pp_pending';

export function startWebCheckout(kind: 'buyin' | 'shield', orderId: string, approvalUrl: string): void {
  try { localStorage.setItem(KEY, JSON.stringify({ kind, orderId, t: Date.now() })); } catch {}
  window.location.assign(approvalUrl);
}

export interface WebCheckoutReturn { status: 'ok' | 'cancel'; kind: 'buyin' | 'shield'; orderId: string }

/** Read (once) a PayPal return in the address bar, then clean the address bar. */
export function takeWebCheckoutReturn(): WebCheckoutReturn | null {
  if (typeof window === 'undefined' || !window.location) return null;
  const q = new URLSearchParams(window.location.search);
  const status = q.get('pp');
  if (status !== 'ok' && status !== 'cancel') return null;
  const kind = q.get('kind') === 'shield' ? 'shield' : 'buyin';
  let orderId = q.get('token') || '';
  try {
    const pending = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!orderId && pending && pending.kind === kind) orderId = pending.orderId;   // cancel returns may omit it
    localStorage.removeItem(KEY);
  } catch {}
  try { window.history.replaceState(null, '', window.location.pathname); } catch {}
  return { status, kind, orderId };
}
