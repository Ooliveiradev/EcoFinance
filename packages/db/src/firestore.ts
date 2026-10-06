import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { field, and, or, type BooleanExpression, type Expression } from '@google-cloud/firestore/pipelines';
import { uniqueKeys, validateDocument, references } from './firestore-validation';
import type { Collection, Models, OwnedCollection } from './models';

export interface Predicate { field: string; op?: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'in' | 'not_in' | 'contains' | 'starts_with' | 'ends_with'; value: unknown; connector?: 'AND' | 'OR'; mode?: 'sensitive' | 'insensitive' }
export interface QueryOptions { where?: Predicate[]; order?: { field: string; direction: 'asc' | 'desc' }[]; limit?: number; offset?: number }
export const collections: Collection[] = ['users','categories','accounts','uberTripsMetadata','transactions','recurrenceRules','recurrenceOccurrences','budgets','budgetCategories','cards','invoices','installmentGroups','installments','importBatches','importItems','preferences','financialMigrationAudits','authSessions','authAccounts','authVerifications','authRateLimits'];
const MAX_ROWS = 10000;
export function decode(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate();
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, decode(val)]));
  return value;
}
function expression(p: Predicate): BooleanExpression {
  let f: Expression = field(p.field);
  if (p.mode === 'insensitive') f = f.toLower();
  const v = p.mode === 'insensitive' && typeof p.value === 'string' ? p.value.toLowerCase() : p.value;
  switch (p.op ?? 'eq') {
    case 'eq': return f.equal(v);
    case 'ne': return f.notEqual(v);
    case 'lt': return f.lessThan(v);
    case 'lte': return f.lessThanOrEqual(v);
    case 'gt': return f.greaterThan(v);
    case 'gte': return f.greaterThanOrEqual(v);
    case 'in': return f.equalAny(v as unknown[]);
    case 'not_in': return f.equalAny(v as unknown[]).not();
    case 'contains': return f.stringContains(v as string);
    case 'starts_with': return f.startsWith(v as string);
    case 'ends_with': return f.endsWith(v as string);
  }
}
function filter(where: Predicate[]) {
  const mandatory = where.filter(p => p.connector !== 'OR').map(expression);
  const alternatives = where.filter(p => p.connector === 'OR').map(expression);
  const group = mandatory.length ? mandatory.slice(1).reduce((a,b) => and(a,b), mandatory[0]!) : null;
  const either = alternatives.length ? alternatives.slice(1).reduce((a,b) => or(a,b), alternatives[0]!) : null;
  return group && either ? or(group,either) : group ?? either;
}
/** Privileged server store. All public reads must go through owned(). */
export class DocumentStore {
  private instance?: Firestore;
  private pending = new Map<string, Record<string, unknown> | null>();
  private originals = new Map<string,Record<string,unknown>>();
  constructor(instance?: Firestore, private tx?: Transaction) { this.instance = instance; }
  get firestore(): Firestore {
    if (this.instance) return this.instance;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const databaseId = process.env.FIRESTORE_DATABASE_ID;
    if (!projectId || !databaseId) throw new Error('FIREBASE_PROJECT_ID and FIRESTORE_DATABASE_ID are required.');
    const app = getApps().find(app => app.name === 'ecofinance') ?? initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) }, 'ecofinance');
    return this.instance = getFirestore(app, databaseId);
  }
  private ref(collection: Collection, id: string) {
    if (!collections.includes(collection) || !id || id.includes('/')) throw new Error('Invalid document identity.');
    return this.firestore.collection(collection).doc(id);
  }
  async get<K extends Collection>(collection: K, id: string): Promise<Models[K] | null> {
    const ref = this.ref(collection, id);
    if (this.pending.has(ref.path)) return decode(this.pending.get(ref.path) ?? null) as Models[K] | null;
    const snap = this.tx ? await this.tx.get(ref) : await ref.get();
    if(snap.exists)this.originals.set(ref.path,snap.data()!);
    return snap.exists ? decode(snap.data()) as Models[K] : null;
  }
  async query<K extends Collection>(collection: K, options: QueryOptions = {}): Promise<Models[K][]> {
    if (!collections.includes(collection)) throw new Error('Unknown collection.');
    const limit = options.limit ?? MAX_ROWS;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ROWS || !Number.isSafeInteger(options.offset ?? 0) || (options.offset ?? 0) < 0) throw new Error('Invalid query limit.');
    // Fail closed instead of returning a stale query after a staged write.
    if ([...this.pending.keys()].some(path => path.startsWith(collection + '/'))) throw new Error('Query must precede writes in a transaction.');
    let pipeline = this.firestore.pipeline().collection(collection);
    const condition = filter(options.where ?? []);
    if (condition) pipeline = pipeline.where(condition);
    if (options.order?.length) {
      const ordering = options.order.map(o => o.direction === 'asc' ? field(o.field).ascending() : field(o.field).descending());
      pipeline = pipeline.sort(ordering[0]!, ...ordering.slice(1));
    }
    if (options.offset) pipeline = pipeline.offset(options.offset);
    pipeline = pipeline.limit(limit + (options.limit ? 0 : 1));
    const snapshot = this.tx ? await this.tx.execute(pipeline) : await pipeline.execute();
    const rows = snapshot.results.map(result => decode(result.data()) as Models[K]);
    if (!options.limit && rows.length > MAX_ROWS) throw new Error('Query too large; pagination required.');
    return rows;
  }
  async owned<K extends OwnedCollection>(collection: K, ownerId: string, options: QueryOptions = {}): Promise<Models[K][]> {
    if (!ownerId || (options.where ?? []).some(p => p.field === 'ownerId' || p.connector === 'OR')) throw new Error('Invalid ownership filter.');
    return this.query(collection, { ...options, where: [{field:'ownerId',value:ownerId}, ...(options.where ?? [])] });
  }
  async transaction<R>(callback: (store: DocumentStore) => Promise<R>): Promise<R> {
    if (this.tx) return callback(this);
    return this.firestore.runTransaction(async tx => {
      const store = new DocumentStore(this.firestore, tx);
      const result = await callback(store);
      for (const [path, value] of store.pending) {
        const ref = this.firestore.doc(path);
        if (value === null) tx.delete(ref); else tx.set(ref, value);
      }
      return result;
    });
  }
  async put<K extends Collection>(collection: K, row: Models[K], create = false): Promise<void> {
    if (!this.tx) return this.transaction(tx => tx.put(collection, row, create));
    const ref = this.ref(collection, row.id);
    const previous = await this.get(collection, row.id);
    if (create && previous) throw new Error('Duplicate identity.');
    const next = {...row} as unknown as Record<string, unknown>;
    // JS Date exposes milliseconds. A read/edit must not truncate a historical
    // timestamp's finer precision when that timestamp was not changed.
    const original=this.pending.get(ref.path)??this.originals.get(ref.path);
    for(const [key,value]of Object.entries(next)) {
      const old=original?.[key];
      if(value instanceof Date && old instanceof Timestamp && value.getTime()===old.toDate().getTime())next[key]=old;
    }
    validateDocument(collection,next);
    if(previous && 'ownerId' in previous && next.ownerId!==previous.ownerId)throw new Error('Ownership is immutable.');
    for(const ref of references(collection)) {
      const values=ref.fields.map(key=>next[key]);
      if(values.some(value=>value==null))continue;
      const id=values[ref.target.indexOf('id')];
      const parent=await this.get(ref.collection as Collection,String(id));
      if(!parent || ref.target.some((key,i)=>(parent as unknown as Record<string,unknown>)[key]!==values[i]))throw new Error('Missing reference or cross-owner relationship.');
    }
    const oldKeys = previous ? uniqueKeys(collection, previous as unknown as Record<string, unknown>) : [];
    const newKeys = uniqueKeys(collection, next);
    for (const key of newKeys) {
      const unique = this.firestore.collection('_unique').doc(key);
      const claim = this.pending.has(unique.path) ? this.pending.get(unique.path) : (await this.tx.get(unique)).data();
      if (claim && claim.path !== ref.path) throw new Error('Duplicate unique value.');
      this.pending.set(unique.path, {path:ref.path});
    }
    for (const key of oldKeys.filter(key => !newKeys.includes(key))) this.pending.set(`_unique/${key}`, null);
    this.pending.set(ref.path, next);
  }
  async remove(collection: Collection, id: string): Promise<void> {
    if (!['authSessions','authRateLimits','authVerifications'].includes(collection)) throw new Error('Deletion is restricted to disposable auth records.');
    if (!this.tx) return this.transaction(tx => tx.remove(collection, id));
    const row = await this.get(collection, id);
    if (!row) return;
    for (const key of uniqueKeys(collection, row as unknown as Record<string, unknown>)) this.pending.set(`_unique/${key}`, null);
    this.pending.set(this.ref(collection, id).path, null);
  }
  async putMany<K extends Collection>(collection: K, rows: Models[K][]): Promise<void> {
    if (!this.tx) return this.transaction(tx => tx.putMany(collection, rows));
    // Each write can acquire/release unique claims used by the next write.
    // Keep the shared transaction buffer ordered to prevent claim races.
    for (const row of rows) await this.put(collection, row);
  }
  async removeMany(collection: Collection, ids: string[]): Promise<void> {
    if (!this.tx) return this.transaction(tx => tx.removeMany(collection, ids));
    for (const id of ids) await this.remove(collection, id);
  }
  async loginAttempt(key: string): Promise<number> {
    if(!/^[0-9a-f]{64}$/.test(key))throw new Error('Invalid rate-limit key.');
    const id=`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
    return this.transaction(async tx => {
      const previous = await tx.get('authRateLimits', id);
      const now = Date.now();
      const fresh = !previous || previous.lastRequest < now - 60000;
      const row = {id,key,count:fresh ? 1 : previous.count + 1,lastRequest:fresh ? now : previous.lastRequest};
      await tx.put('authRateLimits', row);
      return row.count;
    });
  }
}
