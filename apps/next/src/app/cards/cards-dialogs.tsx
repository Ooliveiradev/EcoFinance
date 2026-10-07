import type { CardRecord,CardTransaction,InvoiceView } from '@ecofinance/shared';
import type { PlanningReferences } from '../planning/planning-client-utils';
import { CardDialog } from './card-dialog';
import { PurchaseDialog } from './purchase-dialog';
import { InvoiceDialog } from './invoice-dialog';
import { ItemDialog } from './item-dialog';
import { PaymentDialog } from './payment-dialog';
import { ReconcileDialog } from './reconcile-dialog';
import { CardOccurrenceDialog } from './card-occurrence-dialog';
export type CardSelection='new-card'|'edit-card'|'purchase'|'invoice'|'item'|'pay'|'reconcile'|{entry:CardTransaction}|null;
export function CardsDialogs({selection,card,invoice,month,refs,onClose,onSaved}:{selection:CardSelection;card:CardRecord|undefined;invoice:InvoiceView|null;month:string;refs:PlanningReferences;onClose:()=>void;onSaved:()=>void}) {
  const props={onClose,onSaved};
  if(selection==='new-card'||selection==='edit-card')return <CardDialog row={selection==='edit-card'?card??null:null} refs={refs} {...props}/>;
  if(!card||!invoice||!selection)return null;
  if(typeof selection==='object')return <CardOccurrenceDialog invoice={invoice} entry={selection.entry} {...props}/>;
  if(selection==='purchase')return <PurchaseDialog card={card} month={month} refs={refs} {...props}/>;
  if(selection==='invoice')return <InvoiceDialog card={card} invoice={invoice} {...props}/>;
  if(selection==='item')return <ItemDialog card={card} invoice={invoice} refs={refs} {...props}/>;
  if(selection==='pay')return <PaymentDialog invoice={invoice} refs={refs} {...props}/>;
  return <ReconcileDialog invoice={invoice} {...props}/>;
}
