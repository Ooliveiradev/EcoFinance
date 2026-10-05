'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  TRANSACTION_CATEGORY_OPTIONS,
  civilToday,
} from '@ecofinance/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  accounts?: Array<{ id: string; name: string }>;
}

const EMPTY_ACCOUNTS: Array<{ id: string; name: string }> = [];

export function AddExpenseModal(props: AddExpenseModalProps) {
  if (!props.isOpen) return null;
  return <ExpenseDialog {...props} />;
}

function ExpenseDialog({
  onClose,
  onSuccess,
  accounts = EMPTY_ACCOUNTS,
}: AddExpenseModalProps) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => civilToday(new Date()));
  const [category, setCategory] = useState<string>('comida');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const initialRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    initialRef.current?.focus();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Por favor, informe a descrição do gasto.');
      return;
    }
    const cleanAmount = amount.replace(/[^\d.,]/g, '').replace(',', '.');
    const numericAmount = parseFloat(cleanAmount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError('Informe um valor válido maior que zero.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // POST to create transaction or manual expense
      const res = await fetch('/api/transactions/notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description: description.trim(),
          amount: -Math.abs(numericAmount), // expenses are negative
          bankName: accounts.find((a) => a.id === accountId)?.name ?? 'Manual',
          latitude: null,
          longitude: null,
          timestamp: `${date}T12:00:00Z`,
        }),
      });

      if (!res.ok) {
        // If unauthenticated or forbidden, report real error
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Erro ao registrar gasto.');
      }

      setSuccess(true);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na comunicação com o servidor.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="add-expense-title"
      className="fixed inset-0 m-auto w-full max-w-lg max-h-[90dvh] overflow-y-auto p-4 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-xs animate-fade-in"
    >
      <div className="relative w-full max-w-md bg-surface text-foreground border border-border rounded-2xl shadow-xl overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-muted/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-danger/10 text-danger flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </div>
            <h2 id="add-expense-title" className="text-base font-bold text-foreground">
              Adicionar Gasto
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-muted transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-danger-soft text-danger border border-danger/20 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div role="status" className="p-3 bg-success-soft text-success border border-success/20 rounded-xl text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Gasto registrado com sucesso!</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="expense-desc" className="text-xs font-semibold text-muted">
              Descrição do gasto *
            </label>
            <Input
              id="expense-desc"
              ref={initialRef}
              placeholder="Ex: Supermercado, Almoço..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading || success}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="expense-amount" className="text-xs font-semibold text-muted">
                Valor (R$) *
              </label>
              <Input
                id="expense-amount"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isLoading || success}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="expense-date" className="text-xs font-semibold text-muted">
                Data do gasto *
              </label>
              <Input
                id="expense-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isLoading || success}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="expense-category" className="text-xs font-semibold text-muted">
              Categoria
            </label>
            <select
              id="expense-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={isLoading || success}
              className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-sm text-foreground focus-visible:outline-none cursor-pointer"
            >
              {TRANSACTION_CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {accounts.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="expense-account" className="text-xs font-semibold text-muted">
                Conta de saída
              </label>
              <select
                id="expense-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={isLoading || success}
                className="w-full h-10 px-3 rounded-xl border border-border bg-surface text-sm text-foreground focus-visible:outline-none cursor-pointer"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isLoading || success}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="default"
              disabled={isLoading || success}
            >
              {isLoading ? 'Salvando...' : 'Salvar Gasto'}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
