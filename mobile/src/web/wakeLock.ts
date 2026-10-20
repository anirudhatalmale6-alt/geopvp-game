/** web: keep the phone screen on while the map is open (a sleeping screen stops the browser's GPS) */
import { isWeb } from './platform';

let lock: any = null;
async function grab() {
  try { if ((navigator as any).wakeLock && document.visibilityState === 'visible') lock = await (navigator as any).wakeLock.request('screen'); } catch { /* not supported / denied */ }
}
const onVis = () => { if (document.visibilityState === 'visible' && !lock) grab(); };

export function holdScreenOn(): () => void {
  if (!isWeb || typeof document === 'undefined') return () => {};
  grab();
  document.addEventListener('visibilitychange', onVis);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    try { lock && lock.release(); } catch {}
    lock = null;
  };
}
