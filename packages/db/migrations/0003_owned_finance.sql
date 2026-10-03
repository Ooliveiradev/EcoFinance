-- EF-02: expansion, explicit attribution, backfill, validation; no legacy field is removed.
LOCK TABLE accounts, transactions, uber_trips_metadata IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE owner_text text := nullif(current_setting('ecofinance.legacy_owner_id', true), '');
        owner_name text := nullif(trim(current_setting('ecofinance.legacy_owner_name', true)), '');
        zone text := nullif(current_setting('ecofinance.legacy_timezone', true), '');
BEGIN
  IF EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM transactions) OR EXISTS(SELECT 1 FROM uber_trips_metadata) THEN
    IF owner_text IS NULL OR owner_name IS NULL OR zone IS NULL THEN
      RAISE EXCEPTION 'EF02: Legacy data requires --legacy-owner, --legacy-owner-name and --legacy-timezone.';
    END IF;
  END IF;
  IF owner_text IS NOT NULL THEN
    IF owner_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR owner_name IS NULL OR length(owner_name) > 120 THEN
      RAISE EXCEPTION 'EF02: Invalid explicit owner.';
    END IF;
    IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name = zone) THEN
      RAISE EXCEPTION 'EF02: Invalid explicit IANA timezone.';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM transactions WHERE external_id IS NOT NULL GROUP BY account_id, source, external_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'EF02: Duplicate legacy external identities. Review duplicates before retrying; no rows were removed.';
  END IF;
END $$;

CREATE TEMP TABLE ef02_transactions_before ON COMMIT DROP AS
  SELECT id, account_id, description, amount, date, category, source, external_id, latitude, longitude, uber_metadata_id, created_at, updated_at FROM transactions;
CREATE TEMP TABLE ef02_accounts_before ON COMMIT DROP AS
  SELECT id, name, type, balance, pluggy_item_id, pluggy_account_id, created_at, updated_at FROM accounts;
CREATE TEMP TABLE ef02_uber_before ON COMMIT DROP AS
  SELECT id, origin_address, destination_address, driver_name, duration_seconds, created_at FROM uber_trips_metadata;

-- Snapshot totals remain decimal strings; original records are compared with EXCEPT ALL below.
CREATE FUNCTION pg_temp.ef02_snapshot() RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_build_object(
 'accounts', (SELECT count(*) FROM accounts), 'account_balance', (SELECT coalesce(sum(balance),0)::text FROM accounts),
 'metadata', (SELECT count(*) FROM uber_trips_metadata), 'entries', (SELECT count(*) FROM transactions),
 'total', (SELECT coalesce(sum(amount),0)::text FROM transactions),
 'by_account_source', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY account_id,source),'[]'::jsonb) FROM
   (SELECT account_id,source,count(*) AS count,sum(amount)::text AS total FROM transactions GROUP BY account_id,source) t));
$fn$;
CREATE TEMP TABLE ef02_totals_before ON COMMIT DROP AS SELECT pg_temp.ef02_snapshot() AS snapshot;

ALTER TABLE accounts ADD COLUMN owner_id uuid,
 ADD COLUMN currency text NOT NULL DEFAULT 'BRL', ADD COLUMN opening_balance numeric(15,2) NOT NULL DEFAULT 0,
 ADD COLUMN opening_date date, ADD COLUMN archived_at timestamptz;
ALTER TABLE uber_trips_metadata ADD COLUMN owner_id uuid;
ALTER TABLE transactions ADD COLUMN owner_id uuid, ADD COLUMN category_id uuid,
 ADD COLUMN kind text NOT NULL DEFAULT 'unclassified', ADD COLUMN status text NOT NULL DEFAULT 'recorded',
 ADD COLUMN currency text NOT NULL DEFAULT 'BRL', ADD COLUMN purchase_date date, ADD COLUMN competence_month date,
 ADD COLUMN due_date date, ADD COLUMN paid_date date, ADD COLUMN review_required boolean NOT NULL DEFAULT true,
 ADD COLUMN invoice_id uuid, ADD COLUMN installment_id uuid, ADD COLUMN recurrence_occurrence_id uuid, ADD COLUMN archived_at timestamptz;


