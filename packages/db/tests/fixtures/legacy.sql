-- Independent fixture for the financial schema previously installed by db:push.
CREATE TYPE account_type AS ENUM ('banco', 'carteira');
CREATE TYPE transaction_category AS ENUM ('comida','transporte','assinaturas','lazer','saude','educacao','moradia','salario','investimento','transferencia','desconhecido');
CREATE TYPE transaction_source AS ENUM ('notification','pluggy','ofx','manual','uber');
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  type account_type NOT NULL DEFAULT 'banco', balance numeric(15,2) NOT NULL DEFAULT 0,
  pluggy_item_id text, pluggy_account_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE uber_trips_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origin_address text NOT NULL,
  destination_address text NOT NULL, driver_name text, duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  description text NOT NULL, amount numeric(15,2) NOT NULL, date timestamptz NOT NULL,
  category transaction_category NOT NULL DEFAULT 'desconhecido',
  source transaction_source NOT NULL DEFAULT 'manual', external_id text,
  latitude double precision, longitude double precision,
  uber_metadata_id uuid REFERENCES uber_trips_metadata(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO accounts (id,name,balance) VALUES ('00000000-0000-4000-8000-000000000001','Conta sintética','1000.00');
INSERT INTO transactions (id,account_id,description,amount,date,category,source,external_id,latitude,longitude) VALUES
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','Compra sintética','-42.90','2026-09-30T15:00:00Z','comida','ofx','fixture-1',-23.55,-46.63),
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Estorno sintético','10.00','2026-10-01T15:00:00Z','comida','manual',NULL,NULL,NULL);
