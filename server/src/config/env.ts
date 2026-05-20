import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be an integer`);
  return parsed;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
  };
  appName: string;
  attackRadiusMiles: number;
  shieldPriceCents: number;
  shieldDurationMinutes: number;
  maxShieldsPerBuyin: number;
}

export const config: AppConfig = {
  port: optionalInt('PORT', 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  smtp: {
    host: optional('SMTP_HOST', 'smtp.gmail.com'),
    port: optionalInt('SMTP_PORT', 587),
    secure: optional('SMTP_SECURE', 'false') === 'true',
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
    from: optional('SMTP_FROM', ''),
  },
  appName: optional('APP_NAME', 'GeoPVP'),
  attackRadiusMiles: parseFloat(optional('ATTACK_RADIUS_MILES', '0.25')),
  shieldPriceCents: optionalInt('SHIELD_PRICE_CENTS', 99),
  shieldDurationMinutes: optionalInt('SHIELD_DURATION_MINUTES', 10),
  maxShieldsPerBuyin: optionalInt('MAX_SHIELDS_PER_BUYIN', 3),
};
