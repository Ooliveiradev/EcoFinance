import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, numeric, timestamp, pgEnum, doublePrecision, integer, index, unique, foreignKey, date, boolean, jsonb, check, type AnyPgColumn } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Compatibility writers can only run inside an explicitly owned transaction.
// Without that context, the database's NOT NULL constraint rejects the insert.
const owner = () => uuid('owner_id').notNull().default(sql`nullif(current_setting('ecofinance.owner_id', true), '')::uuid`).references(() => users.id, { onDelete: 'restrict' });
const audit = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
const pair = (name: string, table: { ownerId: AnyPgColumn; id: AnyPgColumn }) => unique(name).on(table.ownerId, table.id);
const ownedFK = (name: string, ownerId: AnyPgColumn, id: AnyPgColumn, parent: { ownerId: AnyPgColumn; id: AnyPgColumn }) => foreignKey({ name, columns: [ownerId, id], foreignColumns: [parent.ownerId, parent.id] }).onDelete('restrict');
const money = (name: string) => numeric(name, { precision: 15, scale: 2 });

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), name: text('name').notNull(),
  color: text('color').notNull().default('#64748b'), icon: text('icon').notNull().default('tag'),
  sortOrder: integer('sort_order').notNull().default(0), legacyKey: text('legacy_key'),
  archivedAt: timestamp('archived_at', { withTimezone: true }), ...audit(),
}, table => [pair('categories_owner_id_unique', table), unique('categories_owner_legacy_unique').on(table.ownerId, table.legacyKey), check('categories_name_check', sql`length(trim(${table.name})) BETWEEN 1 AND 120`), check('categories_color_check', sql`${table.color} ~ '^#[0-9a-fA-F]{6}$'`)]);

// =============================================================================
// Enums
// =============================================================================

export const accountTypeEnum = pgEnum('account_type', ['banco', 'carteira']);

export const transactionCategoryEnum = pgEnum('transaction_category', [
  'comida', 'transporte', 'assinaturas', 'lazer', 'saude',
  'educacao', 'moradia', 'salario', 'investimento', 'transferencia', 'desconhecido',
]);

export const transactionSourceEnum = pgEnum('transaction_source', [
  'notification', 'pluggy', 'ofx', 'manual', 'uber', 'csv', 'spreadsheet', 'document', 'email',
]);

