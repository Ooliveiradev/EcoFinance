import { shiftMonth,monthlyDueDate,moneyToCents } from '../../packages/shared/src';
import { randomUUID } from 'node:crypto';
import { test,expect,type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
const db=e2eDatabase(),origin='http://127.0.0.1:3000';
test.setTimeout(90000);
test.beforeEach(async()=>{await clearTestCollections(db,['authRateLimits']);});
test.afterAll(async()=>{await db.firestore.terminate();});
async function login(request:APIRequestContext,email='a@example.test') {expect((await request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password:TEST_PASSWORD}})).status()).toBe(200);}
const headers=()=>({origin,'idempotency-key':randomUUID()});
async function reference(request:APIRequestContext,name:string) {
  const response=await request.post('/api/accounts',{headers:headers(),data:{name,type:'carteira',openingBalance:'1000.00',openingDate:'2030-01-01'}});expect(response.status()).toBe(201);
  const categoryResponse=await request.post('/api/categories',{headers:headers(),data:{name:'Fixas '+name,color:'#336699'}});expect(categoryResponse.status()).toBe(201);
  return {accountId:(await response.json()).id,categoryId:(await categoryResponse.json()).id};
}
async function planning(request:APIRequestContext,month:string) {const r=await request.get('/api/planning/'+month);expect(r.status()).toBe(200);return r.json();}
test('plans monthly recurrence, reviews a budget, pays once and keeps history when changing future schedules',async({page},info)=>{
  await login(page.request);const name='Plano '+info.project.name+' '+Date.now(),refs=await reference(page.request,name);
  const month=({chromium:'2030-01',webkit:'2030-03','mobile-web':'2030-05'})[info.project.name]!;
  await page.goto('/planning?mes='+month);await page.getByRole('button',{name:'Nova recorrência',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Nova recorrência',exact:true});
  await dialog.getByLabel('Descrição',{exact:true}).fill(name);await dialog.getByLabel('Valor previsto (R$)',{exact:true}).fill('100,00');
  await dialog.getByLabel('Conta',{exact:true}).selectOption(refs.accountId);await dialog.getByLabel('Categoria',{exact:true}).selectOption(refs.categoryId);
  await dialog.getByLabel('Fim opcional',{exact:true}).fill(monthlyDueDate(shiftMonth(month,1)!,31));
  await dialog.getByLabel('Dia de vencimento',{exact:true}).fill('31');await dialog.getByLabel('Lembrar quantos dias antes',{exact:true}).fill('3');
  await dialog.getByRole('button',{name:'Salvar recorrência',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('button',{name:'Gerar previsões do mês',exact:true}).click();await expect(page.getByRole('button',{name:'Pagar '+name,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Editar orçamento',exact:true}).click();
  const budget=page.getByRole('dialog',{name:'Editar orçamento',exact:true});
  await budget.getByLabel('Teto de despesas (R$)',{exact:true}).fill('80,00');await budget.getByLabel('Renda prevista (R$)',{exact:true}).fill('90,00');await budget.getByLabel('Reserva planejada (R$)',{exact:true}).fill('10,00');await budget.getByLabel('Limite Fixas '+name,{exact:true}).fill('70,00');
  await budget.getByRole('button',{name:'Salvar orçamento',exact:true}).click();await expect(budget).toHaveCount(0);
  const beforePayment=await planning(page.request,month);
  await page.getByRole('button',{name:'Pagar '+name,exact:true}).click();const payment=page.getByRole('dialog',{name:'Pagar ocorrência',exact:true});
  await payment.getByLabel('Valor pago (R$)',{exact:true}).fill('110,10');await payment.getByLabel('Data de pagamento',{exact:true}).fill(month+'-28');await payment.getByRole('button',{name:'Confirmar pagamento',exact:true}).click();await expect(payment).toHaveCount(0);
  const paid=await planning(page.request,month),occurrence=paid.occurrences.find((o:{description:string})=>o.description===name);expect(occurrence.status).toBe('paid');expect(moneyToCents(beforePayment.summary.pending)-moneyToCents(paid.summary.pending)).toBe(10000n);
  expect(paid.summary.realized).toBe('110.10');expect(moneyToCents(paid.summary.committed)-moneyToCents(beforePayment.summary.committed)).toBe(1010n);
  await expect(page.getByRole('heading',{name:'Restante do teto',exact:true}).locator('..')).toContainText('-R$');
  const next=month.slice(0,5)+String(Number(month.slice(5))+1).padStart(2,'0');
  await page.goto('/planning?mes='+next);await page.getByRole('button',{name:'Editar próximas '+name,exact:true}).click();
  const future=page.getByRole('dialog',{name:'Editar próximas ocorrências',exact:true});await future.getByLabel('Descrição',{exact:true}).fill(name+' futuro');await future.getByLabel('Valor previsto (R$)',{exact:true}).fill('150,00');await future.getByRole('button',{name:'Salvar recorrência',exact:true}).click();await expect(future).toHaveCount(0);
  await page.getByRole('button',{name:'Gerar previsões do mês',exact:true}).click();await expect(page.getByRole('button',{name:'Pagar '+name+' futuro',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Copiar orçamento',exact:true}).click();const copy=page.getByRole('dialog',{name:'Revisar cópia do orçamento',exact:true});await copy.getByRole('button',{name:'Carregar para revisão',exact:true}).click();await expect(copy.getByLabel('Teto de despesas (R$)',{exact:true})).toHaveValue('80.00');await copy.getByLabel('Teto de despesas (R$)',{exact:true}).fill('200,00');await copy.getByRole('button',{name:'Confirmar plano revisado',exact:true}).click();await expect(copy).toHaveCount(0);
  expect((await planning(page.request,next)).plan.limit).toBe('200.00');
  await page.getByRole('button',{name:'Adiar '+name+' futuro',exact:true}).click();const postpone=page.getByRole('dialog',{name:'Adiar ocorrência',exact:true});await postpone.getByLabel('Novo vencimento',{exact:true}).fill(next+'-15');await postpone.getByRole('button',{name:'Salvar alteração',exact:true}).click();await expect(postpone).toHaveCount(0);
  expect((await planning(page.request,next)).occurrences.find((o:{ruleId:string})=>o.ruleId===occurrence.ruleId)).toMatchObject({dueDate:next+'-15',status:'postponed'});
  await page.goto('/planning?mes='+month);await expect(page.getByRole('button',{name:'Pagar '+name,exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'Ocorrências do mês'})).toContainText(name);
  await page.screenshot({path:'test-results/planning-'+info.project.name+'.png',fullPage:true});
  await page.getByRole('button',{name:'Fechar mês',exact:true}).click();await page.getByRole('dialog',{name:'Fechar mês',exact:true}).getByRole('button',{name:'Confirmar fechamento',exact:true}).click();await expect(page.getByRole('button',{name:'Editar orçamento',exact:true})).toBeDisabled();
  expect((await planning(page.request,month)).occurrences.find((o:{id:string})=>o.id===occurrence.id)).toEqual(occurrence);
  await page.getByRole('button',{name:'Reabrir mês',exact:true}).click();await page.getByRole('dialog',{name:'Reabrir mês',exact:true}).getByRole('button',{name:'Confirmar reabertura',exact:true}).click();await expect(page.getByRole('button',{name:'Editar orçamento',exact:true})).toBeEnabled();
});
test('concurrent generation and imported reconciliation have no duplicates and enforce ownership and closed months',async({request,playwright},info)=>{
  await login(request);const name='Conciliar '+info.project.name+' '+Date.now(),refs=await reference(request,name),month=({chromium:'2031-02',webkit:'2031-04','mobile-web':'2031-06'})[info.project.name]!;
  const schedule={...refs,description:name,amount:'100.00',startDate:month+'-01',endDate:null,dueDay:31,estimated:true,reminderDays:null,paused:false};
  const response=await request.post('/api/recurrences',{headers:headers(),data:{fromMonth:month,schedule}});expect(response.status()).toBe(201);const rule=await response.json();
  const generations=await Promise.all([1,2].map(()=>request.post('/api/planning/'+month+'/generate',{headers:headers(),data:{}})));for(const r of generations)expect(r.status()).toBe(200);
  const view=await planning(request,month),row=view.occurrences.find((o:{ruleId:string})=>o.ruleId===rule.id);expect(view.occurrences.filter((o:{ruleId:string})=>o.ruleId===rule.id)).toHaveLength(1);
  const input={...refs,description:name,amount:'95.50',kind:'expense',status:'recorded',purchaseDate:month+'-20',competenceMonth:month+'-01',dueDate:null,paidDate:null};
  const entryResponse=await request.post('/api/entries',{headers:headers(),data:input});expect(entryResponse.status()).toBe(201);const created=await entryResponse.json(),entry=(await db.get('transactions',created.id))!;await db.put('transactions',{...entry,source:'ofx'});
  const foreign=await playwright.request.newContext();await login(foreign,'b@example.test');
  try {expect((await foreign.get('/api/occurrences/'+row.id+'/candidates')).status()).toBe(404);expect((await foreign.post('/api/occurrences/'+row.id+'/reconcile',{headers:{...headers(),'if-match':row.revision},data:{transactionId:entry.id,transactionRevision:created.revision,paidDate:month+'-20'}})).status()).toBe(404);}finally{await foreign.dispose();}
  const key=headers(),paymentHeaders={...key,'if-match':row.revision},payload={transactionId:entry.id,transactionRevision:created.revision,paidDate:month+'-20'};
  const reconciled=await request.post('/api/occurrences/'+row.id+'/reconcile',{headers:paymentHeaders,data:payload});expect(reconciled.status()).toBe(200);expect((await request.post('/api/occurrences/'+row.id+'/reconcile',{headers:paymentHeaders,data:payload})).status()).toBe(200);
  const linked=await db.owned('transactions',entry.ownerId,{where:[{field:'recurrenceOccurrenceId',value:row.id}]});expect(linked).toHaveLength(1);expect(linked[0]!.id).toBe(entry.id);
  const after=await planning(request,month);expect(after.occurrences.find((o:{id:string})=>o.id===row.id)).toMatchObject({status:'paid',amount:'95.50'});
  expect((await request.post('/api/planning/'+month+'/state',{headers:{...headers(),'if-match':after.monthRevision},data:{action:'close'}})).status()).toBe(200);
  expect((await request.post('/api/entries',{headers:headers(),data:input})).status()).toBe(409);
  expect((await request.post('/api/planning/'+month+'/generate',{headers:{...headers(),origin:'https://hostile.test'},data:{}})).status()).toBe(403);
  expect((await request.get('/api/planning/invalid')).status()).toBe(400);
  // Reopen so subsequent independent browser projects can use future rule versions.
  const closed=await planning(request,month);expect((await request.post('/api/planning/'+month+'/state',{headers:{...headers(),'if-match':closed.monthRevision},data:{action:'reopen'}})).status()).toBe(200);
});

test('reviews and reconciles an imported expense in the UI without creating another movement',async({page},info)=>{
  await login(page.request);const name='Revisão '+info.project.name+' '+Date.now(),refs=await reference(page.request,name),month=({chromium:'2032-02',webkit:'2032-04','mobile-web':'2032-06'})[info.project.name]!;
  const response=await page.request.post('/api/recurrences',{headers:headers(),data:{fromMonth:month,schedule:{...refs,description:name,amount:'100.00',startDate:month+'-01',endDate:monthlyDueDate(month,31),dueDay:31,estimated:true,reminderDays:2,paused:false}}});expect(response.status()).toBe(201);
  expect((await page.request.post('/api/planning/'+month+'/generate',{headers:headers(),data:{}})).status()).toBe(200);
  const entryResponse=await page.request.post('/api/entries',{headers:headers(),data:{...refs,description:name+' extrato',amount:'95.50',kind:'expense',status:'recorded',purchaseDate:month+'-20',competenceMonth:month+'-01',dueDate:null,paidDate:null}});expect(entryResponse.status()).toBe(201);const created=await entryResponse.json(),entry=(await db.get('transactions',created.id))!;await db.put('transactions',{...entry,source:'csv'});
  const before=await planning(page.request,month),count=(await db.owned('transactions',entry.ownerId)).length;
  await page.goto('/planning?mes='+month);await page.getByRole('button',{name:'Conciliar '+name,exact:true}).click();const dialog=page.getByRole('dialog',{name:'Conciliar lançamento importado',exact:true});
  await dialog.getByRole('button',{name:'Carregar lançamentos importados',exact:true}).click();await dialog.getByLabel('Lançamento importado',{exact:true}).selectOption(entry.id);await dialog.getByLabel('Data de pagamento',{exact:true}).fill(month+'-20');await dialog.getByRole('button',{name:'Confirmar conciliação',exact:true}).click();await expect(dialog).toHaveCount(0);
  const after=await planning(page.request,month);expect(after.summary.realized).toBe(before.summary.realized);expect(moneyToCents(before.summary.pending)-moneyToCents(after.summary.pending)).toBe(10000n);expect((await db.owned('transactions',entry.ownerId)).length).toBe(count);
  await page.reload();await expect(page.getByRole('button',{name:'Conciliar '+name,exact:true})).toHaveCount(0);expect(after.occurrences.find((o:{description:string})=>o.description===name)).toMatchObject({status:'paid',amount:'95.50',transactionId:entry.id});
});
