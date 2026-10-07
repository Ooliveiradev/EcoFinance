'use client';
import { formatCents,type PlanningOccurrence } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { selectClass } from './planning-client-utils';
import type { OccurrenceAction } from './occurrence-dialog';
import type { Candidate } from './occurrence-client';
export function OccurrenceFields({action,row,today,candidate}:{action:OccurrenceAction;row:PlanningOccurrence;today:string;candidate:Candidate|undefined}) {
  if(action==='edit')return <><label className="block text-sm">Descrição<Input name="description" defaultValue={row.description} required maxLength={500}/></label><label className="block text-sm">Valor previsto (R$)<Input name="amount" inputMode="decimal" defaultValue={row.amount} required/></label><DueDate row={row}/></>;
  if(action==='postpone')return <DueDate row={row}/>;
  return <>{action==='pay'&&<label className="block text-sm">Valor pago (R$)<Input name="amount" inputMode="decimal" defaultValue={row.amount} required/></label>}<label className="block text-sm">Data de pagamento<Input key={candidate?.id??'manual'} name="paidDate" type="date" defaultValue={candidate?.paidDate??today} readOnly={!!candidate?.paidDate} required/></label></>;
}
function DueDate({row}:{row:PlanningOccurrence}) {return <label className="block text-sm">Novo vencimento<Input name="dueDate" type="date" defaultValue={row.dueDate} required/></label>;}
export function ReconciliationFields({candidates,selected,busy,onLoad,onSelect}:{candidates:Candidate[]|null;selected:string;busy:boolean;onLoad:()=>void;onSelect:(id:string)=>void}) {
  return <><p className="text-sm text-muted">Escolha uma despesa já importada da mesma conta e mês, ainda sem vínculo. A conciliação reutiliza esse lançamento e retira a previsão, sem criar outra despesa.</p><Button type="button" variant="outline" disabled={busy} onClick={onLoad}>Carregar lançamentos importados</Button>{candidates&&<label className="block text-sm">Lançamento importado<select aria-label="Lançamento importado" className={selectClass} value={selected} onChange={e=>onSelect(e.target.value)} required><option value="">Escolha</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.description} · {formatCents(-BigInt(c.amount.replace('.','')))} · {c.source}</option>)}</select></label>}{candidates?.length===0&&<p className="text-sm text-muted">Nenhuma despesa importada livre nesta conta e competência.</p>}</>;
}
