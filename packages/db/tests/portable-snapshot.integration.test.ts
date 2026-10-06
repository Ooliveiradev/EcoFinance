import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrate, readMigrations } from '../src/migrations';
import { compareSnapshots, exportSnapshot } from '../src/portable-snapshot';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL required; this suite creates a disposable database.');
const admin = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const name = `ecofinance_test_${randomBytes(8).toString('hex')}`;
let sql: Sql;
beforeAll(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  const isolated = new URL(url); isolated.pathname = `/${name}`;
  sql = postgres(isolated.toString(), { max: 1, prepare: false, onnotice: () => {} });
  const migrations = await readMigrations(fileURLToPath(new URL('../migrations', import.meta.url)));
  await migrate(sql, migrations);
  await sql.unsafe(await readFile(new URL('./fixtures/recovery.sql', import.meta.url), 'utf8'));
  await sql`INSERT INTO auth_rate_limits(key,count,last_request) VALUES ('synthetic',1,9007199254740993)`;
  await sql`INSERT INTO preferences(owner_id,settings) VALUES ('20000000-0000-4000-8000-000000000001','{"large":9007199254740993}'::jsonb)`;
});
afterAll(async () => {
  if (sql) await sql.end({ timeout: 5 });
  await admin`DROP DATABASE IF EXISTS ${admin(name)}`;
  await admin.end({ timeout: 5 });
});

describe('read-only PostgreSQL portable export', () => {
  it('preserves the complete graph, geography, timestamps, cents and large JSON integers', async () => {
    const snapshot = await exportSnapshot(sql);
    expect(snapshot.tables.transactions!.sumsInCents.amount).toBe('-3290');
    expect(snapshot.tables.transactions!.rows[0]!.geom).toMatch(/^[0-9A-F]+$/);
    expect(snapshot.tables.transactions!.rows[0]!.purchase_date).toBe('2026-09-30');
    expect(snapshot.tables.transactions!.rows[0]!.date).toBe('2026-09-30 15:00:00+00');
    expect(snapshot.tables.auth_rate_limits!.rows[0]!.last_request).toBe('9007199254740993');
    expect(snapshot.tables.preferences!.rows.some(row => row.settings === '{"large": 9007199254740993}')).toBe(true);
    expect(snapshot.migrationHistory).toHaveLength(4);
    expect(() => compareSnapshots(snapshot, JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
    expect(() => compareSnapshots(snapshot, snapshot)).not.toThrow();
    const repeated = await exportSnapshot(sql);
    expect(() => compareSnapshots(snapshot, repeated)).not.toThrow();
  });
  it('refuses additional source tables or columns instead of silently dropping data', async () => {
    await sql`CREATE TABLE unexpected_private_data(id uuid)`;
    try { await expect(exportSnapshot(sql)).rejects.toThrow('Source tables differ'); }
    finally { await sql`DROP TABLE unexpected_private_data`; }
    await sql`ALTER TABLE accounts ADD COLUMN unexpected text`;
    try { await expect(exportSnapshot(sql)).rejects.toThrow('Source columns differ'); }
    finally { await sql`ALTER TABLE accounts DROP COLUMN unexpected`; }
  });
  it('fails on the row limit without changing the source', async () => {
    const before = await exportSnapshot(sql);
    await expect(exportSnapshot(sql, 1)).rejects.toThrow('row limit exceeded');
    await expect(exportSnapshot(sql, 0)).rejects.toThrow('Invalid row limit');
    expect(() => compareSnapshots(before, before)).not.toThrow();
    const after = await exportSnapshot(sql);
    expect(() => compareSnapshots(before, after)).not.toThrow();
  });
});
