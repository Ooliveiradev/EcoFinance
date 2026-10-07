import { createHash } from 'node:crypto';
import type { Database, Models, OwnedCollection } from '@ecofinance/db';
export class FinanceError extends Error {
  constructor(public code:string, public status:number, message:string) {super(message);}
}
export const fail=(code:string,status:number,message:string):never=>{throw new FinanceError(code,status,message);};
function canonical(value:unknown):string {
  if(value===null || typeof value!=='object')return JSON.stringify(value);
  if(value instanceof Date)return JSON.stringify(value.toISOString());
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function revision(row:{revision?:string}) {return row.revision??hash(row);}
export function operationId(ownerId:string,requestId:string) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))fail('INVALID_REQUEST_ID',400,'Envio sem identificador válido.');
  const h=hash([ownerId,requestId.toLowerCase()]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function operation(database:Database,ownerId:string,requestId:string,action:string,input:unknown,callback:(tx:Database)=>Promise<Record<string,unknown>>) {
  const id=operationId(ownerId,requestId), digest=hash([action,input]);
  return database.transaction(async tx=> {
    const previous=await tx.get('operations',id);
    if(previous) {
      if(previous.ownerId!==ownerId || previous.hash!==digest)fail('REQUEST_CONFLICT',409,'O mesmo envio já foi usado com outros dados.');
      return previous.result;
    }
    const result=await callback(tx);
    await tx.put('operations',{id,ownerId,action,hash:digest,result,createdAt:new Date()},true);
    return result;
  });
}
export async function owned<K extends OwnedCollection>(tx:Database,collection:K,id:string,ownerId:string):Promise<Models[K]> {
  const row=await tx.get(collection,id);
  if(!row || row.ownerId!==ownerId)fail('NOT_FOUND',404,'Registro não encontrado.');
  return row!;
}
export function checkRevision(row:{revision?:string},expected:string) {
  if(!expected || revision(row)!==expected)fail('REVISION_CONFLICT',409,'O registro foi alterado. Recarregue antes de salvar.');
}
