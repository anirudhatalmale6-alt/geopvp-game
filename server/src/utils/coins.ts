export interface CoinTier {
  dollar: number;
  name: string;
  color: string;
}

export const COIN_TIERS: CoinTier[] = [
  { dollar: 1,  name: 'copper',      color: '#b87333' },
  { dollar: 2,  name: 'tin',         color: '#8a9597' },
  { dollar: 3,  name: 'iron',        color: '#6a6a6a' },
  { dollar: 4,  name: 'nickel',      color: '#7a7a7a' },
  { dollar: 5,  name: 'bronze',      color: '#cd7f32' },
  { dollar: 6,  name: 'brass',       color: '#b5a642' },
  { dollar: 7,  name: 'silver',      color: '#c0c0c0' },
  { dollar: 8,  name: 'electrum',    color: '#d4c675' },
  { dollar: 9,  name: 'gold',        color: '#ffd700' },
  { dollar: 10, name: 'rose-gold',   color: '#e8a090' },
  { dollar: 11, name: 'palladium',   color: '#ced0ce' },
  { dollar: 12, name: 'platinum',    color: '#e5e4e2' },
  { dollar: 13, name: 'opal',        color: '#d4eaf7' },
  { dollar: 14, name: 'topaz',       color: '#ffc87c' },
  { dollar: 15, name: 'amethyst',    color: '#9966cc' },
  { dollar: 16, name: 'aquamarine',  color: '#7fffd4' },
  { dollar: 17, name: 'emerald',     color: '#50c878' },
  { dollar: 18, name: 'pearl',       color: '#f0ead6' },
  { dollar: 19, name: 'sapphire',    color: '#0f52ba' },
  { dollar: 20, name: 'alexandrite', color: '#008b8b' },
  { dollar: 21, name: 'ruby',        color: '#e0115f' },
  { dollar: 22, name: 'black-opal',  color: '#1a1a2e' },
  { dollar: 23, name: 'tanzanite',   color: '#4d4dff' },
  { dollar: 24, name: 'red-beryl',   color: '#c41e3a' },
  { dollar: 25, name: 'diamond',     color: '#b9f2ff' },
];

const TIER_BY_DOLLAR = new Map<number, CoinTier>(
  COIN_TIERS.map((tier) => [tier.dollar, tier])
);

const TIER_BY_NAME = new Map<string, CoinTier>(
  COIN_TIERS.map((tier) => [tier.name, tier])
);

export function getCoinTier(amountCents: number): CoinTier {
  const dollars = Math.floor(amountCents / 100);
  const clamped = Math.max(1, Math.min(25, dollars));
  return TIER_BY_DOLLAR.get(clamped) || COIN_TIERS[0];
}

export function getTierByName(name: string): CoinTier | undefined {
  return TIER_BY_NAME.get(name);
}