// =============================================================================
// Tables
// =============================================================================

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  currency: text('currency').notNull().default('BRL'),
  openingBalance: money('opening_balance').notNull().default('0'),
  openingDate: date('opening_date', { mode: 'string' }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  name: text('name').notNull(),
  type: accountTypeEnum('type').notNull().default('banco'),
  balance: numeric('balance', { precision: 15, scale: 2 }).notNull().default('0'),
  pluggyItemId: text('pluggy_item_id'),
  pluggyAccountId: text('pluggy_account_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [pair('accounts_owner_id_unique', table), index('accounts_owner_idx').on(table.ownerId), check('accounts_currency_check', sql`${table.currency} = 'BRL'`)]);

export const uberTripsMetadata = pgTable('uber_trips_metadata', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  originAddress: text('origin_address').notNull(),
  destinationAddress: text('destination_address').notNull(),
  driverName: text('driver_name'),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [pair('uber_metadata_owner_id_unique', table)]);

/**
 * Transactions table.
 *
 * NOTE: The `geom` column (PostGIS geography(POINT, 4326)) is NOT defined here
 * because Drizzle ORM does not natively support PostGIS geography types.
 * It is managed via raw SQL in the migration file (0001_init.sql) and is
 * auto-populated by a database trigger from the latitude/longitude columns.
 */
export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: owner(),
  accountId: uuid('account_id').notNull(),
  categoryId: uuid('category_id').notNull().default(sql`NULL`),
  kind: text('kind').notNull().default('unclassified'),
  status: text('status').notNull().default('recorded'),
  currency: text('currency').notNull().default('BRL'),
  purchaseDate: date('purchase_date', { mode: 'string' }).notNull().default(sql`NULL`),
  competenceMonth: date('competence_month', { mode: 'string' }).notNull().default(sql`NULL`),
  dueDate: date('due_date', { mode: 'string' }),
  paidDate: date('paid_date', { mode: 'string' }),
  reviewRequired: boolean('review_required').notNull().default(true),
  invoiceId: uuid('invoice_id'),
  installmentId: uuid('installment_id'),
  recurrenceOccurrenceId: uuid('recurrence_occurrence_id'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  category: transactionCategoryEnum('category').notNull().default('desconhecido'),
  source: transactionSourceEnum('source').notNull().default('manual'),
  externalId: text('external_id'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  uberMetadataId: uuid('uber_metadata_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [
  pair('transactions_owner_id_unique', table),
  unique('transactions_external_identity_unique').on(table.ownerId, table.accountId, table.source, table.externalId),
  ownedFK('transactions_account_owner_fk', table.ownerId, table.accountId, accounts),
  ownedFK('transactions_category_owner_fk', table.ownerId, table.categoryId, categories),
  ownedFK('transactions_uber_owner_fk', table.ownerId, table.uberMetadataId, uberTripsMetadata),
  ownedFK('transactions_invoice_owner_fk', table.ownerId, table.invoiceId, invoices),
  ownedFK('transactions_installment_owner_fk', table.ownerId, table.installmentId, installments),
  ownedFK('transactions_occurrence_owner_fk', table.ownerId, table.recurrenceOccurrenceId, recurrenceOccurrences),
  index('transactions_owner_date_idx').on(table.ownerId, table.date),
  index('transactions_owner_month_idx').on(table.ownerId, table.competenceMonth),
  index('transactions_owner_account_idx').on(table.ownerId, table.accountId, table.competenceMonth),
  index('transactions_owner_category_idx').on(table.ownerId, table.categoryId, table.competenceMonth),
  check('transactions_kind_check', sql`${table.kind} IN ('income','expense','transfer','refund','adjustment','unclassified')`),
  check('transactions_status_check', sql`${table.status} IN ('planned','recorded','settled','cancelled')`),
  check('transactions_currency_check', sql`${table.currency} = 'BRL'`),
  check('transactions_month_check', sql`extract(day from ${table.competenceMonth}) = 1`),
  check('transactions_amount_kind_check', sql`(${table.kind} = 'unclassified' AND ${table.reviewRequired}) OR (${table.kind} <> 'unclassified' AND ${table.amount} <> 0 AND (${table.kind} <> 'expense' OR ${table.amount} < 0) AND (${table.kind} NOT IN ('income','refund') OR ${table.amount} > 0))`),
  check('transactions_settlement_check', sql`${table.status} <> 'settled' OR ${table.paidDate} IS NOT NULL`),
]);

export const recurrenceRules = pgTable('recurrence_rules', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), accountId: uuid('account_id').notNull(), categoryId: uuid('category_id').notNull(),
  description: text('description').notNull(), amount: money('amount').notNull(), currency: text('currency').notNull().default('BRL'),
  startDate: date('start_date', { mode: 'string' }).notNull(), endDate: date('end_date', { mode: 'string' }), dueDay: integer('due_day').notNull(),
  estimated: boolean('estimated').notNull().default(false), archivedAt: timestamp('archived_at', { withTimezone: true }), ...audit(),
}, table => [pair('recurrence_rules_owner_id_unique', table), ownedFK('recurrence_rules_account_owner_fk', table.ownerId, table.accountId, accounts), ownedFK('recurrence_rules_category_owner_fk', table.ownerId, table.categoryId, categories), check('recurrence_rules_day_check', sql`${table.dueDay} BETWEEN 1 AND 31`), check('recurrence_rules_dates_check', sql`${table.endDate} IS NULL OR ${table.endDate} >= ${table.startDate}`), check('recurrence_rules_currency_check', sql`${table.currency} = 'BRL'`)]);

export const recurrenceOccurrences = pgTable('recurrence_occurrences', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), ruleId: uuid('rule_id').notNull(), competenceMonth: date('competence_month', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(), amount: money('amount').notNull(), status: text('status').notNull().default('pending'), ...audit(),
}, table => [pair('recurrence_occurrences_owner_id_unique', table), unique('recurrence_occurrences_month_unique').on(table.ownerId, table.ruleId, table.competenceMonth), ownedFK('recurrence_occurrences_rule_owner_fk', table.ownerId, table.ruleId, recurrenceRules), check('recurrence_occurrences_month_check', sql`extract(day from ${table.competenceMonth}) = 1`), check('recurrence_occurrences_status_check', sql`${table.status} IN ('pending','paid','postponed','cancelled')`)]);

