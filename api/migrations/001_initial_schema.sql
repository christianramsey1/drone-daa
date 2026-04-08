-- DroneDAA Initial Schema
-- Run once after creating Vercel Postgres store

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (Sign in with Apple)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  apple_sub     TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_apple_sub_idx ON users (apple_sub);

-- Entitlements (pro features)
CREATE TABLE IF NOT EXISTS entitlements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  source      TEXT NOT NULL DEFAULT 'appstore',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS entitlements_user_id_idx ON entitlements (user_id);

-- Purchases (StoreKit transaction log)
CREATE TABLE IF NOT EXISTS purchases (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform                TEXT NOT NULL,
  product_id              TEXT NOT NULL,
  transaction_id          TEXT NOT NULL,
  original_transaction_id TEXT,
  purchase_date           TIMESTAMPTZ NOT NULL,
  expires_at              TIMESTAMPTZ,
  environment             TEXT NOT NULL DEFAULT 'production',
  raw_payload             JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, transaction_id)
);

CREATE INDEX IF NOT EXISTS purchases_user_id_idx ON purchases (user_id);
CREATE INDEX IF NOT EXISTS purchases_transaction_id_idx ON purchases (transaction_id);
