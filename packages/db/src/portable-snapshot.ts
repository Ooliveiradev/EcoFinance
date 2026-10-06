import { createHash } from 'node:crypto';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type { Sql } from 'postgres';
import * as finance from './schema';
import * as auth from './auth-schema';

type Cell = string | number | boolean | null;
export type PortableRow = Record<string, Cell>;
const models: unknown[] = [...Object.values(finance), ...Object.values(auth)];
const configs = models.filter((value): value is PgTable => is(value, PgTable)).map(getTableConfig)
  .sort((a, b) => a.name.localeCompare(b.name));

// Geography is maintained by SQL migrations rather than the Drizzle schema.
export const snapshotCatalog = configs.map(table => ({
  name: table.name,
  columns: [
    ...table.columns.map(column => ({ name: column.name, type: column.getSQLType(), nullable: !column.notNull })),
    ...(table.name === 'transactions' ? [{ name: 'geom', type: 'geography', nullable: true }] : []),
  ].sort((a, b) => a.name.localeCompare(b.name)),
  references: table.foreignKeys.map(key => {
    const ref = key.reference();
    return {
      columns: ref.columns.map(column => column.name),
      table: getTableConfig(ref.foreignTable).name,
      foreignColumns: ref.foreignColumns.map(column => column.name),
    };
  }),
}));

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
function digest(value: unknown) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export const snapshotSchema = digest(snapshotCatalog);

function cents(value: Cell): bigint {
  if (typeof value !== 'string' || !/^-?\d{1,13}\.\d{2}$/.test(value)) throw new Error('Invalid exact monetary value.');
  return BigInt(value.replace('.', ''));
}
export interface TableSnapshot {
  rows: PortableRow[];
  count: number;
  sha256: string;
  // Arbitrarily large totals remain strings, even when a total exceeds JS limits.
  sumsInCents: Record<string, string>;
}
export interface PortableSnapshot {
  format: 'ecofinance-portable-v1';
  schema: string;
  createdAt: string;
  migrationHistory: { name: string; checksum: string }[];
  tables: Record<string, TableSnapshot>;
}
function tableSummary(name: string, rows: PortableRow[]): TableSnapshot {
  const table = snapshotCatalog.find(table => table.name === name);
  if (!table) throw new Error('Unknown snapshot table.');
  const sorted = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const sumsInCents: Record<string, string> = {};
  for (const column of table.columns.filter(column => column.type.startsWith('numeric('))) {
    sumsInCents[column.name] = sorted.reduce((sum, row) => sum + (row[column.name] === null ? 0n : cents(row[column.name]!)), 0n).toString();
  }
  return { rows: sorted, count: sorted.length, sha256: digest(sorted), sumsInCents };
}

export function buildSnapshot(rows: Record<string, PortableRow[]>, migrationHistory: PortableSnapshot['migrationHistory'] = []): PortableSnapshot {
  const tables = Object.fromEntries(Object.entries(rows).map(([name, rows]) => [name, tableSummary(name, rows)]));
  const snapshot: PortableSnapshot = { format: 'ecofinance-portable-v1', schema: snapshotSchema, createdAt: new Date().toISOString(), migrationHistory, tables };
  validateSnapshot(snapshot);
  return snapshot;
}