export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), competenceMonth: date('competence_month', { mode: 'string' }).notNull(),
  limit: money('budget_limit').notNull(), expectedIncome: money('expected_income').notNull().default('0'), reserve: money('reserve').notNull().default('0'), currency: text('currency').notNull().default('BRL'), ...audit(),
}, table => [pair('budgets_owner_id_unique', table), unique('budgets_owner_month_unique').on(table.ownerId, table.competenceMonth), check('budgets_month_check', sql`extract(day from ${table.competenceMonth}) = 1`), check('budgets_values_check', sql`${table.limit} >= 0 AND ${table.expectedIncome} >= 0 AND ${table.reserve} >= 0`), check('budgets_currency_check', sql`${table.currency} = 'BRL'`)]);
export const budgetCategories = pgTable('budget_categories', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), budgetId: uuid('budget_id').notNull(), categoryId: uuid('category_id').notNull(), limit: money('budget_limit').notNull(),
}, table => [pair('budget_categories_owner_id_unique', table), unique('budget_categories_unique').on(table.ownerId, table.budgetId, table.categoryId), ownedFK('budget_categories_budget_owner_fk', table.ownerId, table.budgetId, budgets), ownedFK('budget_categories_category_owner_fk', table.ownerId, table.categoryId, categories), check('budget_categories_limit_check', sql`${table.limit} >= 0`)]);

export const cards = pgTable('cards', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), name: text('name').notNull(), paymentAccountId: uuid('payment_account_id').notNull(),
  closingDay: integer('closing_day').notNull(), dueDay: integer('due_day').notNull(), currency: text('currency').notNull().default('BRL'), archivedAt: timestamp('archived_at', { withTimezone: true }), ...audit(),
}, table => [pair('cards_owner_id_unique', table), ownedFK('cards_account_owner_fk', table.ownerId, table.paymentAccountId, accounts), check('cards_days_check', sql`${table.closingDay} BETWEEN 1 AND 31 AND ${table.dueDay} BETWEEN 1 AND 31`), check('cards_currency_check', sql`${table.currency} = 'BRL'`)]);
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), cardId: uuid('card_id').notNull(), competenceMonth: date('competence_month', { mode: 'string' }).notNull(),
  closingDate: date('closing_date', { mode: 'string' }).notNull(), dueDate: date('due_date', { mode: 'string' }).notNull(), statedTotal: money('stated_total'), currency: text('currency').notNull().default('BRL'), status: text('status').notNull().default('open'), ...audit(),
}, table => [pair('invoices_owner_id_unique', table), unique('invoices_card_month_unique').on(table.ownerId, table.cardId, table.competenceMonth), ownedFK('invoices_card_owner_fk', table.ownerId, table.cardId, cards), check('invoices_month_check', sql`extract(day from ${table.competenceMonth}) = 1`), check('invoices_status_check', sql`${table.status} IN ('open','closed','partial','paid')`), check('invoices_currency_check', sql`${table.currency} = 'BRL'`)]);
export const installmentGroups = pgTable('installment_groups', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), cardId: uuid('card_id').notNull(), description: text('description').notNull(), totalAmount: money('total_amount').notNull(),
  count: integer('installment_count').notNull(), purchaseDate: date('purchase_date', { mode: 'string' }).notNull(), currency: text('currency').notNull().default('BRL'), ...audit(),
}, table => [pair('installment_groups_owner_id_unique', table), ownedFK('installment_groups_card_owner_fk', table.ownerId, table.cardId, cards), check('installment_groups_values_check', sql`${table.count} BETWEEN 1 AND 600 AND ${table.totalAmount} > 0`), check('installment_groups_currency_check', sql`${table.currency} = 'BRL'`)]);
export const installments = pgTable('installments', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), groupId: uuid('group_id').notNull(), invoiceId: uuid('invoice_id'),
  number: integer('installment_number').notNull(), amount: money('amount').notNull(), competenceMonth: date('competence_month', { mode: 'string' }).notNull(), ...audit(),
}, table => [pair('installments_owner_id_unique', table), unique('installments_group_number_unique').on(table.ownerId, table.groupId, table.number), ownedFK('installments_group_owner_fk', table.ownerId, table.groupId, installmentGroups), ownedFK('installments_invoice_owner_fk', table.ownerId, table.invoiceId, invoices), check('installments_values_check', sql`${table.number} BETWEEN 1 AND 600 AND ${table.amount} > 0`), check('installments_month_check', sql`extract(day from ${table.competenceMonth}) = 1`)]);

