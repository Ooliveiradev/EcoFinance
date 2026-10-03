import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { migrate, readMigrations } from '../src/migrations';
import '../src/env';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  'legacy-owner': { type: 'string' }, 'legacy-owner-name': { type: 'string' },
  'legacy-timezone': { type: 'string' },
} });
const supplied = Object.values(values).filter(Boolean).length;
if (supplied !== 0 && supplied !== 3) throw new Error('Provide --legacy-owner, --legacy-owner-name and --legacy-timezone together.');
const legacyOwner = supplied ? { id: values['legacy-owner']!, name: values['legacy-owner-name']!, timezone: values['legacy-timezone']! } : undefined;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
try {
  const migrations = await readMigrations(fileURLToPath(new URL('../migrations', import.meta.url)));
  const applied = await migrate(sql, migrations, legacyOwner);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} catch (error) {
  // Never print connection strings, SQL payloads, or server error details.
  console.error(error instanceof Error && (error.message.startsWith('Migration history mismatch:') || error.message.startsWith('EF02:'))
    ? error.message : 'Migration failed. No changes committed; check database availability, permissions and schema.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
