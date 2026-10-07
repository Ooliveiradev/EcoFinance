'use client';
import type { FormEvent } from 'react';
import type { CardRecord,InvoiceView } from '@ecofinance/shared';
import { FinanceDialog } from '@/components/finance-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { usePlanningSave,moneyText } from '../planning/planning-client-utils';
import { CardAmount } from './card-fields';
export function InvoiceDialog({card,invoice,onClose,onSaved}:{card:CardRecord;invoice:InvoiceView;onClose:()=>void;onSaved:()=>void}) {
  const mutation=usePlanningSave(onSaved);
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget),stated=moneyText(f.get('statedTotal'));await mutation.save('/api/cards/'+card.id+'/invoices/'+invoice.month,'PUT',{statedTotal:stated||null,previousBalance:moneyText(f.get('previousBalance')),closed:f.get('closed')==='on'},invoice.revision);}
  return <FinanceDialog title="Revisar fatura" busy={mutation.busy} onClose={onClose}><form className="space-y-4" onSubmit={submit}>{mutation.error&&<p role="alert">{mutation.error}</p>}<label className="block text-sm">Total informado na fatura (R$)<Input name="statedTotal" inputMode="decimal" defaultValue={invoice.statedTotal??''} placeholder="Não informado"/></label><CardAmount label="Saldo anterior (R$)" name="previousBalance" value={invoice.previousBalance}/><p className="text-sm text-muted">Saldo anterior é dívida transportada, sem nova despesa. Use valor negativo para crédito anterior. O total informado inclui esse saldo e os itens, antes dos pagamentos desta fatura. A diferença permanece visível até a conciliação.</p><label className="flex gap-2 text-sm"><input type="checkbox" name="closed" defaultChecked={invoice.closed}/>Fatura recebida / fechada</label><Button type="submit" disabled={mutation.busy}>Salvar fatura</Button></form></FinanceDialog>;
}
