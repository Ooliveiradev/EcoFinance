'use client';
import type { FormEvent } from 'react';
import type { CardRecord } from '@ecofinance/shared';
import { FinanceDialog } from '@/components/finance-dialog';
import { Button } from '@/components/ui/button';
import { usePlanningSave,type PlanningReferences } from '../planning/planning-client-utils';
import { CardFields } from './card-fields';
export function CardDialog({row,refs,onClose,onSaved}:{row:CardRecord|null;refs:PlanningReferences;onClose:()=>void;onSaved:()=>void}) {
  const mutation=usePlanningSave(onSaved);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const f=new FormData(event.currentTarget);
    await mutation.save('/api/cards'+(row?'/'+row.id:''),row?'PUT':'POST',{name:String(f.get('name')),paymentAccountId:String(f.get('paymentAccountId')),closingDay:Number(f.get('closingDay')),dueDay:Number(f.get('dueDay'))},row?.revision);
  }
  return <FinanceDialog title={row?'Editar cartão':'Novo cartão'} busy={mutation.busy} onClose={onClose}><form className="space-y-4" onSubmit={submit}>{mutation.error&&<p role="alert">{mutation.error}</p>}<CardFields row={row} accounts={refs.accounts}/><Button type="submit" disabled={mutation.busy}>Salvar cartão</Button></form></FinanceDialog>;
}
