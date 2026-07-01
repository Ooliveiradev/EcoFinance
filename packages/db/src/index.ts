import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL environment variable is not set.\n' +
    'Copy .env.example to .env and fill in your database connection string.\n' +
    'For local development, start the database with: docker compose up -d',
  );
}

const client = postgres(connectionString, {
  prepare: false,
  // Limit connections in development to avoid exhausting the pool
  max: process.env.NODE_ENV === 'production' ? 10 : 3,
});

export const db = drizzle(client, { schema });

export * from './schema';

// Re-export drizzle-orm query helpers so consumers always use the same
// drizzle-orm instance (avoids SQL<unknown> type mismatches in the monorepo).
export {
  eq,
  ne,
  and,
  or,
  not,
  gt,
  gte,
  lt,
  lte,
  isNull,
  isNotNull,
  ilike,
  like,
  inArray,
  notInArray,
  sql,
  asc,
  desc,
} from 'drizzle-orm';

export type Database = typeof db;

