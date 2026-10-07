import type { CardRecord } from '@ecofinance/shared';
import { Input } from '@/components/ui/input';
import { selectClass,type PlanningReference } from '../planning/planning-client-utils';
export function CardSelect({label,name,rows,value}:{label:string;name:string;rows:PlanningReference[];value?:string}) {
  return <label className="block text-sm">{label}<select aria-label={label} name={name} className={selectClass} required defaultValue={value??''}><option value="">Selecione</option>{rows.filter(r=>!r.archivedAt||r.id===value).map(r=><option key={r.id} value={r.id}>{r.name}{r.archivedAt?' (arquivada)':''}</option>)}</select></label>;
}
export function CardFields({row,accounts}:{row:CardRecord|null;accounts:PlanningReference[]}) {
  return <><label className="block text-sm">Nome do cartão<Input name="name" defaultValue={row?.name??''} maxLength={120} required/></label><CardSelect label="Conta de pagamento" name="paymentAccountId" rows={accounts} value={row?.paymentAccountId}/><label className="block text-sm">Dia de fechamento<Input name="closingDay" type="number" min={1} max={31} defaultValue={row?.closingDay??25} required/></label><label className="block text-sm">Dia de vencimento<Input name="dueDay" type="number" min={1} max={31} defaultValue={row?.dueDay??5} required/></label><p className="text-sm text-muted">Mudanças valem para novas faturas. Faturas existentes preservam suas datas e conta de pagamento.</p></>;
}
export function CardAmount({label,value,name='amount'}:{label:string;value?:string;name?:string}) {return <label className="block text-sm">{label}<Input name={name} inputMode="decimal" defaultValue={value??''} required/></label>;}
export function CardDate({label,name,value,type='date'}:{label:string;name:string;value:string;type?:'date'|'month'}) {return <label className="block text-sm">{label}<Input type={type} name={name} defaultValue={value} required/></label>;}
export function CardConfirmation({label}:{label:string}) {return <label className="flex gap-2 text-sm"><input type="checkbox" name="confirmed" required/>{label}</label>;}
