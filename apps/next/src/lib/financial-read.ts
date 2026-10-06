import { db, type Models, type OwnedCollection } from '@ecofinance/db';
export function exactCents(value: string): bigint {
  if (!/^-?\d{1,13}(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid monetary value.');
  const negative=value.startsWith('-');
  const [whole,fraction='']=value.replace(/^-/, '').split('.');
  const cents=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));
  return negative ? -cents : cents;
}
export function displayMoney(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Total exceeds presentation precision.');
  return Number(cents)/100;
}
export async function ownedReferences<K extends OwnedCollection>(collection: K, ownerId: string, ids: string[]) {
  const rows=await Promise.all([...new Set(ids)].map(async id=> {
    const row=await db.get(collection,id);
    if (!row || (row as {ownerId:string}).ownerId!==ownerId) throw new Error('Invalid owned reference.');
    return [id,row] as const;
  }));
  return new Map<string,Models[K]>(rows);
}
