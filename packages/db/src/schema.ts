import { pgTable, uuid, text, numeric, timestamp, pgEnum, doublePrecision, integer, index } from 'drizzle-orm/pg-core';

// =============================================================================
// Enums
// =============================================================================

export const accountTypeEnum = pgEnum('account_type', ['banco', 'carteira']);

export const transactionCategoryEnum = pgEnum('transaction_category', [
  'comida', 'transporte', 'assinaturas', 'lazer', 'saude',
  'educacao', 'moradia', 'salario', 'investimento', 'transferencia', 'desconhecido',
]);

export const transactionSourceEnum = pgEnum('transaction_source', [
  'notification', 'pluggy', 'ofx', 'manual', 'uber',
]);

// =============================================================================
// Tables
// =============================================================================

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: accountTypeEnum('type').notNull().default('banco'),
  balance: numeric('balance', { precision: 15, scale: 2 }).notNull().default('0'),
  pluggyItemId: text('pluggy_item_id'),
  pluggyAccountId: text('pluggy_account_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const uberTripsMetadata = pgTable('uber_trips_metadata', {
  id: uuid('id').primaryKey().defaultRandom(),
  originAddress: text('origin_address').notNull(),
  destinationAddress: text('destination_address').notNull(),
  driverName: text('driver_name'),
  durationSeconds: integer('duration_seconds'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  date: timestamp('date', { withTimezone: true }).notNull(),
  category: transactionCategoryEnum('category').notNull().default('desconhecido'),
  source: transactionSourceEnum('source').notNull().default('manual'),
  externalId: text('external_id'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  uberMetadataId: uuid('uber_metadata_id').references(() => uberTripsMetadata.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  accountIdIdx: index('idx_transactions_account_id').on(table.accountId),
  dateIdx: index('idx_transactions_date').on(table.date),
  externalIdIdx: index('idx_transactions_external_id').on(table.externalId),
  categoryIdx: index('idx_transactions_category').on(table.category),
}));
