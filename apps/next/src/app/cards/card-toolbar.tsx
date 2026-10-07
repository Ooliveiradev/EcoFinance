import type { CardRecord,InvoiceView } from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import type { CardSelection } from './cards-dialogs';
export function CardToolbar({invoice,disabled,onSelect}:{invoice:InvoiceView;disabled:boolean;onSelect:(s:CardSelection)=>void}) {
  const available=invoice.revision!=='new';
  return <><div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={()=>onSelect('purchase')}>Registrar compra / parcelas</Button><Button variant="outline" disabled={disabled} onClick={()=>onSelect('invoice')}>Revisar fatura</Button><Button variant="outline" disabled={disabled||!available} onClick={()=>onSelect('item')}>Adicionar encargo / crédito</Button><Button variant="outline" disabled={disabled||!available} onClick={()=>onSelect('reconcile')}>Conciliar compra</Button><Button disabled={disabled||!available||BigInt(invoice.totals.remaining.replace('.',''))<=0n} onClick={()=>onSelect('pay')}>Pagar fatura</Button></div>{!available&&<p className="text-sm text-muted">Registre uma compra ou salve a revisão para abrir esta fatura.</p>}</>;
}
export function CardActions({card,busy,onSelect,onArchive}:{card:CardRecord|undefined;busy:boolean;onSelect:(s:CardSelection)=>void;onArchive:()=>void}) {
  return <div className="flex flex-wrap gap-2"><Button onClick={()=>onSelect('new-card')}>Novo cartão</Button>{card&&<><Button variant="outline" onClick={()=>onSelect('edit-card')}>Editar cartão</Button><Button variant="ghost" disabled={busy} onClick={onArchive}>{card.archived?'Restaurar cartão':'Arquivar cartão'}</Button></>}</div>;
}
