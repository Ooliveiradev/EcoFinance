import { expect,it } from 'vitest';
import { cardSchema,invoiceSchema,cardPurchaseSchema,invoiceItemSchema,invoicePaymentSchema,cardReconcileSchema,cardOccurrenceSchema,invoiceDates,installmentPlan,invoiceTotals } from './cards';
import { accountBalances,monthTotals } from './manual-finance';
const id='10000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000001';
const purchase={description:'Compra',categoryId:id,totalAmount:'300.00',count:3,purchaseDate:'2027-12-28',firstMonth:'2028-01',confirmed:true as const};
it('confirms only explicit installments, allocates remainder exactly and crosses years',()=>{
  expect(installmentPlan(purchase)).toEqual([{number:1,month:'2028-01',amount:'100.00'},{number:2,month:'2028-02',amount:'100.00'},{number:3,month:'2028-03',amount:'100.00'}]);
  expect(installmentPlan({...purchase,totalAmount:'100.00',firstMonth:'2027-12'})).toEqual([{number:1,month:'2027-12',amount:'33.34'},{number:2,month:'2028-01',amount:'33.33'},{number:3,month:'2028-02',amount:'33.33'}]);
  expect(installmentPlan({...purchase,totalAmount:'0.03'}).map(p=>p.amount)).toEqual(['0.01','0.01','0.01']);
  for(const patch of [{confirmed:false},{count:25},{count:0},{totalAmount:'0'},{totalAmount:'0.02'},{firstMonth:'2100-12'},{purchaseDate:'2028-02-30'},{ownerId:other}])expect(cardPurchaseSchema.safeParse({...purchase,...patch}).success).toBe(false);
});
it('clamps closing/due days and requires due after actual closing, with bounded year transitions',()=>{
  expect(invoiceDates('2028-02',31,31)).toEqual({closingDate:'2028-02-29',dueDate:'2028-03-31'});
  expect(invoiceDates('2027-12',25,5)).toEqual({closingDate:'2027-12-25',dueDate:'2028-01-05'});
  expect(invoiceDates('2028-04',10,20)).toEqual({closingDate:'2028-04-10',dueDate:'2028-04-20'});
  expect(invoiceDates('2100-12',1,31).dueDate).toBe('2100-12-31');
  expect(()=>invoiceDates('2100-12',31,1)).toThrow();expect(()=>invoiceDates('2028-13',1,2)).toThrow();expect(()=>invoiceDates('2028-02',0,2)).toThrow();
});
it('validates strict card/invoice/item and cross-field reconciliation schemas',()=>{
  const card={name:'Cartão',paymentAccountId:id,closingDay:25,dueDay:5};expect(cardSchema.parse(card)).toEqual(card);
  for(const patch of [{closingDay:32},{dueDay:0},{ownerId:id},{name:' '},{paymentAccountId:'bad'}])expect(cardSchema.safeParse({...card,...patch}).success).toBe(false);
  expect(invoiceSchema.parse({statedTotal:null,previousBalance:'-20',closed:false})).toEqual({statedTotal:null,previousBalance:'-20.00',closed:false});
  expect(invoiceSchema.safeParse({statedTotal:'-10',previousBalance:'0',closed:true}).success).toBe(true);
  const item={type:'fee',description:'Tarifa',amount:'1',categoryId:id,purchaseDate:'2028-02-29',competenceMonth:'2028-02',refundOfId:null};
  expect(invoiceItemSchema.safeParse(item).success).toBe(true);expect(invoiceItemSchema.safeParse({...item,type:'refund',refundOfId:other}).success).toBe(true);
  for(const patch of [{type:'refund'},{refundOfId:other},{type:'income'},{amount:'0'}])expect(invoiceItemSchema.safeParse({...item,...patch}).success).toBe(false);
  const payment={amount:'10',paidDate:'2028-02-29',categoryId:id,transactionId:null,transactionRevision:null,confirmed:true};
  expect(invoicePaymentSchema.safeParse(payment).success).toBe(true);expect(invoicePaymentSchema.safeParse({...payment,transactionId:other,transactionRevision:'v1'}).success).toBe(true);
  expect(invoicePaymentSchema.safeParse({...payment,transactionId:other}).success).toBe(false);expect(invoicePaymentSchema.safeParse({...payment,transactionRevision:'v1'}).success).toBe(false);
  const link={sourceId:id,sourceRevision:'v1',targetId:null,targetRevision:null,confirmed:true};expect(cardReconcileSchema.safeParse(link).success).toBe(true);expect(cardReconcileSchema.safeParse({...link,targetId:other,targetRevision:'v2'}).success).toBe(true);
  expect(cardReconcileSchema.safeParse({...link,targetId:other}).success).toBe(false);expect(cardReconcileSchema.safeParse({...link,targetRevision:'v2'}).success).toBe(false);
  expect(cardOccurrenceSchema.safeParse({transactionId:id,transactionRevision:'v1',occurrenceId:other,occurrenceRevision:'v2',confirmed:true}).success).toBe(true);
});
it('reconciles purchases, charges, credits, prior balances and partial payments without expenses twice',()=>{
  const base={amount:'-100.00',kind:'expense',status:'recorded',archivedAt:null,cardEntryType:'purchase' as const};
  const entries=[base,{...base,amount:'-10.00',cardEntryType:'interest' as const},{...base,amount:'-2.00',cardEntryType:'fee' as const},{...base,amount:'20.00',kind:'refund',cardEntryType:'refund' as const},{...base,amount:'-40.00',kind:'adjustment',status:'settled',cardEntryType:'payment' as const},{...base,status:'planned'},{...base,status:'cancelled'},{...base,archivedAt:'deleted'},{...base,kind:'transfer'},{...base,kind:'income'}];
  expect(invoiceTotals(entries,'5.00','100.00')).toEqual({purchases:'100.00',charges:'12.00',credits:'20.00',payments:'40.00',computed:'97.00',remaining:'57.00',divergence:'3.00'});
  expect(invoiceTotals([], '-10.00',null)).toMatchObject({computed:'-10.00',remaining:'-10.00',divergence:null});
  expect(invoiceTotals([{...base,cardEntryType:undefined}],'0.00','100.00').divergence).toBe('0.00');
  const shared=entries.map(e=>({...e,accountId:id,competenceMonth:'2028-02-01',paidDate:e.cardEntryType==='payment'?'2028-02-29':null}));
  expect(monthTotals(shared,'2028-02').expenses).toBe(9200n);expect(accountBalances([{id,openingBalance:'1000.00',openingDate:'2028-01-01'}],shared,'2028-02-29').get(id)).toBe(96000n);
});
it('keeps aggregate cents beyond one entry precision without binary rounding',()=>{
  const entries=Array.from({length:3},()=>({amount:'-9999999999999.99',kind:'expense',status:'recorded'}));
  expect(invoiceTotals(entries,'0.00',null).remaining).toBe('29999999999999.97');
});
