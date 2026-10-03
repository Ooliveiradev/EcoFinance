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

const legacyOwner = { id: '10000000-0000-4000-8000-000000000001', name: 'Proprietário sintético', timezone: 'America/Sao_Paulo' };
const ownerB = '20000000-0000-4000-8000-000000000001';
const accountA = '00000000-0000-4000-8000-000000000001';
const categoryA = '00000000-0000-4000-8000-000000000010';
const entryA = '00000000-0000-4000-8000-000000000002';
async function legacyDatabase() {
  const sql = await isolatedDatabase();
  await sql.unsafe(await readFile(new URL('./fixtures/legacy.sql', import.meta.url), 'utf8'));
  return sql;
}
async function financialDatabase() {
  const sql = await isolatedDatabase();
  await migrate(sql, migrations);
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe(await readFile(new URL('./fixtures/recovery.sql', import.meta.url), 'utf8'));
  } finally { reserved.release(); }
  return sql;
}

describe('owned financial model and preservation', () => {
  it('requires explicit attribution and timezone, rolling back expansion on failure', async () => {
    const sql = await legacyDatabase();
    await expect(migrate(sql, migrations)).rejects.toThrow('EF02: Legacy data requires');
    await expect(migrate(sql, migrations, { ...legacyOwner, timezone: 'invalid/zone' })).rejects.toThrow('EF02: Invalid explicit IANA timezone');
    const [result] = await sql`SELECT to_regclass('public.users') AS users, count(*)::int AS entries FROM transactions`;
    expect(result).toEqual({ users: null, entries: 2 });
  });

  it('preserves timestamps, negative amounts and refunds; marks inferred civil dates for review', async () => {
    const sql = await legacyDatabase();
    await sql`UPDATE transactions SET date='2026-10-01T01:00:00Z' WHERE amount=10`;
    const before = await sql`SELECT id,account_id,description,amount,date,category,source,external_id,created_at,updated_at FROM transactions ORDER BY id`;
    await migrate(sql, migrations, legacyOwner);
    expect(await sql`SELECT id,account_id,description,amount,date,category,source,external_id,created_at,updated_at FROM transactions ORDER BY id`).toEqual(before);
    const entries = await sql`SELECT owner_id,kind,review_required,purchase_date::text,competence_month::text,paid_date FROM transactions ORDER BY id`;
    expect(entries).toEqual([0, 1].map(() => ({ owner_id: legacyOwner.id, kind: 'unclassified', review_required: true, purchase_date: '2026-09-30', competence_month: '2026-09-01', paid_date: null })));
    const [audit] = await sql`SELECT before_snapshot,after_snapshot,timezone FROM financial_migration_audits`;
    expect(audit!.before_snapshot).toEqual(audit!.after_snapshot);
    expect(audit!.before_snapshot).toMatchObject({ entries: 2, total: '-32.90', accounts: 1 });
    expect(audit!.timezone).toBe(legacyOwner.timezone);
    expect(await sql`SELECT count(*)::int AS count FROM categories`).toEqual([{ count: 11 }]);
    const [account] = await sql`SELECT opening_balance,opening_date,balance FROM accounts`;
    expect(account).toEqual({ opening_balance: '0.00', opening_date: null, balance: '1000.00' });
    expect(await migrate(sql, migrations, legacyOwner)).toEqual([]);
  });

  it('blocks duplicate existing identities without dropping either record', async () => {
    const sql = await legacyDatabase();
    await sql`UPDATE transactions SET external_id='fixture-1',source='ofx'`;
    const before = await sql`SELECT id,amount,date,source,external_id FROM transactions ORDER BY id`;
    await expect(migrate(sql, migrations, legacyOwner)).rejects.toThrow('Duplicate transaction external IDs require manual reconciliation');
    expect(await sql`SELECT id,amount,date,source,external_id FROM transactions ORDER BY id`).toEqual(before);
    expect(await sql`SELECT to_regclass('public.ecofinance_migrations') AS registry`).toEqual([{ registry: null }]);
  });

  it('detects changed financial rows even when a legacy trigger alters the backfill', async () => {
    const sql = await legacyDatabase();
    await migrate(sql, migrations.slice(0, 1));
    await sql.unsafe(`CREATE FUNCTION corrupt_backfill() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.amount:=NEW.amount+1; RETURN NEW; END $$;
      CREATE TRIGGER corrupt_backfill BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION corrupt_backfill();`);
    const before = await sql`SELECT id,amount,date FROM transactions ORDER BY id`;
    await expect(migrate(sql, migrations, legacyOwner)).rejects.toThrow('EF02: Financial preservation validation failed');
    expect(await sql`SELECT id,amount,date FROM transactions ORDER BY id`).toEqual(before);
    expect(await sql`SELECT name FROM ecofinance_migrations`).toEqual([{ name: '0001_init.sql' }]);
  });

  it('also blocks financial side effects of legacy triggers during the initial spatial adoption', async () => {
    const sql = await legacyDatabase();
    await sql.unsafe(`CREATE FUNCTION corrupt_spatial_adoption() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.amount:=NEW.amount+1; RETURN NEW; END $$;
      CREATE TRIGGER corrupt_spatial_adoption BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION corrupt_spatial_adoption();`);
    const before = await sql`SELECT id,amount,date FROM transactions ORDER BY id`;
    await expect(migrate(sql, migrations, legacyOwner)).rejects.toThrow('EF02: Financial preservation failed during spatial adoption');
    expect(await sql`SELECT id,amount,date FROM transactions ORDER BY id`).toEqual(before);
    expect(await sql`SELECT to_regclass('public.ecofinance_migrations') AS registry`).toEqual([{ registry: null }]);
  });

  it('rejects cross-owner account/category/invoice links, anonymous writes and destructive deletes', async () => {
    const sql = await financialDatabase();
    await expect(sql`UPDATE transactions SET account_id='00000000-0000-4000-8000-000000000004' WHERE id=${entryA}`).rejects.toMatchObject({ code: '23503', constraint_name: 'transactions_account_owner_fk' });
    await expect(sql`UPDATE transactions SET category_id='00000000-0000-4000-8000-000000000011' WHERE id=${entryA}`).rejects.toMatchObject({ code: '23503', constraint_name: 'transactions_category_owner_fk' });
    const [invoiceB] = await sql`SELECT id FROM invoices WHERE owner_id=${ownerB}`;
    await expect(sql`UPDATE transactions SET invoice_id=${invoiceB!.id} WHERE id=${entryA}`).rejects.toMatchObject({ code: '23503', constraint_name: 'transactions_invoice_owner_fk' });
    await expect(sql`INSERT INTO accounts(name) VALUES('Sem proprietário')`).rejects.toMatchObject({ code: '23502' });
    await sql`UPDATE accounts SET archived_at=now() WHERE id=${accountA}`;
    await sql`UPDATE categories SET archived_at=now() WHERE id=${categoryA}`;
    await expect(sql`DELETE FROM accounts WHERE id=${accountA}`).rejects.toMatchObject({ code: '23503' });
    await expect(sql`DELETE FROM categories WHERE id=${categoryA}`).rejects.toMatchObject({ code: '23503' });
    expect(await sql`SELECT count(*)::int AS count,sum(amount)::text AS total FROM transactions`).toEqual([{ count: 2, total: '-32.90' }]);
    const unsafe = await sql`SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f' AND confdeltype IN ('c','n')`;
    expect(unsafe).toEqual([]);
    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('users','ecofinance_migrations','spatial_ref_sys')`;
    for (const { tablename } of tables) {
      const [column] = await sql`SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=${tablename} AND column_name='owner_id'`;
      expect(column, tablename).toEqual({ is_nullable: 'NO' });
    }
  });

  it('enforces external identity scope, recurrence uniqueness and import idempotency', async () => {
    const sql = await financialDatabase();
    const insert = (owner: string, account: string, category: string, source: string) => sql`INSERT INTO transactions(owner_id,account_id,category_id,description,amount,date,purchase_date,competence_month,kind,review_required,source,external_id)
      VALUES(${owner},${account},${category},'Identidade sintética','-1','2026-10-02','2026-10-02','2026-10-01','expense',false,${source},'fixture-1')`;
    await expect(insert(legacyOwner.id, accountA, categoryA, 'ofx')).rejects.toMatchObject({ code: '23505' });
    await insert(legacyOwner.id, accountA, categoryA, 'csv');
    await insert(ownerB, '00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000011', 'ofx');
    const [secondAccount] = await sql`INSERT INTO accounts(owner_id,name) VALUES(${legacyOwner.id},'Segunda conta') RETURNING id`;
    await insert(legacyOwner.id, secondAccount!.id, categoryA, 'ofx');
    const [occurrence] = await sql`SELECT rule_id FROM recurrence_occurrences`;
    await expect(sql`INSERT INTO recurrence_occurrences(owner_id,rule_id,competence_month,due_date,amount) VALUES(${legacyOwner.id},${occurrence!.rule_id},'2026-09-01','2026-09-30','-20')`).rejects.toMatchObject({ code: '23505' });
    await expect(sql`INSERT INTO recurrence_occurrences(owner_id,rule_id,competence_month,due_date,amount) VALUES(${ownerB},${occurrence!.rule_id},'2026-10-01','2026-10-30','-20')`).rejects.toMatchObject({ code: '23503' });
    await expect(sql`INSERT INTO import_batches(owner_id,source,idempotency_key) VALUES(${legacyOwner.id},'ofx','fixture-import')`).rejects.toMatchObject({ code: '23505' });
    const [batch] = await sql`SELECT id FROM import_batches`;
    await expect(sql`INSERT INTO import_items(owner_id,batch_id,position) VALUES(${ownerB},${batch!.id},2)`).rejects.toMatchObject({ code: '23503' });
  });

  it('keeps money exact, validates civil months and explicit financial meaning', async () => {
    const sql = await financialDatabase();
    await sql`UPDATE transactions SET amount='-9999999999999.99' WHERE id=${entryA}`;
    expect(await sql`SELECT amount FROM transactions WHERE id=${entryA}`).toEqual([{ amount: '-9999999999999.99' }]);
    await expect(sql`UPDATE transactions SET amount='-10000000000000' WHERE id=${entryA}`).rejects.toMatchObject({ code: '22003' });
    await expect(sql`UPDATE transactions SET amount=42.90 WHERE id=${entryA}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE transactions SET kind='unclassified',review_required=false WHERE id=${entryA}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE transactions SET competence_month='2026-10-02' WHERE id=${entryA}`).rejects.toMatchObject({ code: '23514' });
    await expect(sql`UPDATE transactions SET status='settled',paid_date=NULL WHERE id=${entryA}`).rejects.toMatchObject({ code: '23514' });
    const indexes = await sql`SELECT indexname FROM pg_indexes WHERE tablename='transactions' AND indexname LIKE 'transactions_owner_%'`;
    expect(indexes.map(row => row.indexname)).toEqual(expect.arrayContaining(['transactions_owner_date_idx','transactions_owner_month_idx','transactions_owner_account_idx','transactions_owner_category_idx']));
  });
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
    await migrate(sql, migrations, { id: '10000000-0000-4000-8000-000000000001', name: 'Fixture', timezone: 'America/Sao_Paulo' });
    expect(await sql`SELECT id, account_id, amount, date, source, external_id FROM transactions ORDER BY id`).toEqual(before);
    const [total] = await sql`SELECT count(*)::int AS count, sum(amount)::text AS sum FROM transactions`;
    expect(total).toEqual({ count: 2, sum: '-32.90' });
    // Trigger operates for new/updated rows; check the legacy spatial backfill too.
    const nearby = await sql`SELECT id FROM buscar_lancamentos_proximos(-23.55, -46.63, 1000)`;
    expect(nearby.map(row => row.id)).toContain('00000000-0000-4000-8000-000000000002');
  });

  it('reproduces the existing OFX conflict bug rather than hiding insert failures', async () => {
    const sql = await isolatedDatabase();
    await migrate(sql, migrations.slice(0, 1));
    const [account] = await sql`INSERT INTO accounts(name) VALUES ('Conta sintética') RETURNING id`;
    await expect(sql`INSERT INTO transactions(account_id,description,amount,date,external_id)
      VALUES (${account!.id}, 'Compra sintética', '-42.90', '2026-10-02', 'fixture-1')
      ON CONFLICT (external_id) DO NOTHING`).rejects.toMatchObject({ code: '42P10' });
    const [result] = await sql`SELECT count(*)::int AS count FROM transactions`;
    expect(result!.count).toBe(0);
  });

  it('upgrades the published predecessor without changing its migration history', async () => {
    const sql = await legacyDatabase();
    await migrate(sql, migrations.slice(0, 2));
    const oldHistory = await sql`SELECT name,checksum,applied_at FROM ecofinance_migrations ORDER BY name`;
    const before = await sql`SELECT id,account_id,amount,date,source,external_id FROM transactions ORDER BY id`;
    expect(await migrate(sql, migrations, legacyOwner)).toEqual(['0003_owned_finance.sql']);
    expect(await sql`SELECT name,checksum,applied_at FROM ecofinance_migrations ORDER BY name LIMIT 2`).toEqual(oldHistory);
    expect(await sql`SELECT id,account_id,amount,date,source,external_id FROM transactions ORDER BY id`).toEqual(before);
    await sql`UPDATE transactions SET external_id='fixture-1' WHERE source='manual'`;
    const [index] = await sql`SELECT indisunique FROM pg_index WHERE indexrelid='idx_transactions_external_id'::regclass`;
    expect(index!.indisunique).toBe(false);
  });

  it('retains the predecessor import guarantee before upgrading the owned model', async () => {
    const sql = await isolatedDatabase();
    await migrate(sql, migrations.slice(0, 2));
    const [account] = await sql`INSERT INTO accounts(name) VALUES ('Predecessor') RETURNING id`;
    await sql`INSERT INTO transactions(account_id,description,amount,date,external_id) VALUES (${account!.id},'Primeira','-42.90','2026-10-02','fixture-1') ON CONFLICT(external_id) DO NOTHING`;
    await sql`INSERT INTO transactions(account_id,description,amount,date,external_id) VALUES (${account!.id},'Duplicata','-42.90','2026-10-02','fixture-1') ON CONFLICT(external_id) DO NOTHING`;
    expect(await sql`SELECT count(*)::int AS count,sum(amount)::text AS total FROM transactions`).toEqual([{count:1,total:'-42.90'}]);
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
