import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrate, readMigrations, type Migration } from '../src/migrations';

// This suite always creates isolated databases; it never migrates the URL's database.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString) throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests.');
const admin = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });
const databases: { name: string; sql: Sql }[] = [];
let migrations: Migration[];

async function isolatedDatabase(): Promise<Sql> {
  const name = `ecofinance_test_${randomBytes(8).toString('hex')}`;
  await admin`CREATE DATABASE ${admin(name)}`;
  const url = new URL(connectionString!);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 2, prepare: false, onnotice: () => {} });
  databases.push({ name, sql });
  return sql;
}

beforeAll(async () => {
  migrations = await readMigrations(fileURLToPath(new URL('../migrations', import.meta.url)));
});

afterAll(async () => {
  try {
    for (const database of databases) {
      await database.sql.end();
      await admin`DROP DATABASE ${admin(database.name)}`;
    }
  } finally {
    await admin.end();
  }
});

describe('versioned PostgreSQL migrations', () => {
  it('initializes an empty database once under concurrent runners and installs spatial objects', async () => {
    const sql = await isolatedDatabase();
    const results = await Promise.all([migrate(sql, migrations), migrate(sql, migrations)]);
    expect(results.flat()).toEqual(migrations.map(migration => migration.name));
    expect(await migrate(sql, migrations)).toEqual([]);
    const [history] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM public.ecofinance_migrations`;
    expect(history!.count).toBe(migrations.length);
    const objects = await sql`SELECT
      to_regclass('public.idx_transactions_geom') IS NOT NULL AS spatial_index,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='trg_update_geom') AS spatial_trigger,
      EXISTS(SELECT 1 FROM pg_proc WHERE proname='buscar_lancamentos_proximos') AS spatial_function`;
    expect(objects[0]).toEqual({ spatial_index: true, spatial_trigger: true, spatial_function: true });
  });

  it('adopts the db:push legacy schema without changing financial data', async () => {
    const sql = await isolatedDatabase();
    await sql.unsafe(await readFile(new URL('./fixtures/legacy.sql', import.meta.url), 'utf8'));
    const before = await sql`SELECT id, account_id, amount, date, source, external_id FROM transactions ORDER BY id`;
    await migrate(sql, migrations);
    expect(await sql`SELECT id, account_id, amount, date, source, external_id FROM transactions ORDER BY id`).toEqual(before);
    const [total] = await sql`SELECT count(*)::int AS count, sum(amount)::text AS sum FROM transactions`;
    expect(total).toEqual({ count: 2, sum: '-32.90' });
    // Trigger operates for new/updated rows; check the legacy spatial backfill too.
    const nearby = await sql`SELECT id FROM buscar_lancamentos_proximos(-23.55, -46.63, 1000)`;
    expect(nearby.map(row => row.id)).toContain('00000000-0000-4000-8000-000000000002');
  });

  it('deduplicates external transaction IDs without losing the first transaction', async () => {
    const sql = await isolatedDatabase();
    await migrate(sql, migrations);
    const [account] = await sql`INSERT INTO accounts(name) VALUES ('Conta sintética') RETURNING id`;
    await sql`INSERT INTO transactions(account_id,description,amount,date,external_id)
      VALUES (${account!.id}, 'Compra sintética', '-42.90', '2026-10-02', 'fixture-1')
      ON CONFLICT (external_id) DO NOTHING`;
    await sql`INSERT INTO transactions(account_id,description,amount,date,external_id)
      VALUES (${account!.id}, 'Duplicata', '-42.90', '2026-10-02', 'fixture-1') ON CONFLICT (external_id) DO NOTHING`;
    const [result] = await sql`SELECT count(*)::int AS count FROM transactions`;
    expect(result!.count).toBe(1);
  });

  it('rolls back DDL and history when a pending migration fails', async () => {
    const sql = await isolatedDatabase();
    await migrate(sql, migrations);
    const invalid = { name: '9999_invalid.sql', checksum: 'synthetic', content: 'CREATE TABLE rollback_probe(id int); SELECT missing_column FROM rollback_probe;' };
    await expect(migrate(sql, [...migrations, invalid])).rejects.toMatchObject({ code: '42703' });
    const [probe] = await sql`SELECT to_regclass('public.rollback_probe') AS table_name`;
    expect(probe!.table_name).toBeNull();
    expect(await migrate(sql, migrations)).toEqual([]);
  });

  it('rejects edited history before applying any new migration', async () => {
    const sql = await isolatedDatabase();
    await migrate(sql, migrations);
    const changed = migrations.map(migration => ({ ...migration, checksum: 'changed' }));
    await expect(migrate(sql, changed)).rejects.toThrow('Migration history mismatch');
  });

  it('refuses an incompatible legacy schema without changing its data', async () => {
    const sql = await isolatedDatabase();
    await sql.unsafe(await readFile(new URL('./fixtures/legacy.sql', import.meta.url), 'utf8'));
    await sql`ALTER TABLE transactions ALTER COLUMN amount TYPE numeric(16,3)`;
    const before = await sql`SELECT id, amount FROM transactions ORDER BY id`;
    await expect(migrate(sql, migrations)).rejects.toMatchObject({ code: 'P0001' });
    expect(await sql`SELECT id, amount FROM transactions ORDER BY id`).toEqual(before);
    const [registry] = await sql`SELECT to_regclass('public.ecofinance_migrations') AS name`;
    expect(registry!.name).toBeNull();
  });
});
