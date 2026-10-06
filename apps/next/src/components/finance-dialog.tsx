'use client';
import { useEffect,useId,useRef,type ReactNode } from 'react';
import { Button } from './ui/button';
export function FinanceDialog({title,onClose,children,busy=false}:{title:string;onClose:()=>void;children:ReactNode;busy?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),label=useId();
  useEffect(()=> {
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const current=dialog.current;current?.showModal();
    current?.querySelector<HTMLElement>('input,select,textarea')?.focus();
    return ()=>{current?.close();if(previous?.isConnected)previous.focus();};
  },[]);
  return <dialog ref={dialog} onCancel={event=>{if(busy)event.preventDefault();else onClose();}} aria-labelledby={label} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-6 text-foreground shadow-xl backdrop:bg-black/60">
    <div className="flex items-center justify-between gap-4 mb-5"><h2 id={label} className="text-lg font-semibold">{title}</h2><Button type="button" variant="ghost" aria-label="Fechar modal" onClick={onClose} disabled={busy}>Fechar</Button></div>
    {children}
  </dialog>;
}
