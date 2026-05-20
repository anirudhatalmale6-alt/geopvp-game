/**
 * GeoApp Theme Constants
 * Dark gaming-oriented theme with cyan/teal primary and pink/red secondary accents.
 */

export const colors = {
  background: '#0a0e1a',
  surface: '#111827',
  surfaceLight: '#1a2235',
  primary: '#00e5ff',
  secondary: '#ff1744',
  accent: '#7c4dff',
  gold: '#ffd700',
  text: '#ffffff',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  border: '#1e293b',
  success: '#00e676',
  error: '#ff1744',
  warning: '#ff9100',
  inputBg: '#1a2235',
  inputBorder: '#00e5ff40',
  overlay: 'rgba(0, 0, 0, 0.6)',
  primaryDim: '#00e5ff20',
  secondaryDim: '#ff174420',
  accentDim: '#7c4dff20',
} as const;

export const fonts = {
  heading: {
    fontWeight: '700' as const,
  },
  headingLarge: {
    fontWeight: '800' as const,
  },
  body: {
    fontWeight: '400' as const,
  },
  bodyBold: {
    fontWeight: '600' as const,
  },
  caption: {
    fontWeight: '400' as const,
    fontSize: 12,
  },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const borderRadius = {
  sm: 6,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 36,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  glow: (color: string) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 6,
  }),
} as const;

const theme = {
  colors,
  fonts,
  spacing,
  borderRadius,
  fontSize,
  shadows,
} as const;

export default theme;
