// Geo-fencing: block real-money play in restricted US states.
// These states prohibit or heavily restrict real-money skill-based games.

const BLOCKED_STATES: Record<string, string> = {
  AZ: 'Arizona',
  AR: 'Arkansas',
  CT: 'Connecticut',
  DE: 'Delaware',
  LA: 'Louisiana',
  MT: 'Montana',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
};

const STATE_BOUNDS: Record<string, [number, number, number, number]> = {
  AZ: [31.33, 37.00, -114.82, -109.04],
  AR: [33.00, 36.50, -94.62, -89.64],
  CT: [40.95, 42.05, -73.73, -71.79],
  DE: [38.45, 39.84, -75.79, -75.05],
  LA: [28.92, 33.02, -94.04, -88.82],
  MT: [44.36, 49.00, -116.05, -104.04],
  SC: [32.03, 35.22, -83.35, -78.54],
  SD: [42.48, 45.95, -104.06, -96.44],
  TN: [34.98, 36.68, -90.31, -81.65],
};

export function isBlockedState(stateCode: string): boolean {
  return stateCode.toUpperCase() in BLOCKED_STATES;
}

export function getBlockedStateName(stateCode: string): string | undefined {
  return BLOCKED_STATES[stateCode.toUpperCase()];
}

export function getBlockedStates(): Record<string, string> {
  return { ...BLOCKED_STATES };
}

export function checkLocationBlocked(lat: number, lng: number): { blocked: boolean; state?: string; stateCode?: string } {
  for (const [code, [minLat, maxLat, minLng, maxLng]] of Object.entries(STATE_BOUNDS)) {
    if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
      return { blocked: true, state: BLOCKED_STATES[code], stateCode: code };
    }
  }
  return { blocked: false };
}
