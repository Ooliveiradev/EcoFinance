import { describe, expect, it } from 'vitest';
import { buildSnapshot, compareSnapshots, snapshotCatalog, validateSnapshot, type PortableRow } from './portable-snapshot';

function empty() { return Object.fromEntries(snapshotCatalog.map(table => [table.name, [] as PortableRow[]])); }
function row(name: string, fields: Partial<PortableRow>): PortableRow {
  const table = snapshotCatalog.find(table => table.name === name)!;
  return Object.fromEntries(table.columns.map(column => [column.name, fields[column.name] ?? (column.nullable ? null : column.type.startsWith('numeric(') ? '0.00' : column.type === 'boolean' ? false : column.type === 'integer' ? 0 : 'synthetic')]));
}
function fixture() {
  const tables = empty();
  tables.users!.push(row('users', { id: 'owner-a' }), row('users', { id: 'owner-b' }));
  tables.accounts!.push(row('accounts', { id: 'account-a', owner_id: 'owner-a', balance: '9999999999999.99' }));
  tables.categories!.push(row('categories', { id: 'category-a', owner_id: 'owner-a' }));
  tables.transactions!.push(row('transactions', {
    id: 'entry-a', owner_id: 'owner-a', account_id: 'account-a', category_id: 'category-a', amount: '-0.10', purchase_date: '2026-09-30',
  }), row('transactions', {
    id: 'entry-b', owner_id: 'owner-a', account_id: 'account-a', category_id: 'category-a', amount: '-0.20', purchase_date: '2026-10-01',
  }));
  tables.auth_rate_limits!.push(row('auth_rate_limits', { id: 'rate-a', last_request: '9007199254740993' }));
  return tables;
}

describe('portable migration reconciliation', () => {
  it('includes every finance/auth table and SQL-maintained geography', () => {
    expect(snapshotCatalog).toHaveLength(21);
    expect(snapshotCatalog.find(table => table.name === 'transactions')!.columns.some(column => column.name === 'geom')).toBe(true);
    expect(() => validateSnapshot(buildSnapshot(empty()))).not.toThrow();
  });
  it('preserves exact cents, civil dates, large integers and arbitrary JSON content', () => {
    const tables = fixture();
    tables.preferences!.push(row('preferences', { id: 'pref-a', owner_id: 'owner-a', settings: '{"large":9007199254740993,"text":"á"}' }));
    const snapshot = buildSnapshot(tables);
    const restored = JSON.parse(JSON.stringify(snapshot));
    expect(snapshot.tables.transactions!.sumsInCents.amount).toBe('-30');
    expect(snapshot.tables.accounts!.sumsInCents.balance).toBe('999999999999999');
    expect(snapshot.tables.auth_rate_limits!.rows[0]!.last_request).toBe('9007199254740993');
    expect(() => compareSnapshots(snapshot, restored)).not.toThrow();
  });
  it('rejects money converted to floating point or a mismatched checksum', () => {
    const snapshot = buildSnapshot(fixture());
    snapshot.tables.transactions!.rows[0]!.amount = -0.1;
    expect(() => validateSnapshot(snapshot)).toThrow('field type');
    const corrupted = buildSnapshot(fixture());
    corrupted.tables.transactions!.rows[0]!.purchase_date = '2026-10-01';
    expect(() => validateSnapshot(corrupted)).toThrow('reconciliation');
  });
  it('rejects duplicate identities, missing/unknown tables and unexpected columns', () => {
    const duplicate = fixture();
    duplicate.transactions!.push({ ...duplicate.transactions![0]! });
    expect(() => buildSnapshot(duplicate)).toThrow('duplicate identity');
    const missing = empty(); delete missing.accounts;
    expect(() => buildSnapshot(missing)).toThrow('schema mismatch');
    expect(() => buildSnapshot({ ...empty(), unknown: [] })).toThrow('Unknown snapshot table');
    const extra = fixture(); extra.transactions![0]!.unknown = 'lost';
    expect(() => buildSnapshot(extra)).toThrow('Missing columns');
  });
  it('rejects dangling and cross-owner links even with freshly computed hashes', () => {
    const dangling = fixture(); dangling.transactions![0]!.account_id = 'missing';
    expect(() => buildSnapshot(dangling)).toThrow('Missing reference');
    const crossed = fixture(); crossed.accounts![0]!.owner_id = 'owner-b';
    expect(() => buildSnapshot(crossed)).toThrow('cross-owner');
  });
  it('compares full rows rather than accepting identical counts and totals', () => {
    const source = buildSnapshot(fixture());
    const changed = fixture(); changed.transactions![0]!.description = 'changed';
    expect(() => compareSnapshots(source, buildSnapshot(changed))).toThrow('Snapshots differ');
    const history = buildSnapshot(fixture(), [{ name: '0001.sql', checksum: 'changed' }]);
    expect(() => compareSnapshots(source, history)).toThrow('Snapshots differ');
  });
  it('ignores export time and row order when data is unchanged', () => {
    const source = buildSnapshot(fixture());
    const reversed = fixture(); reversed.transactions!.reverse();
    const target = buildSnapshot(reversed); target.createdAt = '2026-10-06T00:00:00Z';
    expect(() => compareSnapshots(source, target)).not.toThrow();
  });
});