CREATE TABLE "budget_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"budget_limit" numeric(15, 2) NOT NULL,
	CONSTRAINT "budget_categories_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "budget_categories_unique" UNIQUE("owner_id","budget_id","category_id"),
	CONSTRAINT "budget_categories_limit_check" CHECK ("budget_categories"."budget_limit" >= 0)
);

CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"competence_month" date NOT NULL,
	"budget_limit" numeric(15, 2) NOT NULL,
	"expected_income" numeric(15, 2) DEFAULT '0' NOT NULL,
	"reserve" numeric(15, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "budgets_owner_month_unique" UNIQUE("owner_id","competence_month"),
	CONSTRAINT "budgets_month_check" CHECK (extract(day from "budgets"."competence_month") = 1),
	CONSTRAINT "budgets_values_check" CHECK ("budgets"."budget_limit" >= 0 AND "budgets"."expected_income" >= 0 AND "budgets"."reserve" >= 0),
	CONSTRAINT "budgets_currency_check" CHECK ("budgets"."currency" = 'BRL')
);

CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"payment_account_id" uuid NOT NULL,
	"closing_day" integer NOT NULL,
	"due_day" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "cards_days_check" CHECK ("cards"."closing_day" BETWEEN 1 AND 31 AND "cards"."due_day" BETWEEN 1 AND 31),
	CONSTRAINT "cards_currency_check" CHECK ("cards"."currency" = 'BRL')
);

CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"icon" text DEFAULT 'tag' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"legacy_key" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "categories_owner_legacy_unique" UNIQUE("owner_id","legacy_key"),
	CONSTRAINT "categories_name_check" CHECK (length(trim("categories"."name")) BETWEEN 1 AND 120),
	CONSTRAINT "categories_color_check" CHECK ("categories"."color" ~ '^#[0-9a-fA-F]{6}$')
);

CREATE TABLE "financial_migration_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"version" text NOT NULL,
	"timezone" text NOT NULL,
	"before_snapshot" jsonb NOT NULL,
	"after_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_migration_audits_version_unique" UNIQUE("version")
);

CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"account_id" uuid,
	"card_id" uuid,
	"source" text NOT NULL,
	"state" text DEFAULT 'received' NOT NULL,
	"idempotency_key" text NOT NULL,
	"file_hash" text,
	"storage_key" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "import_batches_idempotency_unique" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "import_batches_state_check" CHECK ("import_batches"."state" IN ('received','processing','review','confirmed','failed','cancelled','reverted'))
);

CREATE TABLE "import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"invoice_id" uuid,
	"transaction_id" uuid,
	"amount" numeric(15, 2),
	"currency" text,
	"description" text,
	"kind" text,
	"purchase_date" date,
	"competence_month" date,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_items_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "import_items_batch_position_unique" UNIQUE("owner_id","batch_id","position"),
	CONSTRAINT "import_items_position_check" CHECK ("import_items"."position" > 0),
	CONSTRAINT "import_items_state_check" CHECK ("import_items"."state" IN ('pending','valid','invalid','excluded','committed')),
	CONSTRAINT "import_items_currency_check" CHECK ("import_items"."currency" IS NULL OR "import_items"."currency" = 'BRL'),
	CONSTRAINT "import_items_month_check" CHECK ("import_items"."competence_month" IS NULL OR extract(day from "import_items"."competence_month") = 1)
);

CREATE TABLE "installment_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"description" text NOT NULL,
	"total_amount" numeric(15, 2) NOT NULL,
	"installment_count" integer NOT NULL,
	"purchase_date" date NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_groups_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "installment_groups_values_check" CHECK ("installment_groups"."installment_count" BETWEEN 1 AND 600 AND "installment_groups"."total_amount" > 0),
	CONSTRAINT "installment_groups_currency_check" CHECK ("installment_groups"."currency" = 'BRL')
);

CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"invoice_id" uuid,
	"installment_number" integer NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"competence_month" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "installments_group_number_unique" UNIQUE("owner_id","group_id","installment_number"),
	CONSTRAINT "installments_values_check" CHECK ("installments"."installment_number" BETWEEN 1 AND 600 AND "installments"."amount" > 0),
	CONSTRAINT "installments_month_check" CHECK (extract(day from "installments"."competence_month") = 1)
);

CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"competence_month" date NOT NULL,
	"closing_date" date NOT NULL,
	"due_date" date NOT NULL,
	"stated_total" numeric(15, 2),
	"currency" text DEFAULT 'BRL' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "invoices_card_month_unique" UNIQUE("owner_id","card_id","competence_month"),
	CONSTRAINT "invoices_month_check" CHECK (extract(day from "invoices"."competence_month") = 1),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" IN ('open','closed','partial','paid')),
	CONSTRAINT "invoices_currency_check" CHECK ("invoices"."currency" = 'BRL')
);

CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preferences_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "preferences_owner_unique" UNIQUE("owner_id")
);

CREATE TABLE "recurrence_occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"competence_month" date NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrence_occurrences_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "recurrence_occurrences_month_unique" UNIQUE("owner_id","rule_id","competence_month"),
	CONSTRAINT "recurrence_occurrences_month_check" CHECK (extract(day from "recurrence_occurrences"."competence_month") = 1),
	CONSTRAINT "recurrence_occurrences_status_check" CHECK ("recurrence_occurrences"."status" IN ('pending','paid','postponed','cancelled'))
);

CREATE TABLE "recurrence_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"due_day" integer NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurrence_rules_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "recurrence_rules_day_check" CHECK ("recurrence_rules"."due_day" BETWEEN 1 AND 31),
	CONSTRAINT "recurrence_rules_dates_check" CHECK ("recurrence_rules"."end_date" IS NULL OR "recurrence_rules"."end_date" >= "recurrence_rules"."start_date"),
	CONSTRAINT "recurrence_rules_currency_check" CHECK ("recurrence_rules"."currency" = 'BRL')
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


DO $$
DECLARE legacy_owner uuid := nullif(current_setting('ecofinance.legacy_owner_id', true),'')::uuid;
        zone text := nullif(current_setting('ecofinance.legacy_timezone', true),'');
BEGIN
 IF legacy_owner IS NOT NULL THEN
  INSERT INTO users(id,display_name) VALUES (legacy_owner,current_setting('ecofinance.legacy_owner_name'));
  INSERT INTO categories(owner_id,name,legacy_key,sort_order)
   SELECT legacy_owner, label, label, position::int - 1 FROM unnest(enum_range(NULL::transaction_category)::text[]) WITH ORDINALITY AS labels(label,position);
  UPDATE accounts SET owner_id=legacy_owner;
  UPDATE uber_trips_metadata SET owner_id=legacy_owner;
  UPDATE transactions SET owner_id=legacy_owner, purchase_date=(date AT TIME ZONE zone)::date,
    competence_month=date_trunc('month',date AT TIME ZONE zone)::date;
  UPDATE transactions t SET category_id=c.id FROM categories c WHERE c.owner_id=t.owner_id AND c.legacy_key=t.category::text;
 END IF;
END $$;

ALTER TABLE accounts ALTER COLUMN owner_id SET NOT NULL,
 ALTER COLUMN owner_id SET DEFAULT nullif(current_setting('ecofinance.owner_id',true),'')::uuid;
ALTER TABLE uber_trips_metadata ALTER COLUMN owner_id SET NOT NULL,
 ALTER COLUMN owner_id SET DEFAULT nullif(current_setting('ecofinance.owner_id',true),'')::uuid;
