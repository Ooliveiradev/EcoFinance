import type { Sql } from 'postgres';
import { validateSnapshot, snapshotCatalog, type PortableSnapshot } from './portable-snapshot';
const order=['users','accounts','categories','uber_trips_metadata','cards','invoices','installment_groups','installments','recurrence_rules','recurrence_occurrences','budgets','budget_categories','transactions','import_batches','import_items','preferences','financial_migration_audits','auth_accounts','auth_sessions','auth_verifications','auth_rate_limits'];
// Restore only into an already migrated, empty destination. SQL constraints
// check the graph and values again; the entire restore commits atomically.
export async function restorePortable(sql:Sql,input:unknown) {
  validateSnapshot(input);
  const snapshot:PortableSnapshot=input;
  return sql.begin(async tx=> {
    await tx`SET LOCAL TIME ZONE 'UTC'`;
    for(const table of snapshotCatalog) {
      const count=await tx`SELECT count(*)::int AS count FROM ${tx(table.name)}`;
      if(count[0]!.count!==0)throw new Error('Rollback target must be empty.');
    }
    for(const name of order) {
      for(const row of snapshot.tables[name]!.rows) {
        // PostGIS recalculates geom from the preserved latitude/longitude.
        const columns=snapshotCatalog.find(table=>table.name===name)!.columns.filter(column=>column.name!=='geom');
        const values=columns.map(column=>tx`${row[column.name]===null ? null : tx.typed(String(row[column.name]),25)}::${tx.unsafe(column.type)}`);
        // Explicit text parameters avoid postgres-js's timestamp serializer,
        // which otherwise round-trips a string through JS Date (milliseconds).
        // Cast types come exclusively from the frozen server schema catalog.
        const projection=values.slice(1).reduce((a,b)=>tx`${a},${b}`,values[0]!);
        await tx`INSERT INTO ${tx(name)} (${tx(columns.map(column=>column.name))}) VALUES (${projection})`;
      }
    }
    // Never reactivate old bearer/cookie sessions when rolling code backward.
    await tx`DELETE FROM auth_sessions`;
  });
}
