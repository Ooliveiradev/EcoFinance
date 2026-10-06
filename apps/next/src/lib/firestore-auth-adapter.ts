import { createAdapterFactory, type CustomAdapter } from '@better-auth/core/db/adapter';
import type { BetterAuthOptions } from 'better-auth';
import type { Collection, Database, Predicate } from '@ecofinance/db';

const models: Record<string, Collection> = {user:'users',session:'authSessions',account:'authAccounts',verification:'authVerifications',rateLimit:'authRateLimits'};
function collection(model: string) {
  const name = models[model];
  if (!name) throw new Error('Unsupported authentication model.');
  return name;
}
function clean(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined)); }

export function firestoreAuthAdapter(database: Database): (options: BetterAuthOptions) => ReturnType<ReturnType<typeof createAdapterFactory>> {
  return options => createAdapterFactory({
    config: {
      adapterId:'ecofinance-firestore', supportsNumericIds:false, supportsUUIDs:false,
      supportsJSON:true, supportsDates:true, supportsBooleans:true, supportsArrays:true,
      transaction: callback => database.transaction(tx => callback(firestoreAuthAdapter(tx)(options))),
    },
    adapter: () => {
      const find = (model: string, where: Predicate[] = [], limit?: number, sortBy?: {field:string;direction:'asc'|'desc'}, offset?: number) => database.query(collection(model), {where,limit,order:sortBy ? [sortBy] : undefined,offset});
      const adapter: CustomAdapter = {
        create: async ({model,data}) => {
          const row = clean(data);
          await database.put(collection(model), row as never, true);
          return row as typeof data;
        },
        findOne: async <T>({model,where}: {model:string;where:Predicate[]}) => (await find(model,where,1))[0] as T ?? null,
        findMany: async <T>({model,where,limit,sortBy,offset}: {model:string;where?:Predicate[];limit:number;sortBy?:{field:string;direction:'asc'|'desc'};offset?:number}) => await find(model,where,limit,sortBy,offset) as T[],
        count: async ({model,where}) => (await find(model,where)).length,
        update: async <T>({model,where,update}: {model:string;where:Predicate[];update:T}) => {
          if (!where.length) return null;
          return database.transaction(async tx => {
            const [previous] = await tx.query(collection(model), {where,limit:1});
            if (!previous) return null;
            const row = {...previous,...clean(update as Record<string,unknown>)};
            await tx.put(collection(model),row as never);
            return row as T;
          });
        },
        updateMany: async ({model,where,update}) => database.transaction(async tx => {
          const rows = await tx.query(collection(model),{where});
          for (const row of rows) await tx.put(collection(model), {...row,...clean(update)} as never);
          return rows.length;
        }),
        delete: async ({model,where}) => database.transaction(async tx => {
          if (!where.length) return;
          const [row] = await tx.query(collection(model),{where,limit:1});
          if (row) await tx.remove(collection(model),row.id);
        }),
        deleteMany: async ({model,where}) => database.transaction(async tx => {
          const rows = await tx.query(collection(model),{where});
          for (const row of rows) await tx.remove(collection(model),row.id);
          return rows.length;
        }),
        consumeOne: async <T>({model,where}: {model:string;where:Predicate[]}) => database.transaction(async tx => {
          const [row] = await tx.query(collection(model),{where,limit:1});
          if (!row) return null;
          await tx.remove(collection(model),row.id);
          return row as T;
        }),
        incrementOne: async <T>({model,where,increment,set}: {model:string;where:Predicate[];increment:Record<string,number>;set?:Record<string,unknown>}) => database.transaction(async tx => {
          const [previous] = await tx.query(collection(model),{where,limit:1});
          if (!previous) return null;
          const row: Record<string,unknown> = {...previous,...set};
          for (const [key,delta] of Object.entries(increment)) {
            if (typeof row[key] !== 'number' || !Number.isSafeInteger(Number(row[key])+delta)) throw new Error('Invalid counter.');
            row[key] = Number(row[key])+delta;
          }
          await tx.put(collection(model),row as never);
          return row as T;
        }),
      };
      return adapter;
    },
  })(options);
}
