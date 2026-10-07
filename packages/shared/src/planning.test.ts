import { describe,it,expect } from 'vitest';
import { monthlyDueDate,scheduledDueDate,scheduleForMonth,planningSummary,scheduleSchema,ruleChangeSchema,budgetPlanSchema,occurrenceEditSchema,paymentSchema,reconciliationSchema,postponementSchema,copyPlanSchema,planningMonthSchema,type RecurrenceSchedule } from './planning';
const schedule:RecurrenceSchedule={accountId:'10000000-0000-4000-8000-000000000001',categoryId:'20000000-0000-4000-8000-000000000001',description:'Aluguel',amount:'100.00',startDate:'2027-12-01',endDate:null,dueDay:31,estimated:false,reminderDays:3,paused:false};
const plan={limit:'150.00',expectedIncome:'120.00',reserve:'20.00',categories:[{categoryId:schedule.categoryId,limit:'80.00'}]};
const entry={accountId:schedule.accountId,categoryId:schedule.categoryId,amount:'-100.00',kind:'expense',status:'settled',competenceMonth:'2028-02-01',paidDate:'2028-02-29',archivedAt:null};
describe('monthly recurrence calendar',()=>{
  it('clamps days, crosses years and handles leap and century years',()=>{
    expect(monthlyDueDate('2028-02',31)).toBe('2028-02-29');expect(monthlyDueDate('2027-02',31)).toBe('2027-02-28');
    expect(monthlyDueDate('2100-02',29)).toBe('2100-02-28');expect(monthlyDueDate('2000-02',31)).toBe('2000-02-29');
    expect(monthlyDueDate('2027-12',31)).toBe('2027-12-31');expect(monthlyDueDate('2028-01',31)).toBe('2028-01-31');
    expect(monthlyDueDate('2028-04',31)).toBe('2028-04-30');expect(monthlyDueDate('2028-04',1)).toBe('2028-04-01');
    expect(()=>monthlyDueDate('2028-13',31)).toThrow();expect(()=>monthlyDueDate('2028-02',0)).toThrow();expect(()=>monthlyDueDate('1999-12',1)).toThrow();
  });
  it('respects inclusive start/end and pause by civil due date',()=>{
    expect(scheduledDueDate(schedule,'2028-02')).toBe('2028-02-29');expect(scheduledDueDate(schedule,'2027-11')).toBeNull();
    expect(scheduledDueDate({...schedule,startDate:'2028-02-29',endDate:'2028-02-29'},'2028-02')).toBe('2028-02-29');
    expect(scheduledDueDate({...schedule,endDate:'2028-02-28'},'2028-02')).toBeNull();expect(scheduledDueDate({...schedule,paused:true},'2028-02')).toBeNull();
  });
  it('selects effective versions without changing input or applying a future version early',()=>{
    const later={...schedule,amount:'200.00'},versions=[{fromMonth:'2028-01',schedule:later},{fromMonth:'2027-12',schedule}];
    expect(scheduleForMonth(versions,'2027-11')).toBeNull();expect(scheduleForMonth(versions,'2027-12')).toBe(schedule);expect(scheduleForMonth(versions,'2028-02')).toBe(later);
    expect(versions[0]!.fromMonth).toBe('2028-01');
  });
});
it('rejects ownership injection, malformed dates, negative budgets, duplicate categories and invalid reminders',()=>{
  expect(scheduleSchema.parse({...schedule,amount:'100'}).amount).toBe('100.00');
  for(const patch of [{ownerId:'forged'},{amount:'0'},{amount:'-1'},{endDate:'2027-11-30'},{reminderDays:31},{dueDay:32},{startDate:'2028-02-30'}])expect(scheduleSchema.safeParse({...schedule,...patch}).success).toBe(false);
  expect(scheduleSchema.parse({...schedule,reminderDays:null,endDate:'2028-03-31'}).endDate).toBe('2028-03-31');
  expect(ruleChangeSchema.safeParse({fromMonth:'2028-02',schedule}).success).toBe(true);expect(planningMonthSchema.safeParse('2028-02-01').success).toBe(false);
  expect(budgetPlanSchema.safeParse(plan).success).toBe(true);expect(budgetPlanSchema.safeParse({...plan,limit:'-1'}).success).toBe(false);expect(budgetPlanSchema.safeParse({...plan,categories:[plan.categories[0],plan.categories[0]]}).success).toBe(false);
  expect(occurrenceEditSchema.safeParse({description:'Só esta',amount:'1.00',dueDate:'2028-03-01'}).success).toBe(true);
  expect(paymentSchema.safeParse({amount:'0',paidDate:'2028-02-29'}).success).toBe(false);expect(paymentSchema.safeParse({amount:'10',paidDate:'2028-02-29'}).success).toBe(true);
  expect(postponementSchema.safeParse({dueDate:'2028-03-02'}).success).toBe(true);
  expect(reconciliationSchema.safeParse({transactionId:schedule.accountId,transactionRevision:'v1',paidDate:'2028-02-29'}).success).toBe(true);
  expect(copyPlanSchema.safeParse({sourceMonth:'2028-01',sourceRevision:'v1',plan}).success).toBe(true);
});
it('moves forecast to realized once, keeps signed overruns and computes deficit after reserve',()=>{
  const occurrences=[{amount:'100.00',status:'paid' as const,categoryId:schedule.categoryId},{amount:'80.00',status:'postponed' as const,categoryId:schedule.categoryId},{amount:'50.00',status:'cancelled' as const,categoryId:schedule.categoryId}];
  const result=planningSummary([entry],occurrences,'2028-02',plan);
  expect(result.summary).toEqual({income:'0.00',realized:'100.00',pending:'80.00',committed:'180.00',remaining:'-30.00',afterReserve:'-80.00',deficit:'80.00'});
  expect(result.categoryTotals[0]).toMatchObject({realized:'100.00',pending:'80.00',committed:'180.00',remaining:'-100.00'});
  expect(planningSummary([],[],'2028-02',{...plan,expectedIncome:'500.00',categories:[]}).summary.deficit).toBe('0.00');
});
it('sums only the selected month, handles refunds and excludes transfers and archived entries exactly',()=>{
  const other='30000000-0000-4000-8000-000000000001';
  const entries=[entry,{...entry,kind:'refund',amount:'10.00'},{...entry,categoryId:other,amount:'-0.10'},{...entry,kind:'transfer'},{...entry,archivedAt:'removed'},{...entry,competenceMonth:'2028-01-01'},{...entry,kind:'income',amount:'200.00'}];
  const occurrences=[{amount:'0.20',status:'pending' as const,categoryId:other}];
  const result=planningSummary(entries,occurrences,'2028-02',{...plan,categories:[...plan.categories,{categoryId:other,limit:'0.10'}]});
  expect(result.summary).toMatchObject({income:'200.00',realized:'90.10',pending:'0.20',committed:'90.30'});expect(result.categoryTotals[1]).toMatchObject({realized:'0.10',pending:'0.20',remaining:'-0.20'});
});
