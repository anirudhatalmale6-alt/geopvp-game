import { pool } from '../config/database';

const migration = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_verified BOOLEAN DEFAULT false,
  verification_code VARCHAR(6),
  verification_expires TIMESTAMPTZ,
  reset_code VARCHAR(6),
  reset_expires TIMESTAMPTZ,
  avatar_color VARCHAR(50) DEFAULT 'copper',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  buyin_amount INTEGER NOT NULL,
  coin_tier VARCHAR(30) NOT NULL,
  map_coins INTEGER NOT NULL,
  shields_purchased INTEGER DEFAULT 0,
  shields_remaining INTEGER DEFAULT 0,
  shield_active_until TIMESTAMPTZ,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  last_location_update TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  amount INTEGER NOT NULL,
  description TEXT,
  related_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attacker_id UUID REFERENCES users(id),
  defender_id UUID REFERENCES users(id),
  attacker_coins INTEGER NOT NULL,
  defender_coins INTEGER NOT NULL,
  coins_stolen INTEGER NOT NULL,
  defender_had_shield BOOLEAN DEFAULT false,
  success BOOLEAN NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coin_drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount INTEGER NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  picked_up_by UUID REFERENCES users(id),
  picked_up_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  method VARCHAR(30) NOT NULL,
  payout_details JSONB,
  status VARCHAR(20) DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payout_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  label VARCHAR(100),
  details JSONB NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS waiver_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Dual currency: track currency type on transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'sweep';

-- Prowl Coins ledger (permanent rank coins from purchases)
CREATE TABLE IF NOT EXISTS prowl_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Daily bonus tracking
CREATE TABLE IF NOT EXISTS daily_bonuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_daily_bonuses_user ON daily_bonuses(user_id, claimed_at);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON game_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON game_sessions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sessions_location ON game_sessions(latitude, longitude) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_attacks_attacker ON attacks(attacker_id);
CREATE INDEX IF NOT EXISTS idx_attacks_defender ON attacks(defender_id);
CREATE INDEX IF NOT EXISTS idx_coin_drops_active ON coin_drops(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
`;

async function migrate() {
  console.log('Running database migration...');
  try {
    await pool.query(migration);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