ALTER TABLE transactions ALTER COLUMN owner_id SET NOT NULL,
 ALTER COLUMN owner_id SET DEFAULT nullif(current_setting('ecofinance.owner_id',true),'')::uuid,
 ALTER COLUMN category_id SET NOT NULL, ALTER COLUMN category_id SET DEFAULT NULL,
 ALTER COLUMN purchase_date SET NOT NULL, ALTER COLUMN purchase_date SET DEFAULT NULL,
 ALTER COLUMN competence_month SET NOT NULL, ALTER COLUMN competence_month SET DEFAULT NULL;

-- Replace both db:push and historical SQL names of destructive legacy foreign keys.
DO $$ DECLARE entry record; BEGIN
 FOR entry IN SELECT conname FROM pg_constraint WHERE conrelid='transactions'::regclass AND contype='f'
 AND confrelid IN ('accounts'::regclass,'uber_trips_metadata'::regclass) LOOP
  EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I',entry.conname);
 END LOOP;
END $$;


ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_unique" UNIQUE("owner_id","id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" = 'BRL');

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_unique" UNIQUE("owner_id","id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_external_identity_unique" UNIQUE("owner_id","account_id","source","external_id");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_kind_check" CHECK ("transactions"."kind" IN ('income','expense','transfer','refund','adjustment','unclassified'));

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_status_check" CHECK ("transactions"."status" IN ('planned','recorded','settled','cancelled'));

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_check" CHECK ("transactions"."currency" = 'BRL');

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_month_check" CHECK (extract(day from "transactions"."competence_month") = 1);

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_kind_check" CHECK (("transactions"."kind" = 'unclassified' AND "transactions"."review_required") OR ("transactions"."kind" <> 'unclassified' AND "transactions"."amount" <> 0 AND ("transactions"."kind" <> 'expense' OR "transactions"."amount" < 0) AND ("transactions"."kind" NOT IN ('income','refund') OR "transactions"."amount" > 0)));

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_settlement_check" CHECK ("transactions"."status" <> 'settled' OR "transactions"."paid_date" IS NOT NULL);

