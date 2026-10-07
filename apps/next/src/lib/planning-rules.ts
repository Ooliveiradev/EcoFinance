import { randomUUID } from 'node:crypto';
import type { Database,Models } from '@ecofinance/db';
import { planningMonthSchema,ruleChangeSchema,scheduleForMonth,scheduledDueDate,centsToMoney,moneyToCents,type RecurrenceSchedule,type ScheduleVersion } from '@ecofinance/shared';
import { operation,owned,checkRevision,fail } from './finance-operation';
import { assertMonthOpen,stableId,touchMonth,touchMonths } from './planning-lock';
export function legacySchedule(rule:Models['recurrenceRules']):RecurrenceSchedule {
  const amount=moneyToCents(rule.amount);
  return {accountId:rule.accountId,categoryId:rule.categoryId,description:rule.description,amount:centsToMoney(amount<0n?-amount:amount),startDate:rule.startDate,endDate:rule.endDate,dueDay:rule.dueDay,estimated:rule.estimated,reminderDays:null,paused:rule.archivedAt!==null};
}
export function ruleVersions(rule:Models['recurrenceRules']):ScheduleVersion[] {
  return rule.versions??[{fromMonth:rule.startDate.slice(0,7),schedule:legacySchedule(rule)}];
}
export function occurrenceSnapshot(row:Models['recurrenceOccurrences'],rule:Models['recurrenceRules']):RecurrenceSchedule {
  return row.snapshot??legacySchedule(rule);
}
export async function activeScheduleReferences(tx:Database,ownerId:string,schedule:RecurrenceSchedule,old?:RecurrenceSchedule) {
  const [account,category]=await Promise.all([owned(tx,'accounts',schedule.accountId,ownerId),owned(tx,'categories',schedule.categoryId,ownerId)]);
  if(account.archivedAt && schedule.accountId!==old?.accountId || category.archivedAt && schedule.categoryId!==old?.categoryId)fail('ARCHIVED_REFERENCE',409,'Escolha conta e categoria ativas.');
}
export async function saveRule(db:Database,ownerId:string,requestId:string,input:unknown,id?:string,expected='') {
  const data=ruleChangeSchema.parse(input),{schedule,fromMonth}=data;
  if(fromMonth<schedule.startDate.slice(0,7))fail('INVALID_START',400,'O mês de início da versão deve acompanhar o início da recorrência.');
  return operation(db,ownerId,requestId,'save-recurrence',{data,id:id??null,expected},async tx=>{
    await assertMonthOpen(tx,ownerId,fromMonth);
    const old=id?await owned(tx,'recurrenceRules',id,ownerId):null;
    if(old)checkRevision(old,expected);
    const closed=await tx.owned('planningMonths',ownerId,{where:[{field:'competenceMonth',op:'gte',value:fromMonth+'-01'},{field:'closedAt',op:'ne',value:null}],limit:1});
    if(old&&closed.length)fail('MONTH_CLOSED',409,'A alteração alcança um mês fechado. Escolha um mês posterior ou reabra o período.');
    const previous=old?scheduleForMonth(ruleVersions(old),fromMonth)??legacySchedule(old):undefined;
    await activeScheduleReferences(tx,ownerId,schedule,previous);
    if(!old&&(await tx.owned('recurrenceRules',ownerId,{limit:100})).length>=100)fail('PLAN_TOO_LARGE',409,'O planejamento suporta até 100 recorrências.');
    const allOccurrences=old?await tx.owned('recurrenceOccurrences',ownerId,{where:[{field:'ruleId',value:old.id}]}):[];
    const occurrences=allOccurrences.filter(o=>o.competenceMonth>=fromMonth+'-01');
    if(occurrences.length>100)fail('PLAN_TOO_LARGE',409,'Altere até 100 ocorrências futuras por vez. Escolha um mês mais recente.');
    const existing=old?ruleVersions(old).filter(v=>v.fromMonth<fromMonth):[];
    if(existing.length>=120)fail('PLAN_TOO_LARGE',409,'Limite de versões desta recorrência atingido.');
    const base=old??{accountId:schedule.accountId,categoryId:schedule.categoryId,description:schedule.description,amount:schedule.amount,startDate:schedule.startDate,endDate:schedule.endDate,dueDay:schedule.dueDay,estimated:schedule.estimated};
    const now=new Date(),row={...base,id:old?.id??randomUUID(),ownerId,currency:'BRL',archivedAt:null,createdAt:old?.createdAt??now,updatedAt:now,versions:[...existing,{fromMonth,schedule}],revision:randomUUID()};
    const changes=occurrences.filter(o=>o.status!=='paid'&&!o.overridden).map(o=>{
      const due=scheduledDueDate(schedule,o.competenceMonth.slice(0,7));
      return {...o,amount:schedule.amount,dueDate:due??o.dueDate,status:due?'pending' as const:'cancelled' as const,snapshot:schedule,revision:randomUUID(),updatedAt:now};
    });
    if(changes.length>60)fail('PLAN_TOO_LARGE',409,'Altere até 60 previsões por envio. Escolha um mês mais recente.');
    await tx.put('recurrenceRules',row,!old);
    await tx.putMany('recurrenceOccurrences',changes);
    await touchMonths(tx,ownerId,[fromMonth,...changes.map(o=>o.competenceMonth.slice(0,7))]);
    return {id:row.id,revision:row.revision,updated:changes.length};
  });
}
export async function generateMonth(db:Database,ownerId:string,requestId:string,month:string) {
  planningMonthSchema.parse(month);
  return operation(db,ownerId,requestId,'generate-month',{month},async tx=>{
    await assertMonthOpen(tx,ownerId,month);
    const [rules,existing]=await Promise.all([tx.owned('recurrenceRules',ownerId,{limit:101}),tx.owned('recurrenceOccurrences',ownerId,{where:[{field:'competenceMonth',value:month+'-01'}]})]);
    if(rules.length>100)fail('PLAN_TOO_LARGE',409,'O planejamento suporta até 100 recorrências.');
    const seen=new Set(existing.map(o=>o.ruleId)),now=new Date();
    const additions:Models['recurrenceOccurrences'][]=[];
    for(const rule of rules) {
      const schedule=scheduleForMonth(ruleVersions(rule),month),due=schedule?scheduledDueDate(schedule,month):null;
      if(!schedule || !due || seen.has(rule.id))continue;
      await activeScheduleReferences(tx,ownerId,schedule);
      additions.push({id:stableId(['occurrence',ownerId,rule.id,month]),ownerId,ruleId:rule.id,competenceMonth:month+'-01',dueDate:due,amount:schedule.amount,status:'pending',snapshot:schedule,overridden:false,transactionId:null,revision:randomUUID(),createdAt:now,updatedAt:now});
    }
    await tx.putMany('recurrenceOccurrences',additions);
    await touchMonth(tx,ownerId,month);
    return {id:month,revision:randomUUID(),created:additions.length};
  });
}
