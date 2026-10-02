import './src/env';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required for drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  // Generated SQL is a draft. Only reviewed, numbered files in migrations/ run.
  out: './migration-drafts',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
