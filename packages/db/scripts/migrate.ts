import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate, readMigrations } from '../src/migrations';

// Explicit environment only: CI must target a disposable test database.
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const migrations = await readMigrations(fileURLToPath(new URL('../migrations', import.meta.url)));
  const applied = await migrate(sql, migrations);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} catch {
  console.error('Migration failed. No changes committed; check database availability, permissions and schema.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
