import { accounts, transactions, eq, and, gte, lte, ilike, desc, type Database } from '@ecofinance/db';
import { EntryQuerySchema, type EntryQuery } from '@ecofinance/shared';
// Owner is a separate server argument, never part of client/model filters.
export async function ownedEntries(database: Database, ownerId: string, input: Partial<EntryQuery>) {
  const query = EntryQuerySchema.parse(input);
  const conditions = [eq(transactions.ownerId, ownerId)];
  if (query.id) conditions.push(eq(transactions.id, query.id));
  if (query.accountId) conditions.push(eq(transactions.accountId, query.accountId));
  if (query.startDate) conditions.push(gte(transactions.purchaseDate, query.startDate));
  if (query.endDate) conditions.push(lte(transactions.purchaseDate, query.endDate));
  if (query.description) conditions.push(ilike(transactions.description, `%${query.description.replace(/[\\%_]/g, '\\$&')}%`));
  return database.select({
    id: transactions.id, description: transactions.description, amount: transactions.amount,
    date: transactions.purchaseDate, category: transactions.category,
    accountId: transactions.accountId, accountName: accounts.name,
  }).from(transactions)
    .leftJoin(accounts, and(eq(transactions.accountId, accounts.id), eq(accounts.ownerId, ownerId)))
    .where(and(...conditions)).orderBy(desc(transactions.purchaseDate), desc(transactions.id)).limit(query.limit);
}
