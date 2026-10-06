import { randomUUID } from 'node:crypto';
import { test,expect,type APIRequestContext,type Page } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { moneyToCents } from '../../packages/shared/src/finance';
const database=e2eDatabase(),origin='http://127.0.0.1:3000';
test.setTimeout(60000);
test.beforeEach(async()=>{await clearTestCollections(database,['authRateLimits']);});
test.afterAll(async()=>{await database.firestore.terminate();});
async function login(request:APIRequestContext,email='a@example.test') {
  expect((await request.post('/api/auth/sign-in/email',{headers:{origin},data:{email,password:TEST_PASSWORD}})).status()).toBe(200);
}
async function accountBalance(request:APIRequestContext,name:string) {
  const response=await request.get('/api/accounts');expect(response.status()).toBe(200);
  return (await response.json()).accounts.find((row:{name:string})=>row.name===name).balance;
}
async function createExpense(page:Page,name:string,account:string,category:string,amount:string,quick=false) {
  if(quick)await page.getByRole('button',{name:/^Adicionar gasto( rápido)?$/}).filter({visible:true}).first().click();
  else await page.getByRole('button',{name:'Novo lançamento',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Adicionar Gasto',exact:true});
  await dialog.getByLabel('Descrição do gasto *',{exact:true}).fill(name);
  await dialog.getByLabel('Valor (R$) *',{exact:true}).fill(amount);
  await dialog.getByLabel('Conta de saída',{exact:true}).selectOption({label:account});
  await dialog.getByLabel('Categoria',{exact:true}).selectOption({label:category});
  await dialog.getByLabel('Data do gasto *',{exact:true}).fill('2026-10-02');
  await dialog.getByLabel('Competência',{exact:true}).fill('2026-10');
  await dialog.getByLabel('Vencimento',{exact:true}).fill('2026-10-05');
  await dialog.getByLabel('Data de pagamento',{exact:true}).fill('2026-10-02');
  await dialog.getByLabel('Notas',{exact:true}).fill('Registro manual completo');
  await dialog.getByRole('button',{name:'Salvar Gasto',exact:true}).click();await expect(dialog).toHaveCount(0);
}
test('creates dated account/category and persists exact CRUD, undo and monthly totals through the UI',async({page},info)=> {
  await login(page.request);
  const suffix=info.project.name+'-'+Date.now(),account='Carteira '+suffix,category='Categoria '+suffix,prefix='Centavos '+suffix;
  await page.goto('/accounts');await page.getByRole('button',{name:'Nova conta',exact:true}).click();
  const accountDialog=page.getByRole('dialog',{name:'Nova conta',exact:true});
  await accountDialog.getByLabel('Nome',{exact:true}).fill(account);
  await accountDialog.getByLabel('Saldo inicial (R$)',{exact:true}).fill('100,00');
  await accountDialog.getByLabel('Data do saldo inicial',{exact:true}).fill('2026-10-01');
  await accountDialog.getByRole('button',{name:'Salvar',exact:true}).click();await expect(accountDialog).toHaveCount(0);
  await page.getByRole('button',{name:'Nova categoria',exact:true}).click();
  const categoryDialog=page.getByRole('dialog',{name:'Nova categoria',exact:true});
  await categoryDialog.getByLabel('Nome',{exact:true}).fill(category);
  await categoryDialog.getByLabel('Cor',{exact:true}).fill('#226688');
  await categoryDialog.getByRole('button',{name:'Salvar',exact:true}).click();await expect(categoryDialog).toHaveCount(0);
  const before=await (await page.request.get('/api/months/2026-10/summary')).json();
  await page.goto('/transactions?description='+encodeURIComponent(prefix));
  await createExpense(page,prefix+' A',account,category,'0,10',true);await createExpense(page,prefix+' B',account,category,'0,20');
  await page.reload();await expect(page.getByRole('main').getByText(prefix+' A',{exact:true}).filter({visible:true})).toBeVisible();
  expect(await accountBalance(page.request,account)).toBe('99.70');
  const after=await (await page.request.get('/api/months/2026-10/summary')).json();
  expect(moneyToCents(after.expenses)-moneyToCents(before.expenses)).toBe(30n);
  await page.getByRole('button',{name:'Editar '+prefix+' A',exact:true}).click();
  const edit=page.getByRole('dialog',{name:'Editar lançamento',exact:true});
  await edit.getByLabel('Valor (R$) *',{exact:true}).fill('0,40');await edit.getByLabel('Notas',{exact:true}).fill('Valor corrigido');
  await edit.getByRole('button',{name:'Salvar Gasto',exact:true}).click();await expect(edit).toHaveCount(0);
  expect(await accountBalance(page.request,account)).toBe('99.40');
  await page.getByRole('button',{name:'Excluir '+prefix+' A',exact:true}).click();await expect(page.getByRole('main').getByText(prefix+' A',{exact:true}).filter({visible:true})).toHaveCount(0);
  expect(await accountBalance(page.request,account)).toBe('99.80');
  await page.getByRole('button',{name:'Desfazer exclusão',exact:true}).click();await expect(page.getByRole('main').getByText(prefix+' A',{exact:true}).filter({visible:true})).toBeVisible();
  expect(await accountBalance(page.request,account)).toBe('99.40');
  await page.goto('/accounts');await expect(page.getByRole('heading',{name:account,exact:true}).locator('..')).toContainText('99,40');
  await page.getByRole('button',{name:'Editar categoria '+category,exact:true}).click();
  const rename=page.getByRole('dialog',{name:'Editar categoria',exact:true}),renamed=category+' renomeada';
  await rename.getByLabel('Nome',{exact:true}).fill(renamed);await rename.getByLabel('Cor',{exact:true}).fill('#882244');
  await rename.getByLabel('Ordem',{exact:true}).fill('7');await rename.getByRole('button',{name:'Salvar',exact:true}).click();await expect(rename).toHaveCount(0);
  await page.getByRole('button',{name:'Arquivar categoria '+renamed,exact:true}).click();
  await expect(page.getByRole('button',{name:'Editar categoria '+renamed,exact:true})).toHaveCount(0);
  const references=await (await page.request.get('/api/categories')).json(),archived=references.categories.find((c:{name:string})=>c.name===renamed);
  expect(archived).toMatchObject({color:'#882244',sortOrder:7});expect(archived.archivedAt).not.toBeNull();
  const history=(await (await page.request.get('/api/entries?description='+encodeURIComponent(prefix))).json()).entries;
  expect(history).toHaveLength(2);expect(history[0].categoryName).toBe(renamed);
  expect(history[0]).toMatchObject({purchaseDate:'2026-10-02',competenceMonth:'2026-10-01',dueDate:'2026-10-05',paidDate:'2026-10-02',status:'settled'});
  const invalid=await page.request.post('/api/entries',{headers:{origin,'idempotency-key':randomUUID()},data:{accountId:history[0].accountId,categoryId:archived.id,description:'Vínculo indevido',amount:'1.00',kind:'expense',status:'settled',purchaseDate:'2026-10-02',competenceMonth:'2026-10-01',dueDate:null,paidDate:'2026-10-02'}});
  expect(invalid.status()).toBe(409);
  const final=await (await page.request.get('/api/months/2026-10/summary')).json();
  expect(moneyToCents(final.expenses)-moneyToCents(before.expenses)).toBe(60n);
});
test('transfers remain correlated, replay is unique, and hostile requests cannot change another owner',async({request,playwright},info)=> {
  await login(request);
  const headers={origin,'idempotency-key':randomUUID()},name='Transfer '+info.project.name+' '+Date.now();
  const create=async(accountName:string)=> {
    const r=await request.post('/api/accounts',{headers:{...headers,'idempotency-key':randomUUID()},data:{name:accountName,type:'carteira',openingBalance:'100.00',openingDate:'2026-10-01'}});expect(r.status()).toBe(201);return (await r.json()).id;
  };
  const from=await create(name+' saída'),to=await create(name+' destino');
  const cats=await (await request.get('/api/categories')).json(),categoryId=cats.categories[0].id;
  const input={accountId:from,toAccountId:to,categoryId,description:name,amount:'25.00',kind:'transfer',status:'settled',purchaseDate:'2026-10-02',competenceMonth:'2026-10-01',dueDate:null,paidDate:'2026-10-02'};
  const before=await (await request.get('/api/months/2026-10/summary')).json();
  const results=await Promise.all(Array.from({length:3},()=>request.post('/api/entries',{headers,data:input})));
  for(const response of results)expect(response.status()).toBe(201);
  const saved=await results[0]!.json();
  expect(new Set(await Promise.all(results.map(async r=>(await r.json()).id))).size).toBe(1);
  const entries=(await (await request.get('/api/entries?description='+encodeURIComponent(name))).json()).entries;
  expect(entries).toHaveLength(2);expect(entries.map((r:{amount:string})=>r.amount).sort()).toEqual(['-25.00','25.00']);
  expect(await accountBalance(request,name+' saída')).toBe('75.00');expect(await accountBalance(request,name+' destino')).toBe('125.00');
  const after=await (await request.get('/api/months/2026-10/summary')).json();expect(after.income).toBe(before.income);expect(after.expenses).toBe(before.expenses);
  expect((await request.post('/api/entries',{headers,data:{...input,amount:'30.00'}})).status()).toBe(409);
  expect((await request.post('/api/entries',{headers:{origin,'idempotency-key':randomUUID()},data:{...input,amount:'0'}})).status()).toBe(400);
  expect((await request.patch('/api/accounts/'+from,{headers:{origin:'https://hostile.test','idempotency-key':randomUUID()},data:{}})).status()).toBe(403);
  const other=await playwright.request.newContext();
  try {
    await login(other,'b@example.test');
    expect((await other.post('/api/entries',{headers:{origin,'idempotency-key':randomUUID()},data:input})).status()).toBe(404);
    expect((await other.delete('/api/entries/'+saved.id,{headers:{origin,'idempotency-key':randomUUID(),'if-match':'"'+saved.revision+'"'},data:{action:'archive'}})).status()).toBe(404);
  }finally{await other.dispose();}
});
