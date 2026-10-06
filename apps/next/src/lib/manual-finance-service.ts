import { createHash, randomUUID } from 'node:crypto';
import { manualAccountSchema, manualCategorySchema, manualEntrySchema, manualListSchema, moneyToCents, centsToMoney, type ManualEntry } from '@ecofinance/shared';
import type { Database, Models, OwnedCollection, Predicate } from '@ecofinance/db';

export class FinanceError extends Error {
  constructor(public code:string, public status:number, message:string) {super(message);}
}
const fail=(code:string,status:number,message:string):never=>{throw new FinanceError(code,status,message);};
function canonical(value:unknown):string {
  if(value===null || typeof value!=='object')return JSON.stringify(value);
  if(value instanceof Date)return JSON.stringify(value.toISOString());
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
export function revision(row:{revision?:string}) {return row.revision??hash(row);}
function operationId(ownerId:string,requestId:string) {
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))fail('INVALID_REQUEST_ID',400,'Envio sem identificador válido.');
  const h=hash([ownerId,requestId.toLowerCase()]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function operation(database:Database,ownerId:string,requestId:string,action:string,input:unknown,callback:(tx:Database)=>Promise<Record<string,unknown>>) {
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
async function owned<K extends OwnedCollection>(tx:Database,collection:K,id:string,ownerId:string):Promise<Models[K]> {
  const row=await tx.get(collection,id);
  if(!row || row.ownerId!==ownerId)fail('NOT_FOUND',404,'Registro não encontrado.');
  return row!;
}
function checkRevision(row:{revision?:string},expected:string) {
  if(!expected || revision(row)!==expected)fail('REVISION_CONFLICT',409,'O registro foi alterado. Recarregue antes de salvar.');
}
export async function saveAccount(database:Database,ownerId:string,requestId:string,input:unknown,id?:string,expected='') {
  const data=manualAccountSchema.parse(input);
  return operation(database,ownerId,requestId,'save-account',{data,id:id??null,expected},async tx=> {
    const old=id?await owned(tx,'accounts',id,ownerId):null;
    if(old)checkRevision(old,expected);
    const now=new Date(), row={id:old?.id??randomUUID(),ownerId,name:data.name,type:data.type,currency:'BRL',openingBalance:data.openingBalance,openingDate:data.openingDate,color:data.color,sortOrder:data.sortOrder,revision:randomUUID(),balance:old?.balance??'0.00',archivedAt:old?.archivedAt??null,pluggyAccountId:old?.pluggyAccountId??null,pluggyItemId:old?.pluggyItemId??null,createdAt:old?.createdAt??now,updatedAt:now};
    await tx.put('accounts',row,!old);
    return {id:row.id,revision:row.revision};
  });
}
export async function saveCategory(database:Database,ownerId:string,requestId:string,input:unknown,id?:string,expected='') {
  const data=manualCategorySchema.parse(input);
  return operation(database,ownerId,requestId,'save-category',{data,id:id??null,expected},async tx=> {
    const old=id?await owned(tx,'categories',id,ownerId):null;
    if(old)checkRevision(old,expected);
    const now=new Date(),row={...data,id:old?.id??randomUUID(),ownerId,legacyKey:old?.legacyKey??null,archivedAt:old?.archivedAt??null,revision:randomUUID(),createdAt:old?.createdAt??now,updatedAt:now};
    await tx.put('categories',row,!old);
    return {id:row.id,revision:row.revision};
  });
}
export async function archiveReference(database:Database,ownerId:string,requestId:string,collection:'accounts'|'categories',id:string,expected:string,archived:boolean) {
  return operation(database,ownerId,requestId,'archive-'+collection,{id,expected,archived},async tx=> {
    const old=await owned(tx,collection,id,ownerId);checkRevision(old,expected);
    const row={...old,archivedAt:archived?new Date():null,updatedAt:new Date(),revision:randomUUID()};
    await tx.put(collection,row as never);
    return {id,revision:row.revision};
  });
}
async function pair(tx:Database,ownerId:string,row:Models['transactions']) {
  if(!row.transferId) {
    if(row.kind==='transfer')fail('TRANSFER_CONFLICT',409,'Transferência legada sem vínculo: reconcilie as duas pontas antes de alterá-la.');
    return [row];
  }
  const rows=await tx.owned('transactions',ownerId,{where:[{field:'transferId',value:row.transferId}],limit:3});
  if(rows.length!==2 || rows.some(r=>r.kind!=='transfer') || rows[0]!.accountId===rows[1]!.accountId || rows.reduce((sum,r)=>sum+moneyToCents(r.amount),0n)!==0n)fail('TRANSFER_CONFLICT',409,'As duas pontas da transferência precisam ser conciliadas.');
  if(rows.some(r=>revision(r)!==revision(row)))fail('TRANSFER_CONFLICT',409,'A transferência foi alterada. Recarregue.');
  return rows;
}
async function activeReference(tx:Database,collection:'accounts'|'categories',id:string,ownerId:string,original?:string) {
  const row=await owned(tx,collection,id,ownerId);
  if(row.archivedAt!==null && original!==id)fail('ARCHIVED_REFERENCE',409,'Escolha uma conta e categoria ativas.');
  return row;
}
const legacyKeys=['comida','transporte','assinaturas','lazer','saude','educacao','moradia','salario','investimento','transferencia','desconhecido'];
function entryRow(ownerId:string,data:ManualEntry,accountId:string,amount:string,category:Models['categories'],now:Date,id:string,version:string,requestId:string,old?:Models['transactions'],transferId:string|null=null):Models['transactions'] {
  return {...old,id,ownerId,accountId,categoryId:category.id,description:data.description,amount,kind:data.kind,status:data.status,currency:'BRL',purchaseDate:data.purchaseDate,competenceMonth:data.competenceMonth,dueDate:data.dueDate,paidDate:data.status==='settled'?data.paidDate:null,reviewRequired:false,notes:data.notes,transferId,revision:version,archivedAt:null,invoiceId:old?.invoiceId??null,installmentId:old?.installmentId??null,recurrenceOccurrenceId:old?.recurrenceOccurrenceId??null,date:new Date(data.purchaseDate+'T12:00:00Z'),category:(legacyKeys.includes(category.legacyKey??'')?category.legacyKey:'desconhecido') as Models['transactions']['category'],source:old?.source??'manual',externalId:old?.externalId??'manual:'+requestId,latitude:old?.latitude??null,longitude:old?.longitude??null,uberMetadataId:old?.uberMetadataId??null,createdAt:old?.createdAt??now,updatedAt:now};
}
export async function saveEntry(database:Database,ownerId:string,requestId:string,input:unknown,id?:string,expected='') {
  const data=manualEntrySchema.parse(input);
  return operation(database,ownerId,requestId,'save-entry',{data,id:id??null,expected},async tx=> {
    const old=id?await owned(tx,'transactions',id,ownerId):null;
    if(old) {
      checkRevision(old,expected);
      if(old.archivedAt!==null)fail('ARCHIVED_ENTRY',409,'Restaure o lançamento antes de editar.');
      if(old.invoiceId || old.installmentId || old.recurrenceOccurrenceId)fail('LINKED_ENTRY',409,'Edite este vínculo pelo fluxo de cartão ou recorrência.');
      if((old.kind==='transfer')!==(data.kind==='transfer'))fail('KIND_CONFLICT',409,'Para mudar entre transferência e receita/despesa, exclua e crie outro lançamento.');
    }
    const rows=old?await pair(tx,ownerId,old):[];
    const originalOut=rows.find(r=>moneyToCents(r.amount)<0n)??old;
    const originalIn=rows.find(r=>moneyToCents(r.amount)>0n);
    await activeReference(tx,'accounts',data.accountId,ownerId,originalOut?.accountId);
    if(data.toAccountId)await activeReference(tx,'accounts',data.toAccountId,ownerId,originalIn?.accountId);
    const category=await activeReference(tx,'categories',data.categoryId,ownerId,old?.categoryId) as Models['categories'];
    const now=new Date(),version=randomUUID(),magnitude=moneyToCents(data.amount);
    const transferId=data.kind==='transfer'?(old?.transferId??randomUUID()):null;
    const outgoing=entryRow(ownerId,data,data.accountId,centsToMoney(data.kind==='income'?magnitude:-magnitude),category,now,originalOut?.id??randomUUID(),version,requestId,originalOut??undefined,transferId);
    const next=[outgoing];
    if(data.kind==='transfer')next.push(entryRow(ownerId,data,data.toAccountId!,centsToMoney(magnitude),category,now,originalIn?.id??randomUUID(),version,requestId,originalIn,transferId));
    await tx.putMany('transactions',next);
    return {id:outgoing.id,ids:next.map(r=>r.id),revision:version};
  });
}
export async function archiveEntry(database:Database,ownerId:string,requestId:string,id:string,expected:string,archived:boolean) {
  return operation(database,ownerId,requestId,'archive-entry',{id,expected,archived},async tx=> {
    const old=await owned(tx,'transactions',id,ownerId);checkRevision(old,expected);
    if(old.invoiceId || old.installmentId || old.recurrenceOccurrenceId)fail('LINKED_ENTRY',409,'Edite este vínculo pelo fluxo de cartão ou recorrência.');
    const rows=await pair(tx,ownerId,old),now=new Date(),version=randomUUID();
    await tx.putMany('transactions',rows.map(row=>({...row,archivedAt:archived?now:null,updatedAt:now,revision:version})));
    return {id,ids:rows.map(r=>r.id),revision:version};
  });
}
export async function listEntries(database:Database,ownerId:string,input:unknown) {
  const q=manualListSchema.parse(input),where:Predicate[]=[{field:'archivedAt',op:q.archived==='true'?'ne':'eq',value:null}];
  for(const key of ['id','accountId','categoryId','kind','status','competenceMonth'] as const)if(q[key])where.push({field:key,value:q[key]});
  if(q.startDate)where.push({field:'purchaseDate',op:'gte',value:q.startDate});
  if(q.endDate)where.push({field:'purchaseDate',op:'lte',value:q.endDate});
  if(q.description)where.push({field:'description',op:'contains',value:q.description,mode:'insensitive'});
  const rows=await database.owned('transactions',ownerId,{where,order:[{field:'purchaseDate',direction:'desc'},{field:'id',direction:'desc'}],offset:(q.page-1)*q.limit,limit:q.limit+1});
  const entries=await Promise.all(rows.slice(0,q.limit).map(async row=> {
    const [account,category,linked]=await Promise.all([
      owned(database,'accounts',row.accountId,ownerId),owned(database,'categories',row.categoryId,ownerId),
      row.transferId?database.owned('transactions',ownerId,{where:[{field:'transferId',value:row.transferId}],limit:3}):Promise.resolve([]),
    ]);
    return {...publicEntry(row),accountName:account.name,categoryName:category.name,categoryColor:category.color,transferFromAccountId:linked.find(r=>moneyToCents(r.amount)<0n)?.accountId??null,toAccountId:linked.find(r=>moneyToCents(r.amount)>0n)?.accountId??null};
  }));
  return {entries,page:q.page,hasMore:rows.length>q.limit};
}
export function publicEntry(row:Models['transactions']) {
  const {id,accountId,categoryId,description,amount,kind,status,purchaseDate,competenceMonth,dueDate,paidDate,archivedAt,source}=row;
  return {id,accountId,categoryId,description,amount,kind,status,purchaseDate,date:purchaseDate,competenceMonth,dueDate,paidDate,archivedAt:archivedAt?.toISOString()??null,source,category:row.category,notes:row.notes??null,transferId:row.transferId??null,revision:revision(row)};
}
export function publicAccount(row:Models['accounts']) {
  const {id,name,type,currency,openingBalance,openingDate,archivedAt}=row;
  return {id,name,type,currency,openingBalance,openingDate,archivedAt:archivedAt?.toISOString()??null,color:row.color??'#64748b',sortOrder:row.sortOrder??0,revision:revision(row)};
}
export function publicCategory(row:Models['categories']) {
  const {id,name,color,icon,sortOrder,archivedAt}=row;
  return {id,name,color,icon,sortOrder,archivedAt:archivedAt?.toISOString()??null,revision:revision(row)};
}
