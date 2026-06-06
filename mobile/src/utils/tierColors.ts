const TIER_COLORS: Record<string, string> = {
  copper: '#b87333',
  tin: '#8a9597',
  iron: '#6a6a6a',
  nickel: '#7a7a7a',
  bronze: '#cd7f32',
  brass: '#b5a642',
  silver: '#c0c0c0',
  electrum: '#d4c675',
  gold: '#ffd700',
  'rose-gold': '#e8a090',
  palladium: '#ced0ce',
  platinum: '#e5e4e2',
  opal: '#d4eaf7',
  topaz: '#ffc87c',
  amethyst: '#9966cc',
  aquamarine: '#7fffd4',
  emerald: '#50c878',
  pearl: '#f0ead6',
  sapphire: '#0f52ba',
  alexandrite: '#008b8b',
  ruby: '#e0115f',
  'black-opal': '#1a1a2e',
  tanzanite: '#7b68ee',
  'red-beryl': '#c41e3a',
  diamond: '#b9f2ff',
  prowler: '#ff6600',
};

export function getTierColor(tierName: string): string {
  return TIER_COLORS[tierName] || '#ffd700';
}
