-- =============================================================================
-- EcoFinance Initial Migration
-- =============================================================================
-- This migration creates the full database schema including PostGIS support,
-- all tables, indexes, the geolocation function, and the auto-populate trigger.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enable PostGIS extension (Supabase exposes it under the 'extensions' schema)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 2. Custom ENUM types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE account_type AS ENUM ('banco', 'carteira');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_category AS ENUM (
    'comida', 'transporte', 'assinaturas', 'lazer', 'saude',
    'educacao', 'moradia', 'salario', 'investimento', 'transferencia', 'desconhecido'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_source AS ENUM (
    'notification', 'pluggy', 'ofx', 'manual', 'uber'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Accounts table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            account_type NOT NULL DEFAULT 'banco',
  balance         NUMERIC(15, 2) NOT NULL DEFAULT 0,
  pluggy_item_id  TEXT,
  pluggy_account_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 4. Uber trips metadata table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uber_trips_metadata (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_address      TEXT NOT NULL,
  destination_address TEXT NOT NULL,
  driver_name         TEXT,
  duration_seconds    INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. Transactions table (including PostGIS geom column)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  description       TEXT NOT NULL,
  amount            NUMERIC(15, 2) NOT NULL,
  date              TIMESTAMPTZ NOT NULL,
  category          transaction_category NOT NULL DEFAULT 'desconhecido',
  source            transaction_source NOT NULL DEFAULT 'manual',
  external_id       TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  uber_metadata_id  UUID REFERENCES uber_trips_metadata(id) ON DELETE SET NULL,
  geom              geography(POINT, 4326),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------------------------
-- Databases initialized by db:push have the financial columns but no geom.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS geom geography(POINT, 4326);

-- IF NOT EXISTS alone cannot prove compatibility with an existing database.
-- Refuse to adopt monetary/date columns that differ from the legacy contract.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='transactions' AND column_name='amount' AND data_type='numeric'
    AND numeric_precision=15 AND numeric_scale=2 AND is_nullable='NO')
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='accounts' AND column_name='balance' AND data_type='numeric'
    AND numeric_precision=15 AND numeric_scale=2 AND is_nullable='NO')
    OR NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
    AND table_name='transactions' AND column_name='date' AND data_type='timestamp with time zone'
    AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Incompatible legacy financial schema';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_account_id   ON transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date         ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_transactions_external_id  ON transactions (external_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category     ON transactions (category);
CREATE INDEX IF NOT EXISTS idx_transactions_geom         ON transactions USING GIST (geom);

-- Existing custom triggers must not change financial data during spatial adoption.
LOCK TABLE accounts, transactions, uber_trips_metadata IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE ef01_before ON COMMIT DROP AS
 SELECT 'transactions'::text AS entity, to_jsonb(t) - 'geom' AS record FROM transactions t
 UNION ALL SELECT 'accounts', to_jsonb(a) FROM accounts a
 UNION ALL SELECT 'metadata', to_jsonb(u) FROM uber_trips_metadata u;

-- ---------------------------------------------------------------------------
-- 7. Geolocation search function (KNN with PostGIS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION buscar_lancamentos_proximos(
  lat double precision,
  lng double precision,
  limite_metros double precision DEFAULT 1000
)
RETURNS TABLE (
  id               uuid,
  account_id       uuid,
  description      text,
  amount           numeric,
  date             timestamptz,
  category         transaction_category,
  source           transaction_source,
  latitude         double precision,
  longitude        double precision,
  distance_meters  double precision
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.account_id,
    t.description,
    t.amount,
    t.date,
    t.category,
    t.source,
    t.latitude,
    t.longitude,
    ST_Distance(
      t.geom,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) AS distance_meters
  FROM transactions t
  WHERE t.geom IS NOT NULL
    AND ST_DWithin(
      t.geom,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      limite_metros
    )
  ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  LIMIT 50;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 8. Trigger: auto-populate geom from latitude/longitude on INSERT/UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_geom_from_lat_lng()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  ELSE
    NEW.geom := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_update_geom ON transactions;

CREATE TRIGGER trg_update_geom
  BEFORE INSERT OR UPDATE OF latitude, longitude
  ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_geom_from_lat_lng();

-- Preserve and populate spatial data in databases adopted from db:push.
UPDATE transactions SET latitude = latitude
WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;

DO $$ BEGIN
 IF EXISTS (
  (SELECT * FROM ef01_before EXCEPT ALL
   (SELECT 'transactions'::text,to_jsonb(t)-'geom' FROM transactions t
    UNION ALL SELECT 'accounts',to_jsonb(a) FROM accounts a
    UNION ALL SELECT 'metadata',to_jsonb(u) FROM uber_trips_metadata u))
  UNION ALL
  ((SELECT 'transactions'::text,to_jsonb(t)-'geom' FROM transactions t
    UNION ALL SELECT 'accounts',to_jsonb(a) FROM accounts a
    UNION ALL SELECT 'metadata',to_jsonb(u) FROM uber_trips_metadata u)
   EXCEPT ALL SELECT * FROM ef01_before)
 ) THEN RAISE EXCEPTION 'EF02: Financial preservation failed during spatial adoption; all changes rolled back.';
 END IF;
END $$;
