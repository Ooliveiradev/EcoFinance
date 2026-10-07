'use client';
import { monthLabel,type PlanningView } from '@ecofinance/shared';
import { MonthSelector } from '@/components/month-selector';
import { PlanningWorkspace } from './planning-workspace';
import type { PlanningReferences } from './planning-client-utils';
export default function PlanningClient({month,isCurrentMonth,view,refs,error}:{month:string;isCurrentMonth:boolean;view:PlanningView|null;refs:PlanningReferences;error?:string}) {
  return <div className="space-y-6"><header className="space-y-3"><h1 className="text-2xl font-bold">Planejamento</h1><p className="text-sm text-muted">{monthLabel(month)}{isCurrentMonth?' · Mês atual':''} · Previsões e despesas realizadas por competência.</p><MonthSelector currentMonth={month}/></header>
    {error&&<p role="alert" className="text-danger">{error}</p>}
    {view&&<PlanningWorkspace view={view} refs={refs}/>}
  </div>;
}
