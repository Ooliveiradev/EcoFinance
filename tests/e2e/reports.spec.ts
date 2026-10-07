import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test,expect,type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
const db=e2eDatabase(),origin='http://127.0.0.1:3000';
test.setTimeout(90000);
test.beforeEach(async()=>{await clearTestCollections(db,['authRateLimits']);});
test.afterAll(async()=>{await db.firestore.terminate();});
async function login(request:APIRequestContext) {expect((await request.post('/api/auth/sign-in/email',{headers:{origin},data:{email:'a@example.test',password:TEST_PASSWORD}})).status()).toBe(200);}
const headers=(extra:Record<string,string>={})=>({origin,'idempotency-key':randomUUID(),...extra});
async function created(request:APIRequestContext,path:string,data:object) {
  const response=await request.post(path,{headers:headers(),data});expect(response.status()).toBe(201);return response.json();
}
test('dashboard, reports, summary API and CSV export show the same exact totals and refresh after edits',async({page},info)=>{
  await login(page.request);
  const month=({chromium:'2031-01',webkit:'2031-03','mobile-web':'2031-05'})[info.project.name]!,name='Relatório '+info.project.name+' '+Date.now();
  const account=(await created(page.request,'/api/accounts',{name,type:'carteira',openingBalance:'100.00',openingDate:month+'-01'})).id;
  const savings=(await created(page.request,'/api/accounts',{name:name+' reserva',type:'carteira',openingBalance:'0.00',openingDate:month+'-01'})).id;
  const categoryId=(await created(page.request,'/api/categories',{name,color:'#226688'})).id;
  const entry=(patch:object)=>({accountId:account,categoryId,description:name,amount:'0.10',kind:'expense',status:'settled',purchaseDate:month+'-02',competenceMonth:month+'-01',dueDate:null,paidDate:month+'-02',...patch});
  await created(page.request,'/api/entries',entry({description:name+' salário',amount:'1000.10',kind:'income'}));
  await created(page.request,'/api/entries',entry({description:name+' A'}));
  const second=await created(page.request,'/api/entries',entry({description:name+' B',amount:'0.20'}));
  await created(page.request,'/api/entries',entry({description:name+' transferência',amount:'50.00',kind:'transfer',toAccountId:savings}));

  const api=await (await page.request.get(`/api/reports?from=${month}&to=${month}`)).json();
  expect(api.report.months[0]).toMatchObject({income:'1000.10',expenses:'0.30',net:'999.80',count:3});
  expect(api.report.categories).toEqual([expect.objectContaining({name,amount:'0.30',share:'100.0'})]);
  const summary=await (await page.request.get(`/api/months/${month}/summary`)).json();
  expect(summary).toMatchObject({income:api.report.months[0].income,expenses:api.report.months[0].expenses,entriesCount:3});
  const cash=await (await page.request.get(`/api/reports?from=${month}&to=${month}&basis=cash`)).json();
  expect(cash.report.months[0]).toMatchObject({income:'1000.10',expenses:'0.30'});

  await page.goto('/?mes='+month);
  const main=page.getByRole('main');
  await expect(main.getByText('R$ 1.000,10',{exact:true}).first()).toBeVisible();
  await expect(main.getByText('R$ 0,30',{exact:true}).first()).toBeVisible();
  await expect(page.getByTestId('projection-formula')).toContainText('compromissos R$ 0,00');

  await page.goto(`/reports?de=${month}&ate=${month}`);
  await expect(page.getByRole('heading',{name:'Relatórios',exact:true})).toBeVisible();
  const monthly=page.getByRole('table',{name:/Totais mensais/});
  await expect(monthly.getByRole('cell',{name:'R$ 1.000,10',exact:true}).first()).toBeVisible();
  await expect(monthly.getByRole('cell',{name:'R$ 0,30',exact:true}).first()).toBeVisible();
  await expect(page.getByRole('table',{name:/Despesas por categoria/}).getByRole('cell',{name:'R$ 0,30',exact:true})).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:'Exportar CSV'}).click()]);
  const csv=await readFile((await download.path())!,'utf8');
  expect(csv).toContain(`mensal;${month};competência;income;1000.10`);
  expect(csv).toContain(`mensal;${month};competência;expenses;0.30`);
  expect(csv).toContain(`categoria;${month}..${month};competência;${name};0.30`);

  // Aggregates are recomputed on every read: archiving updates every surface.
  expect((await page.request.delete('/api/entries/'+second.id,{headers:headers({'if-match':'"'+second.revision+'"'}),data:{action:'archive'}})).status()).toBe(200);
  await page.reload();
  await expect(monthly.getByRole('cell',{name:'R$ 0,10',exact:true}).first()).toBeVisible();
  expect((await (await page.request.get(`/api/months/${month}/summary`)).json()).expenses).toBe('0.10');
});
test('rejects invalid periods and anonymous access without inventing values',async({page,playwright})=>{
  await login(page.request);
  expect((await page.request.get('/api/reports?from=2031-05&to=2031-01')).status()).toBe(400);
  expect((await page.request.get('/api/reports?from=2030-01&to=2031-01')).status()).toBe(400);
  expect((await page.request.get('/api/reports/export?from=2031-01&to=2031-01&ownerId=x')).status()).toBe(400);
  await page.goto('/reports?de=2031-05&ate=2031-01');
  await expect(page.getByRole('status').filter({hasText:'Período inválido'})).toBeVisible();
  const anonymous=await playwright.request.newContext({baseURL:origin});
  try {
    for(const path of ['/api/reports?from=2031-01&to=2031-01','/api/reports/export?from=2031-01&to=2031-01'])expect((await anonymous.get(path)).status()).toBe(401);
  } finally {await anonymous.dispose();}
});
