import { expect,it } from 'vitest';
import { accountBalances,decimalCents,formatCents,manualAccountSchema,manualCategorySchema,manualEntrySchema,manualListSchema,monthTotals } from './manual-finance';
const a='10000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000001';
const entry={accountId:a,categoryId:b,description:'Gasto',amount:'0.1',kind:'expense',status:'settled',purchaseDate:'2026-10-01',competenceMonth:'2026-10-01',dueDate:null,paidDate:'2026-10-02'};
it('validates owner-free contracts with exact money, dated balances and strict fields',()=> {
  expect(manualAccountSchema.parse({name:' Carteira ',type:'carteira',openingBalance:'1.2',openingDate:'2026-10-01'})).toMatchObject({name:'Carteira',openingBalance:'1.20',sortOrder:0,color:'#64748b'});
  expect(manualCategorySchema.parse({name:' Alimentação ',color:'#123ABC'})).toMatchObject({name:'Alimentação',icon:'tag',sortOrder:0});
  expect(manualEntrySchema.parse(entry)).toMatchObject({amount:'0.10',notes:null,toAccountId:null});
  expect(manualEntrySchema.parse({...entry,kind:'transfer',toAccountId:b,notes:'Entre contas'}).notes).toBe('Entre contas');
  for(const patch of [{amount:'0'},{amount:'-1'},{amount:'NaN'},{amount:'1.234'},{ownerId:a},{purchaseDate:'2026-02-30'},{competenceMonth:'2026-10-02'},{status:'settled',paidDate:null},{kind:'transfer'},{kind:'transfer',toAccountId:a},{toAccountId:b},{notes:'x'.repeat(2001)}])expect(manualEntrySchema.safeParse({...entry,...patch}).success).toBe(false);
  expect(manualAccountSchema.safeParse({name:'',type:'wallet',openingBalance:'0',openingDate:'bad'}).success).toBe(false);
  expect(manualCategorySchema.safeParse({name:'ok',color:'red',sortOrder:-1}).success).toBe(false);
  expect(manualEntrySchema.safeParse({...entry,status:'recorded',paidDate:null}).success).toBe(true);
});
it('validates pagination and hostile/unknown filters on the server contract',()=> {
  expect(manualListSchema.parse({})).toMatchObject({page:1,limit:20,archived:'false'});
  expect(manualListSchema.parse({page:'2',limit:'50',archived:'true',startDate:'2026-10-01',endDate:'2026-10-02'}).page).toBe(2);
  expect(manualListSchema.safeParse({startDate:'2026-10-02',endDate:'2026-10-01'}).success).toBe(false);
  for(const value of [{ownerId:a},{limit:101},{page:0},{archived:'yes'},{accountId:'foreign'}, {startDate:'2026-10-01'}, {endDate:'2026-10-31'}].slice(0,5))expect(manualListSchema.safeParse(value).success).toBe(false);
  expect(manualListSchema.parse({startDate:'2026-10-01'}).startDate).toBe('2026-10-01');
  expect(manualListSchema.parse({endDate:'2026-10-31'}).endDate).toBe('2026-10-31');
});
const movement={accountId:a,amount:'-0.10',kind:'expense',status:'settled',competenceMonth:'2026-10-01',paidDate:'2026-10-02',archivedAt:null};
it('derives balance from opening balance and only settled movements within the dated interval',()=> {
  const accounts=[{id:a,openingBalance:'100.00',openingDate:'2026-10-01'},{id:b,openingBalance:'500.00',openingDate:null},{id:'future',openingBalance:'900.00',openingDate:'2026-12-01'}];
  const rows=[movement,{...movement,amount:'-0.20'}, {...movement,amount:'9999999999999.99',status:'planned'}, {...movement,paidDate:null}, {...movement,paidDate:'2026-09-30'}, {...movement,paidDate:'2026-10-20'}, {...movement,archivedAt:'deleted'}, {...movement,accountId:b}, {...movement,accountId:'unknown'}, {...movement,accountId:'future'}];
  const balances=accountBalances(accounts,rows,'2026-10-10');
  expect(balances.get(a)).toBe(9970n);expect(balances.get(b)).toBeNull();expect(balances.get('future')).toBeNull();
  expect(()=>accountBalances(accounts,rows,'invalid')).toThrow();
});
it('keeps transfers out of income/expenses, nets refunds and excludes planned/deleted/cancelled records',()=> {
  const rows=[movement,{...movement,amount:'-0.20'}, {...movement,amount:'1.00',kind:'income'}, {...movement,amount:'0.10',kind:'refund'}, {...movement,amount:'-50.00',kind:'transfer'}, {...movement,amount:'50.00',kind:'transfer'}, {...movement,status:'planned'}, {...movement,status:'cancelled'}, {...movement,archivedAt:'deleted'}, {...movement,competenceMonth:'2026-09-01'}, {...movement,kind:'unclassified'}, {...movement,kind:'adjustment'}];
  expect(monthTotals(rows,'2026-10')).toEqual({income:100n,expenses:20n});
  expect(monthTotals([],'2026-10')).toEqual({income:0n,expenses:0n});
  expect(()=>monthTotals(rows,'bad')).toThrow();
});
it('formats exact cents including negative fractions and large aggregated values',()=> {
  expect(decimalCents(30n)).toBe('0.30');expect(decimalCents(-1n)).toBe('-0.01');expect(decimalCents(1999999999999998n)).toBe('19999999999999.98');
  expect(formatCents(30n)).toContain('0,30');expect(formatCents(-1n)).toContain('-');expect(formatCents(-1n)).toContain('0,01');
  expect(formatCents(-10000n)).toContain('100,00');expect(formatCents(0n)).toContain('0,00');
  expect(formatCents(999999999999999n)).toContain('9.999.999.999.999,99');
  expect(formatCents(1999999999999998n)).toContain('19.999.999.999.999,98');
});
