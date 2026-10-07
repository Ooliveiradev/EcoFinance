'use client';
import type { PlanningView } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import { FinanceDialog } from '@/components/finance-dialog';
import { usePlanningSave,type PlanningReferences } from './planning-client-utils';
import { RuleDialog } from './rule-dialog';
import { BudgetDialog } from './budget-dialog';
import { OccurrenceDialog } from './occurrence-dialog';
import type { Selection } from './planning-workspace';
export function PlanningDialogs({selected,view,refs,onClose,onSaved}:{selected:Selection|null;view:PlanningView;refs:PlanningReferences;onClose:()=>void;onSaved:()=>void}) {
  if(!selected)return null;
  if(selected.kind==='rule')return <RuleDialog row={selected.row} month={view.month} refs={refs} onClose={onClose} onSaved={onSaved}/>;
  if(selected.kind==='budget')return <BudgetDialog month={view.month} plan={view.plan} categories={refs.categories} copy={selected.copy} onClose={onClose} onSaved={onSaved}/>;
  if(selected.kind==='occurrence')return <OccurrenceDialog row={selected.row} action={selected.action} onClose={onClose} onSaved={onSaved}/>;
  return <MonthStateDialog view={view} onClose={onClose} onSaved={onSaved}/>;
}
function MonthStateDialog({view,onClose,onSaved}:{view:PlanningView;onClose:()=>void;onSaved:()=>void}) {
  const {busy,error,save}=usePlanningSave(onSaved);
  return <FinanceDialog title={view.closed?'Reabrir mês':'Fechar mês'} onClose={onClose} busy={busy}>
    {error&&<p role="alert" className="text-danger">{error}</p>}
    <p className="text-sm mb-4">{view.closed?'Reabrir permite alterar o orçamento, as ocorrências e os lançamentos deste mês.':'Fechar preserva este mês. Contas pendentes permanecem previstas; pague, concilie ou cancele antes de fechar se desejar resolver todas. Ajustes individuais e pagamentos ficam bloqueados até reabrir.'}</p><Button disabled={busy} onClick={()=>save('/api/planning/'+view.month+'/state','POST',{action:view.closed?'reopen':'close'},view.monthRevision)}>{view.closed?'Confirmar reabertura':'Confirmar fechamento'}</Button>
  </FinanceDialog>;
}
