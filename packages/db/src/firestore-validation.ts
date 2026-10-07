import { scheduleSchema,planningMonthSchema } from '@ecofinance/shared';
import catalog from './firestore-catalog.json';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import type { Collection } from './models';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function civil(value:unknown) { return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value; }
function requireValue(valid:boolean) { if(!valid)throw new Error('Invalid document invariant.'); }
export function validateDocument(collection:Collection,row:Record<string,unknown>) {
  for(const column of catalog[collection].columns) {
    const value=row[column.key];
    if(value==null) {requireValue(column.nullable);continue;}
    if(column.type==='uuid')requireValue(typeof value==='string' && uuid.test(value));
    else if(column.type.startsWith('numeric'))requireValue(typeof value==='string' && /^-?\d{1,13}(?:\.\d{1,2})?$/.test(value));
    else if(column.type==='date')requireValue(civil(value));
    else if(column.type.startsWith('timestamp'))requireValue(value instanceof Timestamp || value instanceof Date && !Number.isNaN(value.getTime()));
    else if(['integer','bigint'].includes(column.type))requireValue(typeof value==='number' && Number.isSafeInteger(value) && (column.type!=='integer' || value>=-2147483648 && value<=2147483647));
    else if(column.type==='double precision')requireValue(typeof value==='number' && Number.isFinite(value));
    else if(column.type==='boolean')requireValue(typeof value==='boolean');
    else if(column.type==='jsonb')requireValue(typeof value==='object');
    else requireValue(typeof value==='string');
  }
  if('currency' in row && row.currency!==null)requireValue(row.currency==='BRL');
  if('competenceMonth' in row && row.competenceMonth!==null)requireValue(String(row.competenceMonth).endsWith('-01'));
  if(collection==='users' && row.email!=null)requireValue(typeof row.email==='string' && row.email===row.email.trim().toLowerCase() && row.email.length>=3 && row.email.length<=254);
  const days=['dueDay','closingDay'].filter(key=>key in row);
  for(const key of days)requireValue(Number(row[key])>=1 && Number(row[key])<=31);
  if(collection==='categories')requireValue(typeof row.name==='string' && row.name.trim().length>=1 && row.name.trim().length<=120 && /^#[0-9a-f]{6}$/i.test(String(row.color)));
  if(collection==='accounts')requireValue(['banco','carteira'].includes(String(row.type)));
  if(collection==='accounts' && row.color!=null)requireValue(/^#[0-9a-f]{6}$/i.test(String(row.color)));
  if(['accounts','categories'].includes(collection) && row.sortOrder!=null)requireValue(Number(row.sortOrder)>=0);
  if(collection==='transactions' && row.notes!=null)requireValue(typeof row.notes==='string' && row.notes.length<=2000);
  if(collection==='operations')requireValue(typeof row.action==='string' && row.action.length<=80 && /^[0-9a-f]{64}$/.test(String(row.hash)));
  if(collection==='transactions') {
    requireValue(['income','expense','transfer','refund','adjustment','unclassified'].includes(String(row.kind)) && ['planned','recorded','settled','cancelled'].includes(String(row.status)));
    const amount=Number(row.amount);
    requireValue(row.kind==='unclassified'?row.reviewRequired===true:amount!==0 && (row.kind!=='expense'||amount<0) && (!['income','refund'].includes(String(row.kind))||amount>0));
    requireValue(row.status!=='settled'||row.paidDate!=null);
    requireValue(['comida','transporte','assinaturas','lazer','saude','educacao','moradia','salario','investimento','transferencia','desconhecido'].includes(String(row.category)));
    requireValue(['notification','pluggy','ofx','manual','uber','csv','spreadsheet','document','email'].includes(String(row.source)));
    if(row.cardEntryType!=null) {
      requireValue(row.invoiceId!=null && ['purchase','interest','fee','credit','refund','payment'].includes(String(row.cardEntryType)));
      requireValue(row.cardEntryType==='payment'?row.kind==='adjustment'&&amount<0&&row.status==='settled':row.status==='recorded'&&row.paidDate==null);
      requireValue(['credit','refund'].includes(String(row.cardEntryType))?row.kind==='refund':row.cardEntryType==='payment'||row.kind==='expense');
      requireValue((row.cardEntryType==='refund')===(row.refundOfId!=null));
    }
    if(row.reconciledIntoId!=null)requireValue(row.archivedAt!=null && row.reconciledIntoId!==row.id);
  }
  if(collection==='recurrenceRules' && row.versions!=null) {
    requireValue(Array.isArray(row.versions) && row.versions.length>0 && row.versions.length<=120);
    let previous='';
    for(const version of row.versions as {fromMonth:string;schedule:unknown}[]) {planningMonthSchema.parse(version.fromMonth);requireValue(version.fromMonth>previous);previous=version.fromMonth;scheduleSchema.parse(version.schedule);}
  }
  if(collection==='recurrenceOccurrences' && row.snapshot!=null)scheduleSchema.parse(row.snapshot);
  if(collection==='recurrenceRules')requireValue(row.endDate==null||String(row.endDate)>=String(row.startDate));
  if(collection==='recurrenceOccurrences')requireValue(['pending','paid','postponed','cancelled'].includes(String(row.status)));
  if(collection==='invoices') {requireValue(['open','closed','partial','paid'].includes(String(row.status)));if(row.closed!=null)requireValue(String(row.dueDate)>String(row.closingDate));}
  if(collection==='importBatches')requireValue(['received','processing','review','confirmed','failed','cancelled','reverted'].includes(String(row.state)));
  if(collection==='importItems')requireValue(Number(row.position)>0 && ['pending','valid','invalid','excluded','committed'].includes(String(row.state)));
  if(collection==='budgets')for(const key of ['limit','expectedIncome','reserve'])requireValue(Number(row[key])>=0);
  if(collection==='budgetCategories')requireValue(Number(row.limit)>=0);
  if(collection==='installmentGroups')requireValue(Number(row.count)>=1 && Number(row.count)<=600 && Number(row.totalAmount)>0);
  if(collection==='installments')requireValue(Number(row.number)>=1 && Number(row.number)<=600 && Number(row.amount)>0);
}
export function uniqueKeys(collection: Collection,row:Record<string,unknown>) {
  return catalog[collection].unique.filter(keys=>keys.every(key=>row[key]!=null)).map(keys=>createHash('sha256').update(JSON.stringify([collection,keys.map(key=>row[key])])).digest('hex'));
}
export const references=(collection:Collection)=>catalog[collection].refs;
