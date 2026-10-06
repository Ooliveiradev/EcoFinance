'use client';
import { EntryDialog,type EntryReference } from './entry-dialog';
import { FinanceDialog } from './finance-dialog';
const EMPTY_REFERENCES:EntryReference[]=[];
interface AddExpenseModalProps {isOpen:boolean;onClose:()=>void;onSuccess?:()=>void;accounts?:EntryReference[];categories?:EntryReference[];loading?:boolean;error?:string}
export function AddExpenseModal({isOpen,onClose,onSuccess,accounts=EMPTY_REFERENCES,categories=EMPTY_REFERENCES,loading=false,error=''}:AddExpenseModalProps) {
  if(!isOpen)return null;
  if(loading || error)return <FinanceDialog title="Adicionar Gasto" onClose={onClose}><p role={error?'alert':'status'}>{error||'Carregando contas e categorias…'}</p></FinanceDialog>;
  return <EntryDialog accounts={accounts} categories={categories} onClose={onClose} onSaved={()=>{onSuccess?.();onClose();}}/>;
}