// Validates a local artifact without opening either the source or target database.
export function validateSnapshot(input: unknown): asserts input is PortableSnapshot {
  if (!input || typeof input !== 'object') throw new Error('Invalid snapshot.');
  const snapshot = input as PortableSnapshot;
  if (snapshot.format !== 'ecofinance-portable-v1' || snapshot.schema !== snapshotSchema ||
      typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt)) ||
      !Array.isArray(snapshot.migrationHistory) || snapshot.migrationHistory.some(row => typeof row?.name !== 'string' || typeof row?.checksum !== 'string') ||
      !snapshot.tables || canonical(Object.keys(snapshot.tables).sort()) !== canonical(snapshotCatalog.map(table => table.name).sort())) {
    throw new Error('Snapshot format or schema mismatch.');
  }
  for (const table of snapshotCatalog) {
    const data = snapshot.tables[table.name]!;
    if (!Array.isArray(data.rows)) throw new Error('Invalid snapshot rows.');
    const keys = canonical(table.columns.map(column => column.name).sort());
    const rowIds = new Set<string>();
    for (const row of data.rows) {
      if (!row || canonical(Object.keys(row).sort()) !== keys || typeof row.id !== 'string' || rowIds.has(row.id)) throw new Error('Missing columns or duplicate identity.');
      rowIds.add(row.id);
      for (const column of table.columns) {
        const value = row[column.name];
        if (value === null) { if (!column.nullable) throw new Error('Required value missing.'); continue; }
        // Cast exact numbers, JSON, civil dates and timestamps to strings BEFORE JSON parsing.
        const expected = column.type === 'boolean' ? 'boolean' : ['integer', 'double precision'].includes(column.type) ? 'number' : 'string';
        if (typeof value !== expected || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid portable field type.');
      }
    }
    const summary = tableSummary(table.name, data.rows);
    if (summary.count !== data.count || summary.sha256 !== data.sha256 || canonical(summary.sumsInCents) !== canonical(data.sumsInCents)) throw new Error('Snapshot reconciliation failed.');
  }
  for (const table of snapshotCatalog) {
    for (const ref of table.references) {
      const parents = new Set(snapshot.tables[ref.table]!.rows.map(row => canonical(ref.foreignColumns.map(column => row[column]))));
      for (const row of snapshot.tables[table.name]!.rows) {
        const values = ref.columns.map(column => row[column]);
        if (values.some(value => value === null)) continue; // PostgreSQL MATCH SIMPLE.
        if (!parents.has(canonical(values))) throw new Error('Missing reference or cross-owner relationship.');
      }
    }
  }
}

export function compareSnapshots(source: unknown, target: unknown) {
  validateSnapshot(source); validateSnapshot(target);
  if (canonical(source.migrationHistory) !== canonical(target.migrationHistory) ||
      snapshotCatalog.some(table => source.tables[table.name]!.sha256 !== target.tables[table.name]!.sha256)) {
    throw new Error('Snapshots differ; cutover must remain blocked.');
  }
}

// A single read-only MVCC snapshot prevents mixed versions across tables.
// The source is never migrated, locked for writing or modified by this command.
export async function exportSnapshot(sql: Sql, maxRows = 100_000): Promise<PortableSnapshot> {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1) throw new Error('Invalid row limit.');
  return sql.begin('isolation level repeatable read read only', async tx => {
    await tx`SET LOCAL TIME ZONE 'UTC'`;
    await tx`SET LOCAL statement_timeout = '60s'`;
    const tables = await tx<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`;
    const expected = [...snapshotCatalog.map(table => table.name), 'ecofinance_migrations'].sort();
    if (canonical(tables.map(table => table.table_name).filter(name => name !== 'spatial_ref_sys')) !== canonical(expected)) throw new Error('Source tables differ from the catalog; inventory required.');
    const columns = await tx<{ table_name: string; column_name: string }[]>`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`;
    const rows: Record<string, PortableRow[]> = {};
    let total = 0;
    for (const table of snapshotCatalog) {
      const actual = columns.filter(column => column.table_name === table.name).map(column => column.column_name).sort();
      if (canonical(actual) !== canonical(table.columns.map(column => column.name).sort())) throw new Error('Source columns differ from the catalog; inventory required.');
      // Identifiers come exclusively from the server-owned schema catalog.
      const fields = table.columns.map(column => ['boolean', 'integer', 'double precision'].includes(column.type)
        ? tx`${tx(column.name)}` : tx`${tx(column.name)}::text AS ${tx(column.name)}`);
      const projection = fields.reduce((a, b) => tx`${a}, ${b}`);
      const result = await tx<{ record: string }[]>`SELECT row_to_json(r)::text AS record FROM (SELECT ${projection} FROM public.${tx(table.name)} ORDER BY id LIMIT ${maxRows - total + 1}) r`;
      total += result.length;
      if (total > maxRows) throw new Error('Snapshot row limit exceeded.');
      rows[table.name] = result.map(row => JSON.parse(row.record) as PortableRow);
    }
    const history = await tx<{ name: string; checksum: string }[]>`SELECT name,checksum FROM public.ecofinance_migrations ORDER BY name`;
    return buildSnapshot(rows, [...history]);
  });
}
