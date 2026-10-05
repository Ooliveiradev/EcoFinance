import { pgTable, uuid, text, timestamp, integer, bigint, index, unique } from 'drizzle-orm/pg-core';
import { users } from './schema';

const dates = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'), userAgent: text('user_agent'), ...dates(),
}, table => [index('auth_sessions_user_idx').on(table.userId)]);
export const authAccounts = pgTable('auth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(), providerId: text('provider_id').notNull(),
  password: text('password'), accessToken: text('access_token'), refreshToken: text('refresh_token'),
  idToken: text('id_token'), scope: text('scope'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }), ...dates(),
}, table => [index('auth_accounts_user_idx').on(table.userId), unique('auth_accounts_provider_unique').on(table.providerId, table.accountId)]);
export const authVerifications = pgTable('auth_verifications', {
  id: uuid('id').primaryKey().defaultRandom(), identifier: text('identifier').notNull(),
  value: text('value').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), ...dates(),
}, table => [index('auth_verifications_identifier_idx').on(table.identifier)]);
export const authRateLimits = pgTable('auth_rate_limits', {
  id: uuid('id').primaryKey().defaultRandom(), key: text('key').notNull().unique(),
  count: integer('count').notNull(), lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
export const authSchema = { user: users, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit: authRateLimits };
