import { Timestamp } from 'firebase-admin/firestore';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import * as finance from './schema';
import * as auth from './auth-schema';
import { buildSnapshot, validateSnapshot, type PortableRow, type PortableSnapshot, snapshotCatalog } from './portable-snapshot';
import { collections, type DocumentStore } from './firestore';
import type { Collection } from './models';
import { uniqueKeys, validateDocument } from './firestore-validation';

const mappings = Object.entries({...finance,...auth} as Record<string,unknown>).filter((entry): entry is [string,PgTable]=>is(entry[1],PgTable)).map(([key,table])=>({collection:key as Collection,table:getTableConfig(table).name,columns:Object.entries(table).filter(([,v])=>v && typeof v==='object' && 'name' in v).map(([key,v])=>({key,name:(v as {name:string}).name}))}));
function canonical(value: unknown): string {
  if (value===null || typeof value!=='object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
const hash=(v:unknown)=>createHash('sha256').update(canonical(v)).digest('hex');
function timestamp(value: string) {
  const milliseconds=Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error('Invalid source timestamp.');
  const seconds=Math.floor(milliseconds/1000);
  const fraction=/\.(\d{1,6})(?:\+00|Z)$/.exec(value)?.[1]??'';
  return new Timestamp(seconds,Number(fraction.padEnd(9,'0')));
}
function normalizedDecimal(value:string) {
  const match=/^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if(!match)throw new Error('Invalid JSON numeric value.');
  let digits=(match[2]!+(match[3]??'')).replace(/^0+/,'');
  let exponent=Number(match[4]??0)-(match[3]?.length??0);
  if(!digits)return '0';
  while(digits.endsWith('0')) {digits=digits.slice(0,-1);exponent++;}
  return match[1]+digits+'e'+exponent;
}
function exactJson(value:string):unknown {
  return JSON.parse(value,(_key,v,context?:{source:string})=> {
    if(typeof v==='number' && (!Number.isFinite(v) || !context || normalizedDecimal(context.source)!==normalizedDecimal(String(v))))throw new Error('JSON number cannot be represented exactly in Firestore; conversion refused.');
    return v;
  });
}
export function portableDocument(table: string, row: PortableRow): Record<string,unknown> {
  const mapping=mappings.find(m=>m.table===table);
  const catalog=snapshotCatalog.find(t=>t.name===table);
  if (!mapping || !catalog) throw new Error('Unknown source table.');
  return Object.fromEntries(Object.entries(row).map(([name,value])=> {
    const column=catalog.columns.find(c=>c.name===name)!;
    const key=mapping.columns.find(c=>c.name===name)?.key??name;
    if (value===null) return [key,null];
    if (column.type.startsWith('timestamp')) return [key,timestamp(String(value))];
    if (column.type==='bigint') {const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('Counter precision overflow.');return [key,n];}
    if (column.type==='jsonb') return [key,exactJson(String(value))];
    return [key,value];
  }));
}
type Encoded = null | boolean | string | number | {type:'timestamp';seconds:number;nanoseconds:number} | {type:'array';values:Encoded[]} | {type:'map';values:Record<string,Encoded>};
function encode(value: unknown): Encoded {
  if (value instanceof Timestamp) return {type:'timestamp',seconds:value.seconds,nanoseconds:value.nanoseconds};
  if (value===null || typeof value==='string' || typeof value==='boolean') return value;
  if (typeof value==='number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return {type:'array',values:value.map(encode)};
  if (value && typeof value==='object') return {type:'map',values:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)]))};
  throw new Error('Unsupported backup value.');
}
function decode(value: Encoded): unknown {
  if (value===null || typeof value!=='object') return value;
  if (value.type==='timestamp') return new Timestamp(value.seconds,value.nanoseconds);
  if (value.type==='array') return value.values.map(decode);
  if (value.type==='map') return Object.fromEntries(Object.entries(value.values).map(([k,v])=>[k,decode(v)]));
  throw new Error('Invalid backup value.');
}
const backupCollections=[...collections,'_unique','_migration'];
interface BackupRow { path:string; data:Encoded }
export interface FirebaseBackup {format:'ecofinance-firestore-v1';records:BackupRow[];sha256:string}
// Deliberately atomic for this empty-source cutover. Larger production databases
// use managed Firestore exports instead of silently splitting this transaction.
const MAX_DOCUMENTS=400;
function checkSize(records: BackupRow[]) {
  if(records.length>MAX_DOCUMENTS || Buffer.byteLength(canonical(records))>8*1024*1024) throw new Error('Atomic migration/backup limit exceeded; use managed export.');
  if(records.some(r=>Buffer.byteLength(canonical(r.data))>900000)) throw new Error('Document exceeds migration size limit.');
}
function sourceRecords(snapshot: PortableSnapshot): BackupRow[] {
  validateSnapshot(snapshot);
  const records=mappings.flatMap(mapping=>snapshot.tables[mapping.table]!.rows.map(row=>({path:`${mapping.collection}/${row.id}`,data:encode(portableDocument(mapping.table,row))})));
  for(const record of [...records]) {
    const row=decode(record.data) as Record<string,unknown>;
    const collection=record.path.split('/')[0] as Collection;
    validateDocument(collection,row);
    for(const key of uniqueKeys(collection,row)) {
      records.push({path:`_unique/${key}`,data:encode({path:record.path})});
    }
  }
  records.push({path:'_migration/source',data:encode({schema:snapshot.schema,sourceHash:hash(snapshot.tables),history:snapshot.migrationHistory})});
  checkSize(records);
  if(new Set(records.map(r=>r.path)).size!==records.length)throw new Error('Duplicate source identity/unique value.');
  return records.sort((a,b)=>a.path.localeCompare(b.path));
}
async function readRecords(store: DocumentStore): Promise<BackupRow[]> {
  return store.firestore.runTransaction(async tx=> {
    const records:BackupRow[]=[];
    for(const collection of backupCollections) {
      const snapshot=await tx.execute(store.firestore.pipeline().collection(collection).limit(MAX_DOCUMENTS+1));
      for(const result of snapshot.results) {
        if(!result.ref)throw new Error('Backup result missing document reference.');
        records.push({path:result.ref.path,data:encode(result.data())});
      }
    }
    checkSize(records);
    return records.sort((a,b)=>a.path.localeCompare(b.path));
  },{readOnly:true});
}
async function importRecords(store: DocumentStore, records: BackupRow[]) {
  checkSize(records);
  if(new Set(records.map(r=>r.path)).size!==records.length)throw new Error('Duplicate backup identity.');
  for(const record of records) {
    if(!/^[^/]+\/[^/]+$/.test(record.path) || !backupCollections.includes(record.path.split('/')[0]!)) throw new Error('Invalid backup path.');
    const data=decode(record.data);
    if (!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Invalid backup document.');
  }
  await store.firestore.runTransaction(async tx=> {
    const existing:BackupRow[]=[];
    for(const collection of backupCollections) {
      const snapshot=await tx.execute(store.firestore.pipeline().collection(collection).limit(MAX_DOCUMENTS+1));
      for(const result of snapshot.results) existing.push({path:result.ref!.path,data:encode(result.data())});
    }
    if(existing.length) {
      if(hash(existing.sort((a,b)=>a.path.localeCompare(b.path)))===hash(records))return;
      throw new Error('Destination is not empty or differs from the requested snapshot.');
    }
    for(const record of records) tx.create(store.firestore.doc(record.path),decode(record.data) as Record<string,unknown>);
  });
  const result=await readRecords(store);
  if(hash(result)!==hash(records))throw new Error('Destination reconciliation failed.');
}
export async function migrateToFirebase(store:DocumentStore,input:unknown) {
  validateSnapshot(input);
  await importRecords(store,sourceRecords(input));
}
export async function backupFirebase(store:DocumentStore):Promise<FirebaseBackup> {
  const records=await readRecords(store);
  return {format:'ecofinance-firestore-v1',records,sha256:hash(records)};
}
export async function restoreFirebase(store:DocumentStore,input:unknown) {
  const backup=input as FirebaseBackup;
  if(!backup || backup.format!=='ecofinance-firestore-v1' || !Array.isArray(backup.records) || hash(backup.records)!==backup.sha256)throw new Error('Invalid Firebase backup.');
  await importRecords(store,backup.records);
}
// Current writes are included: this is not a return to an old source snapshot.
export async function exportPortableFirebase(store:DocumentStore):Promise<PortableSnapshot> {
  const records=await readRecords(store);
  if(records.some(r=>r.path.startsWith('operations/') || r.path.startsWith('planningMonths/')))throw new Error('Database uses manual-finance schema v2; use native Firebase backup. Legacy SQL export would lose operation history.');
  const rows:Record<string,PortableRow[]>={};
  for(const mapping of mappings) {
    const catalog=snapshotCatalog.find(t=>t.name===mapping.table)!;
    rows[mapping.table]=records.filter(r=>r.path.startsWith(mapping.collection+'/')).map(record=> {
      const document=decode(record.data) as Record<string,unknown>;
      const allowed=new Set(catalog.columns.map(column=>mapping.columns.find(c=>c.name===column.name)?.key??column.name));
      if(Object.keys(document).some(key=>!allowed.has(key)))throw new Error('Database has fields unsupported by legacy SQL; use native Firebase backup.');
      return Object.fromEntries(catalog.columns.map(column=> {
        const key=mapping.columns.find(c=>c.name===column.name)?.key??column.name;
        const value=document[key]??null;
        if(value instanceof Timestamp) {
          const prefix=new Date(value.seconds*1000).toISOString().slice(0,19).replace('T',' ');
          if(value.nanoseconds%1000!==0)throw new Error('Timestamp precision exceeds PostgreSQL; rollback refused.');
          const micro=String(value.nanoseconds/1000).padStart(6,'0').replace(/0+$/,'');
          return [column.name,prefix+(micro?'.'+micro:'')+'+00'];
        }
        if(value!==null && column.type==='jsonb')return [column.name,JSON.stringify(value)];
        if(value!==null && column.type==='bigint')return [column.name,String(value)];
        if(value!==null && column.type.startsWith('numeric')) {
          const [whole,fraction='']=String(value).split('.');
          return [column.name,whole+'.'+fraction.padEnd(2,'0')];
        }
        return [column.name,value];
      })) as PortableRow;
    });
  }
  const source=records.find(r=>r.path==='_migration/source');
  const history=source ? (decode(source.data) as {history:PortableSnapshot['migrationHistory']}).history : [];
  return buildSnapshot(rows,history);
}
export function emptySourceSnapshot() { return buildSnapshot(Object.fromEntries(snapshotCatalog.map(table=>[table.name,[]]))); }
