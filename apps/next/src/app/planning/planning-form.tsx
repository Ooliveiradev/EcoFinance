'use client';
import type { BudgetPlan } from '@ecofinance/shared';
import type { PlanningReference } from './planning-client-utils';
import { Input } from '@/components/ui/input';
export function PlanFields({plan,categories}:{plan:BudgetPlan|null;categories:PlanningReference[]}) {
  return <div className="space-y-4">
    <label className="block text-sm">Teto de despesas (R$)<Input name="limit" inputMode="decimal" defaultValue={plan?.limit??'0.00'} required/></label>
    <label className="block text-sm">Renda prevista (R$)<Input name="expectedIncome" inputMode="decimal" defaultValue={plan?.expectedIncome??'0.00'} required/></label>
    <label className="block text-sm">Reserva planejada (R$)<Input name="reserve" inputMode="decimal" defaultValue={plan?.reserve??'0.00'} required/></label>
    <fieldset className="space-y-3"><legend className="font-semibold">Limites por categoria</legend><p className="text-xs text-muted">Deixe vazio para remover o limite; zero é um limite de zero reais. Os limites são independentes do teto total.</p>
      {categories.filter(c=>!c.archivedAt||plan?.categories.some(p=>p.categoryId===c.id)).map(c=><label key={c.id} className="block text-sm break-words">{c.name}{c.archivedAt?' (arquivada)':''}<Input aria-label={'Limite '+c.name} name={'category:'+c.id} inputMode="decimal" placeholder="Sem limite" defaultValue={plan?.categories.find(p=>p.categoryId===c.id)?.limit??''}/></label>)}
    </fieldset>
  </div>;
}
