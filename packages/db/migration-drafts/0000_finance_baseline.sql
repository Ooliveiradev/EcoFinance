CREATE TYPE "public"."account_type" AS ENUM('banco', 'carteira');--> statement-breakpoint
CREATE TYPE "public"."transaction_category" AS ENUM('comida', 'transporte', 'assinaturas', 'lazer', 'saude', 'educacao', 'moradia', 'salario', 'investimento', 'transferencia', 'desconhecido');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('notification', 'pluggy', 'ofx', 'manual', 'uber', 'csv', 'spreadsheet', 'document', 'email');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"opening_balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"opening_date" date,
	"archived_at" timestamp with time zone,
	"name" text NOT NULL,
	"type" "account_type" DEFAULT 'banco' NOT NULL,
	"balance" numeric(15, 2) DEFAULT '0' NOT NULL,
	"pluggy_item_id" text,
	"pluggy_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" = 'BRL')
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preferences_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "preferences_owner_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid DEFAULT NULL NOT NULL,
	"kind" text DEFAULT 'unclassified' NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"purchase_date" date DEFAULT NULL NOT NULL,
	"competence_month" date DEFAULT NULL NOT NULL,
	"due_date" date,
	"paid_date" date,
	"review_required" boolean DEFAULT true NOT NULL,
	"invoice_id" uuid,
	"installment_id" uuid,
	"recurrence_occurrence_id" uuid,
	"archived_at" timestamp with time zone,
	"description" text NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"category" "transaction_category" DEFAULT 'desconhecido' NOT NULL,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"latitude" double precision,
	"longitude" double precision,
	"uber_metadata_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_owner_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "transactions_external_identity_unique" UNIQUE("owner_id","account_id","source","external_id"),
	CONSTRAINT "transactions_kind_check" CHECK ("transactions"."kind" IN ('income','expense','transfer','refund','adjustment','unclassified')),
	CONSTRAINT "transactions_status_check" CHECK ("transactions"."status" IN ('planned','recorded','settled','cancelled')),
	CONSTRAINT "transactions_currency_check" CHECK ("transactions"."currency" = 'BRL'),
	CONSTRAINT "transactions_month_check" CHECK (extract(day from "transactions"."competence_month") = 1),
	CONSTRAINT "transactions_amount_kind_check" CHECK (("transactions"."kind" = 'unclassified' AND "transactions"."review_required") OR ("transactions"."kind" <> 'unclassified' AND "transactions"."amount" <> 0 AND ("transactions"."kind" <> 'expense' OR "transactions"."amount" < 0) AND ("transactions"."kind" NOT IN ('income','refund') OR "transactions"."amount" > 0))),
	CONSTRAINT "transactions_settlement_check" CHECK ("transactions"."status" <> 'settled' OR "transactions"."paid_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "uber_trips_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid DEFAULT nullif(current_setting('ecofinance.owner_id', true), '')::uuid NOT NULL,
	"origin_address" text NOT NULL,
	"destination_address" text NOT NULL,
	"driver_name" text,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uber_metadata_owner_id_unique" UNIQUE("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_budget_owner_fk" FOREIGN KEY ("owner_id","budget_id") REFERENCES "public"."budgets"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_account_owner_fk" FOREIGN KEY ("owner_id","payment_account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_migration_audits" ADD CONSTRAINT "financial_migration_audits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_card_owner_fk" FOREIGN KEY ("owner_id","card_id") REFERENCES "public"."cards"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_batch_owner_fk" FOREIGN KEY ("owner_id","batch_id") REFERENCES "public"."import_batches"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_invoice_owner_fk" FOREIGN KEY ("owner_id","invoice_id") REFERENCES "public"."invoices"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_items" ADD CONSTRAINT "import_items_transaction_owner_fk" FOREIGN KEY ("owner_id","transaction_id") REFERENCES "public"."transactions"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_groups" ADD CONSTRAINT "installment_groups_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_groups" ADD CONSTRAINT "installment_groups_card_owner_fk" FOREIGN KEY ("owner_id","card_id") REFERENCES "public"."cards"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_group_owner_fk" FOREIGN KEY ("owner_id","group_id") REFERENCES "public"."installment_groups"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_invoice_owner_fk" FOREIGN KEY ("owner_id","invoice_id") REFERENCES "public"."invoices"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_card_owner_fk" FOREIGN KEY ("owner_id","card_id") REFERENCES "public"."cards"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_occurrences" ADD CONSTRAINT "recurrence_occurrences_rule_owner_fk" FOREIGN KEY ("owner_id","rule_id") REFERENCES "public"."recurrence_rules"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurrence_rules" ADD CONSTRAINT "recurrence_rules_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_owner_fk" FOREIGN KEY ("owner_id","account_id") REFERENCES "public"."accounts"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_owner_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."categories"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_uber_owner_fk" FOREIGN KEY ("owner_id","uber_metadata_id") REFERENCES "public"."uber_trips_metadata"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_owner_fk" FOREIGN KEY ("owner_id","invoice_id") REFERENCES "public"."invoices"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installment_owner_fk" FOREIGN KEY ("owner_id","installment_id") REFERENCES "public"."installments"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_occurrence_owner_fk" FOREIGN KEY ("owner_id","recurrence_occurrence_id") REFERENCES "public"."recurrence_occurrences"("owner_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uber_trips_metadata" ADD CONSTRAINT "uber_trips_metadata_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_owner_idx" ON "accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "transactions_owner_date_idx" ON "transactions" USING btree ("owner_id","date");--> statement-breakpoint
CREATE INDEX "transactions_owner_month_idx" ON "transactions" USING btree ("owner_id","competence_month");--> statement-breakpoint
CREATE INDEX "transactions_owner_account_idx" ON "transactions" USING btree ("owner_id","account_id","competence_month");--> statement-breakpoint
CREATE INDEX "transactions_owner_category_idx" ON "transactions" USING btree ("owner_id","category_id","competence_month");