ALTER TABLE "uber_trips_metadata" ADD CONSTRAINT "uber_metadata_owner_id_unique" UNIQUE("owner_id","id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_budget_owner_fk" FOREIGN KEY ("owner_id","budget_id") REFERENCES "public"."budgets"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "cards" ADD CONSTRAINT "cards_account_owner_fk" FOREIGN KEY ("owner_id","payment_account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "financial_migration_audits" ADD CONSTRAINT "financial_migration_audits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_card_owner_fk" FOREIGN KEY ("owner_id","card_id") REFERENCES "public"."cards"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_items" ADD CONSTRAINT "import_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_items" ADD CONSTRAINT "import_items_batch_owner_fk" FOREIGN KEY ("owner_id","batch_id") REFERENCES "public"."import_batches"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_items" ADD CONSTRAINT "import_items_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_items" ADD CONSTRAINT "import_items_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_items" ADD CONSTRAINT "import_items_invoice_owner_fk" FOREIGN KEY ("owner_id","invoice_id") REFERENCES "public"."invoices"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "import_items" ADD CONSTRAINT "import_items_transaction_owner_fk" FOREIGN KEY ("owner_id","transaction_id") REFERENCES "public"."transactions"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "installment_groups" ADD CONSTRAINT "installment_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "installment_groups" ADD CONSTRAINT "installment_groups_card_owner_fk" FOREIGN KEY ("owner_id","card_id") REFERENCES "public"."cards"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "installments" ADD CONSTRAINT "installments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "installments" ADD CONSTRAINT "installments_group_owner_fk" FOREIGN KEY ("owner_id","group_id") REFERENCES "public"."installment_groups"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "installments" ADD CONSTRAINT "installments_invoice_owner_fk" FOREIGN KEY ("owner_id","invoice_id") REFERENCES "public"."invoices"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_card_owner_fk" FOREIGN KEY ("owner_id","card_id") REFERENCES "public"."cards"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "preferences" ADD CONSTRAINT "preferences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_rule_owner_fk" FOREIGN KEY ("owner_id","rule_id") REFERENCES "public"."recurrence_rules"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_uber_owner_fk" FOREIGN KEY ("owner_id","uber_metadata_id") REFERENCES "public"."uber_trips_metadata"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_owner_fk" FOREIGN KEY ("owner_id","invoice_id") REFERENCES "public"."invoices"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_owner_fk" FOREIGN KEY ("owner_id","installment_id") REFERENCES "public"."installments"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_occurrence_owner_fk" FOREIGN KEY ("owner_id","recurrence_occurrence_id") REFERENCES "public"."recurrence_occurrences"("owner_id","id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "uber_trips_metadata" ADD CONSTRAINT "uber_trips_metadata_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;

CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_id");

CREATE INDEX "transactions_owner_date_idx" ON "transactions" USING btree ("owner_id","date");

CREATE INDEX "transactions_owner_month_idx" ON "transactions" USING btree ("owner_id","competence_month");

CREATE INDEX "transactions_owner_account_idx" ON "transactions" USING btree ("owner_id","account_id","competence_month");

CREATE INDEX "transactions_owner_category_idx" ON "transactions" USING btree ("owner_id","category_id","competence_month");


DO $$
DECLARE before_totals jsonb := (SELECT snapshot FROM ef02_totals_before);
        after_totals jsonb := pg_temp.ef02_snapshot();
        legacy_owner uuid := nullif(current_setting('ecofinance.legacy_owner_id',true),'')::uuid;
BEGIN
 IF before_totals IS DISTINCT FROM after_totals
 OR EXISTS((SELECT * FROM ef02_transactions_before EXCEPT ALL SELECT id,account_id,description,amount,date,category,source,external_id,latitude,longitude,uber_metadata_id,created_at,updated_at FROM transactions)
   UNION ALL (SELECT id,account_id,description,amount,date,category,source,external_id,latitude,longitude,uber_metadata_id,created_at,updated_at FROM transactions EXCEPT ALL SELECT * FROM ef02_transactions_before))
 OR EXISTS((SELECT * FROM ef02_accounts_before EXCEPT ALL SELECT id,name,type,balance,pluggy_item_id,pluggy_account_id,created_at,updated_at FROM accounts)
   UNION ALL (SELECT id,name,type,balance,pluggy_item_id,pluggy_account_id,created_at,updated_at FROM accounts EXCEPT ALL SELECT * FROM ef02_accounts_before))
 OR EXISTS((SELECT * FROM ef02_uber_before EXCEPT ALL SELECT id,origin_address,destination_address,driver_name,duration_seconds,created_at FROM uber_trips_metadata)
   UNION ALL (SELECT id,origin_address,destination_address,driver_name,duration_seconds,created_at FROM uber_trips_metadata EXCEPT ALL SELECT * FROM ef02_uber_before)) THEN
  RAISE EXCEPTION 'EF02: Financial preservation validation failed; all changes rolled back.';
 END IF;
 IF legacy_owner IS NOT NULL THEN
  INSERT INTO financial_migration_audits(owner_id,version,timezone,before_snapshot,after_snapshot)
   VALUES(legacy_owner,'0003',current_setting('ecofinance.legacy_timezone'),before_totals,after_totals);
 END IF;
END $$;

-- Retire the predecessor's global identity; the owned/account/source unique constraint replaces it.
DROP INDEX IF EXISTS public.idx_transactions_external_id;
CREATE INDEX idx_transactions_external_id ON transactions(external_id);

-- Existing sources are untouched; new values become usable only after this transaction commits.
ALTER TYPE transaction_source ADD VALUE IF NOT EXISTS 'csv';
ALTER TYPE transaction_source ADD VALUE IF NOT EXISTS 'spreadsheet';
ALTER TYPE transaction_source ADD VALUE IF NOT EXISTS 'document';
ALTER TYPE transaction_source ADD VALUE IF NOT EXISTS 'email';
