import { describe, expect, it } from 'vitest';
import { centsToMoney, moneyToCents, moneySchema, isCivilDate, competenceSchema, financialEntrySchema, financialAccountSchema, categoryInputSchema, recurrenceInputSchema, budgetInputSchema, cardInputSchema, invoiceInputSchema, installmentGroupInputSchema, importItemSchema } from './finance';

describe('exact financial contracts', () => {
  it('adds decimal money exactly across the supported range', () => {
    expect(centsToMoney(moneyToCents('0.10') + moneyToCents('0.20'))).toBe('0.30');
    expect(centsToMoney(moneyToCents('9999999999999.99'))).toBe('9999999999999.99');
    expect(moneySchema.parse('-0.00')).toBe('0.00');
    expect(moneySchema.parse('-42.9')).toBe('-42.90');
  });
  it('rejects overflow, implicit rounding, exponent notation and coercion', () => {
    for (const value of ['10000000000000.00', '0.001', '1e3', '42abc', 'NaN', ' 42.90', '01.00', '1,20']) expect(moneySchema.safeParse(value).success).toBe(false);
    expect(moneySchema.safeParse(42.9).success).toBe(false);
    expect(() => centsToMoney(1_000_000_000_000_000n)).toThrow();
  });
  it('validates civil calendars without timezone rollover', () => {
    for (const date of ['2024-02-29', '2000-02-29', '0001-01-01', '2026-12-31']) expect(isCivilDate(date)).toBe(true);
    for (const date of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '0000-01-01', '2026-01-01T00:00:00Z']) expect(isCivilDate(date)).toBe(false);
    expect(competenceSchema.safeParse('2026-10-01').success).toBe(true);
    expect(competenceSchema.safeParse('2026-10-02').success).toBe(false);
  });
  const id = '00000000-0000-4000-8000-000000000001';
  const entry = { ownerId: id, accountId: id, categoryId: id, description: 'Compra sintética', amount: '-42.90', currency: 'BRL', kind: 'expense', status: 'recorded', purchaseDate: '2026-10-02', competenceMonth: '2026-10-01', dueDate: null, paidDate: null, source: 'manual', externalId: null, invoiceId: null, installmentId: null, recurrenceOccurrenceId: null };
  it('requires explicit ownership, financial kind and real settlement date', () => {
    expect(financialEntrySchema.safeParse(entry).success).toBe(true);
    for (const changes of [{ ownerId: undefined }, { kind: 'unclassified' }, { amount: '0' }, { amount: '42.90' }, { amount: '1e3' }, { status: 'settled' }]) expect(financialEntrySchema.safeParse({ ...entry, ...changes }).success).toBe(false);
    expect(financialEntrySchema.safeParse({ ...entry, kind: 'transfer', amount: '-42.90' }).success).toBe(true);
    expect(financialEntrySchema.safeParse({ ...entry, kind: 'refund', amount: '10.00' }).success).toBe(true);
  });
});

const ownerId='00000000-0000-4000-8000-000000000001';
describe('financial planning and import contracts', () => {
  it('keeps account opening money exact and category customization bounded', () => {
    const account={ownerId,name:' Conta pessoal ',type:'banco',currency:'BRL',openingBalance:'-0.10',openingDate:'2026-10-01'};
    expect(financialAccountSchema.parse(account)).toMatchObject({name:'Conta pessoal',openingBalance:'-0.10'});
    for(const changes of [{ownerId:undefined},{currency:'USD'},{openingBalance:1.1},{openingDate:'2026-02-30'}]) expect(financialAccountSchema.safeParse({...account,...changes}).success).toBe(false);
    const category={ownerId,name:'Categoria editável',color:'#aBc123',icon:'tag',sortOrder:0};
    expect(categoryInputSchema.safeParse(category).success).toBe(true);
    for(const changes of [{name:' '},{color:'blue'},{sortOrder:-1},{unknown:true}]) expect(categoryInputSchema.safeParse({...category,...changes}).success).toBe(false);
  });
  it('validates recurrence intervals and day limits without inventing calendar dates', () => {
    const rule={ownerId,accountId:ownerId,categoryId:ownerId,description:'Planejado',amount:'-20',currency:'BRL',startDate:'2026-10-01',endDate:null,dueDay:31,estimated:true};
    expect(recurrenceInputSchema.parse(rule).amount).toBe('-20.00');
    expect(recurrenceInputSchema.safeParse({...rule,endDate:'2026-10-01'}).success).toBe(true);
    for(const changes of [{endDate:'2026-09-30'},{dueDay:32},{dueDay:0},{amount:'0.001'}]) expect(recurrenceInputSchema.safeParse({...rule,...changes}).success).toBe(false);
  });
  it('rejects negative planning values and malformed money without throwing', () => {
    const budget={ownerId,competenceMonth:'2026-10-01',limit:'500',expectedIncome:'1500',reserve:'0',currency:'BRL'};
    expect(budgetInputSchema.parse(budget)).toMatchObject({limit:'500.00',reserve:'0.00'});
    for(const changes of [{limit:'-0.01'},{expectedIncome:'-1'},{reserve:'-1'},{limit:'1e3'},{competenceMonth:'2026-10-02'}]) expect(budgetInputSchema.safeParse({...budget,...changes}).success).toBe(false);
  });
  it('validates card, invoice and installment money and civil dates independently', () => {
    const card={ownerId,name:'Pessoal',paymentAccountId:ownerId,closingDay:25,dueDay:5,currency:'BRL'};
    expect(cardInputSchema.safeParse(card).success).toBe(true);
    expect(cardInputSchema.safeParse({...card,closingDay:32}).success).toBe(false);
    const invoice={ownerId,cardId:ownerId,competenceMonth:'2026-10-01',closingDate:'2026-10-25',dueDate:'2026-11-05',statedTotal:null,currency:'BRL'};
    expect(invoiceInputSchema.safeParse(invoice).success).toBe(true);
    expect(invoiceInputSchema.parse({...invoice,statedTotal:'-10'}).statedTotal).toBe('-10.00');
    expect(invoiceInputSchema.safeParse({...invoice,dueDate:'2026-02-29'}).success).toBe(false);
    const group={ownerId,cardId:ownerId,description:'Parcelado',totalAmount:'0.30',purchaseDate:'2026-10-02',count:3,currency:'BRL'};
    expect(installmentGroupInputSchema.parse(group).totalAmount).toBe('0.30');
    for(const changes of [{totalAmount:'0'},{totalAmount:'-1'},{totalAmount:'1e3'},{count:0},{count:601}]) expect(installmentGroupInputSchema.safeParse({...group,...changes}).success).toBe(false);
  });
  it('keeps incomplete import rows traceable without coercing uncertain data', () => {
    const item={ownerId,batchId:ownerId,position:1,accountId:null,categoryId:null,invoiceId:null,amount:null,currency:null,purchaseDate:null,competenceMonth:null,kind:null,description:null,provenance:{page:1,row:2,cell:'B2',excerpt:'Evidência sintética'},warnings:['Data ambígua'],state:'pending'};
    expect(importItemSchema.safeParse(item).success).toBe(true);
    expect(importItemSchema.parse({...item,amount:'-42.9',currency:'BRL',purchaseDate:'2026-10-02',competenceMonth:'2026-10-01',kind:'expense'}).amount).toBe('-42.90');
    for(const changes of [{position:0},{amount:42.9},{provenance:{page:0}},{warnings:[123]},{state:'unknown'}]) expect(importItemSchema.safeParse({...item,...changes}).success).toBe(false);
  });
});