export const importBatches = pgTable('import_batches', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), accountId: uuid('account_id'), cardId: uuid('card_id'),
  source: text('source').notNull(), state: text('state').notNull().default('received'), idempotencyKey: text('idempotency_key').notNull(), fileHash: text('file_hash'), storageKey: text('storage_key'), expiresAt: timestamp('expires_at', { withTimezone: true }), ...audit(),
}, table => [pair('import_batches_owner_id_unique', table), unique('import_batches_idempotency_unique').on(table.ownerId, table.idempotencyKey), ownedFK('import_batches_account_owner_fk', table.ownerId, table.accountId, accounts), ownedFK('import_batches_card_owner_fk', table.ownerId, table.cardId, cards), check('import_batches_state_check', sql`${table.state} IN ('received','processing','review','confirmed','failed','cancelled','reverted')`)]);
export const importItems = pgTable('import_items', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), batchId: uuid('batch_id').notNull(), position: integer('position').notNull(), accountId: uuid('account_id'), categoryId: uuid('category_id'), invoiceId: uuid('invoice_id'), transactionId: uuid('transaction_id'),
  amount: money('amount'), currency: text('currency'), description: text('description'), kind: text('kind'), purchaseDate: date('purchase_date', { mode: 'string' }), competenceMonth: date('competence_month', { mode: 'string' }),
  provenance: jsonb('provenance').$type<{ page?: number; row?: number; cell?: string; excerpt?: string }>().notNull().default({}), warnings: jsonb('warnings').$type<string[]>().notNull().default([]), state: text('state').notNull().default('pending'), ...audit(),
}, table => [pair('import_items_owner_id_unique', table), unique('import_items_batch_position_unique').on(table.ownerId, table.batchId, table.position), ownedFK('import_items_batch_owner_fk', table.ownerId, table.batchId, importBatches), ownedFK('import_items_account_owner_fk', table.ownerId, table.accountId, accounts), ownedFK('import_items_category_owner_fk', table.ownerId, table.categoryId, categories), ownedFK('import_items_invoice_owner_fk', table.ownerId, table.invoiceId, invoices), ownedFK('import_items_transaction_owner_fk', table.ownerId, table.transactionId, transactions), check('import_items_position_check', sql`${table.position} > 0`), check('import_items_state_check', sql`${table.state} IN ('pending','valid','invalid','excluded','committed')`), check('import_items_currency_check', sql`${table.currency} IS NULL OR ${table.currency} = 'BRL'`), check('import_items_month_check', sql`${table.competenceMonth} IS NULL OR extract(day from ${table.competenceMonth}) = 1`)]);

export const preferences = pgTable('preferences', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}), ...audit(),
}, table => [pair('preferences_owner_id_unique', table), unique('preferences_owner_unique').on(table.ownerId)]);
export const financialMigrationAudits = pgTable('financial_migration_audits', {
  id: uuid('id').primaryKey().defaultRandom(), ownerId: owner(), version: text('version').notNull(), timezone: text('timezone').notNull(),
  beforeSnapshot: jsonb('before_snapshot').notNull(), afterSnapshot: jsonb('after_snapshot').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [unique('financial_migration_audits_version_unique').on(table.version)]);
