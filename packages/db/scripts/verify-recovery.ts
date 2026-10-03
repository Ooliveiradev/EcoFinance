import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres, { type Sql } from 'postgres';
import { migrate, readMigrations } from '../src/migrations';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is required; only disposable databases are created.');
const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const databases: { name: string; sql: Sql }[] = [];
const temporary = await mkdtemp(join(tmpdir(), 'ecofinance-recovery-'));
const migrations = await readMigrations(fileURLToPath(new URL('../migrations', import.meta.url)));
const run = promisify(execFile);

async function database() {
  const name = `ecofinance_test_${randomBytes(8).toString('hex')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const connection = new URL(url!); connection.pathname = `/${name}`;
  const sql = postgres(connection.toString(), { max: 1, prepare: false, onnotice: () => {} });
  const entry = { name, sql }; databases.push(entry); return entry;
}
async function command(program: string, name: string, args: string[]) {
  const connection = new URL(url!);
  const executable = process.env.PG_BIN ? join(process.env.PG_BIN, program + (process.platform === 'win32' ? '.exe' : '')) : program;
  await run(executable, args, { windowsHide: true, env: { ...process.env,
    PGHOST: connection.hostname, PGPORT: connection.port || '5432', PGUSER: decodeURIComponent(connection.username),
    PGPASSWORD: decodeURIComponent(connection.password), PGDATABASE: name,
  } });
}
async function roundtrip(source: { name: string; sql: Sql }, label: string) {
  const restored = await database(); const path = join(temporary, `${label}.dump`);
  await command('pg_dump', source.name, ['--format=custom', '--file', path]);
  await command('pg_restore', restored.name, ['--dbname', restored.name, '--exit-on-error', path]);
  return restored;
}
async function snapshot(sql: Sql) {
  const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'spatial_ref_sys' ORDER BY tablename`;
  const result: Record<string, string> = {};
  for (const { tablename } of tables) {
    const key = tablename === 'ecofinance_migrations' ? 'name' : 'id';
    const [row] = await sql`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ${sql(key)}),'[]'::jsonb)::text AS records FROM ${sql(tablename)} t`;
    result[tablename] = row!.records;
  }
  return JSON.stringify(result);
}
async function legacySnapshot(sql: Sql) {
  const rows = await sql`SELECT jsonb_build_object('accounts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM accounts a),
    'entries',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM transactions t))::text AS records`;
  return rows[0]!.records;
}
async function cleanupTemporary() {
  if (dirname(resolve(temporary)) !== resolve(tmpdir()) || !basename(temporary).startsWith('ecofinance-recovery-')) throw new Error('Unsafe temporary cleanup path.');
  await rm(temporary, { recursive: true, force: true });
}

try {
  // Backup and restore the unmodified legacy BEFORE running any migration.
  const legacy = await database();
  await legacy.sql.unsafe(await readFile(new URL('../tests/fixtures/legacy.sql', import.meta.url), 'utf8'));
  const original = await legacySnapshot(legacy.sql);
  const legacyRestored = await roundtrip(legacy, 'legacy');
  if (original !== await legacySnapshot(legacyRestored.sql)) throw new Error('Legacy restore differs from backup.');
  await migrate(legacyRestored.sql, migrations, { id: '10000000-0000-4000-8000-000000000001', name: 'Recovery fixture', timezone: 'America/Sao_Paulo' });
  const [audit] = await legacyRestored.sql`SELECT before_snapshot=after_snapshot AS preserved FROM financial_migration_audits`;
  if (!audit?.preserved) throw new Error('Migrated legacy did not reconcile.');
  if ((await migrate(legacyRestored.sql, migrations)).length) throw new Error('Migration is not idempotent.');

  const finance = await database();
  await migrate(finance.sql, migrations);
  await finance.sql.unsafe(await readFile(new URL('../tests/fixtures/recovery.sql', import.meta.url), 'utf8'));
  const complete = await snapshot(finance.sql);
  const restored = await roundtrip(finance, 'finance');
  if (complete !== await snapshot(restored.sql)) throw new Error('Financial graph restore differs from backup.');
  await restored.sql.unsafe(await readFile(new URL('../tests/fixtures/assert-recovery.sql', import.meta.url), 'utf8'));
  let blocked = false;
  try { await restored.sql`UPDATE transactions SET account_id='00000000-0000-4000-8000-000000000004' WHERE id='00000000-0000-4000-8000-000000000002'`; }
  catch (error) { blocked = (error as { code?: string }).code === '23503'; }
  if (!blocked) throw new Error('Ownership constraints did not survive recovery.');
  console.log('PASS: legacy backup/restore before migration; reconciliation; full financial graph roundtrip; restored ownership and PostGIS constraints.');
} catch {
  console.error('Recovery verification failed. Connection details and financial rows were suppressed.');
  process.exitCode = 1;
} finally {
  for (const database of databases) { await database.sql.end(); await admin`DROP DATABASE ${admin(database.name)}`; }
  await admin.end();
  await cleanupTemporary();
}
