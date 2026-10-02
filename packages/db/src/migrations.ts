import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Sql } from 'postgres';

export interface Migration {
  name: string;
  checksum: string;
  content: string;
}

export async function readMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory)).filter(name => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
  if (names.length === 0) throw new Error('No SQL migrations found.');
  const versions = names.map(name => name.slice(0, 4));
  if (new Set(versions).size !== versions.length) throw new Error('Duplicate migration version.');
  return Promise.all(names.map(async name => {
    const content = await readFile(`${directory}/${name}`, 'utf8');
    // Git checkouts on Windows may use CRLF; that does not change the migration.
    const normalized = content.replace(/\r\n/g, '\n');
    return { name, content, checksum: createHash('sha256').update(normalized).digest('hex') };
  }));
}

export function pendingMigrations(migrations: Migration[], applied: { name: string; checksum: string }[]): Migration[] {
  for (const [index, entry] of applied.entries()) {
    const migration = migrations[index];
    if (migration?.name !== entry.name || migration.checksum !== entry.checksum) {
      throw new Error(`Migration history mismatch: ${entry.name}. Restore the original migration before continuing.`);
    }
  }
  return migrations.slice(applied.length);
}

export interface LegacyOwner { id: string; name: string; timezone: string }

export async function migrate(sql: Sql, migrations: Migration[], legacyOwner?: LegacyOwner): Promise<string[]> {
  // One transaction protects the history and all DDL; concurrent runners wait.
  return sql.begin(async transaction => {
    await transaction`SELECT pg_advisory_xact_lock(17012026, 1)`;
    await transaction`CREATE TABLE IF NOT EXISTS public.ecofinance_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const applied = await transaction<{ name: string; checksum: string }[]>`
      SELECT name, checksum FROM public.ecofinance_migrations ORDER BY name
    `;
    const pending = pendingMigrations(migrations, applied);
    await transaction.unsafe('SET LOCAL search_path TO public, extensions');
    if (legacyOwner) {
      await transaction`SELECT set_config('ecofinance.legacy_owner_id', ${legacyOwner.id}, true),
        set_config('ecofinance.legacy_owner_name', ${legacyOwner.name}, true),
        set_config('ecofinance.legacy_timezone', ${legacyOwner.timezone}, true)`;
    }
    for (const migration of pending) {
      await transaction.unsafe(migration.content);
      await transaction`INSERT INTO public.ecofinance_migrations (name, checksum)
        VALUES (${migration.name}, ${migration.checksum})`;
    }
    return pending.map(migration => migration.name);
  });
}
