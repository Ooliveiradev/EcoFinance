-- Additive authentication. Existing owners keep their IDs; an operator claims
-- a legacy owner explicitly. NULL email means no login has been provisioned.
ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN image text;
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX users_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_normalized CHECK(email IS NULL OR (email=lower(trim(email)) AND length(email) BETWEEN 3 AND 254));

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  ip_address text, user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE TABLE auth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL, provider_id text NOT NULL,
  password text, access_token text, refresh_token text, id_token text, scope text,
  access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_accounts_provider_unique UNIQUE(provider_id,account_id)
);
CREATE INDEX auth_accounts_user_idx ON auth_accounts(user_id);
CREATE TABLE auth_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE TABLE auth_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE,
  count integer NOT NULL, last_request bigint NOT NULL
);
