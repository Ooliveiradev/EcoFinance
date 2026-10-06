import { type Database, type Predicate } from '@ecofinance/db';
import { EntryQuerySchema, type EntryQuery } from '@ecofinance/shared';
export async function ownedEntries(database: Database, ownerId: string, input: Partial<EntryQuery>) {
  const query = EntryQuerySchema.parse(input);
  const where: Predicate[] = [];
  if (query.id) where.push({field:'id',value:query.id});
  if (query.accountId) where.push({field:'accountId',value:query.accountId});
  if (query.startDate) where.push({field:'purchaseDate',op:'gte',value:query.startDate});
  if (query.endDate) where.push({field:'purchaseDate',op:'lte',value:query.endDate});
  if (query.description) where.push({field:'description',op:'contains',value:query.description,mode:'insensitive'});
  const rows = await database.owned('transactions',ownerId,{where,order:[{field:'purchaseDate',direction:'desc'},{field:'id',direction:'desc'}],limit:query.limit});
  // Fetch only referenced accounts; ownership is checked again on every join.
  const names = new Map(await Promise.all([...new Set(rows.map(row=>row.accountId))].map(async id=> {
    const account = await database.get('accounts',id);
    return [id,account?.ownerId===ownerId ? account.name : null] as const;
  })));
  return rows.map(({id,description,amount,purchaseDate,category,accountId})=>({id,description,amount,date:purchaseDate,category,accountId,accountName:names.get(accountId)??null}));
}
