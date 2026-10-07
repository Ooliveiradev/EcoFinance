import { cardPurchaseSchema, cardSchema, installmentPlan, invoicePaymentSchema, type CardRecord, type InvoiceView } from '@ecofinance/shared';
import { fieldErrors, parseMoneyInput } from './format';
import type { Mutation } from './outbox';

type Built = { ok: true; mutation: Mutation } | { ok: false; errors: Record<string, string> };
export interface CardForm { name: string; paymentAccountId: string; closingDay: string; dueDay: string }
export function cardForm(card?: CardRecord): CardForm {
  return card ? { name: card.name, paymentAccountId: card.paymentAccountId, closingDay: String(card.closingDay), dueDay: String(card.dueDay) } : { name: '', paymentAccountId: '', closingDay: '1', dueDay: '10' };
}
export function cardMutation(form: CardForm, card?: CardRecord): Built {
  const parsed = cardSchema.safeParse({ name: form.name, paymentAccountId: form.paymentAccountId, closingDay: Number(form.closingDay), dueDay: Number(form.dueDay) });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, mutation: {
    method: card ? 'PUT' : 'POST', path: card ? `/api/cards/${card.id}` : '/api/cards', body: parsed.data, ifMatch: card?.revision ?? null,
    label: `${card ? 'Editar cartão' : 'Novo cartão'}: ${parsed.data.name}`, resource: card ? { type: 'card', id: card.id } : null, kind: 'card:save',
  } };
}
export function archiveCardMutation(card: CardRecord): Mutation {
  return {
    method: 'PATCH', path: `/api/cards/${card.id}`, body: { action: card.archived ? 'restore' : 'archive' }, ifMatch: card.revision,
    label: `${card.archived ? 'Restaurar' : 'Arquivar'} cartão: ${card.name}`, resource: { type: 'card', id: card.id }, kind: 'card:archive',
  };
}
export interface PurchaseForm { description: string; categoryId: string; totalAmount: string; count: string; purchaseDate: string; firstMonth: string }
export type PurchasePreview = { ok: true; parts: ReturnType<typeof installmentPlan>; mutation: Mutation } | { ok: false; errors: Record<string, string> };
/** The installment split shown before confirming is the shared one the server will apply. */
export function purchasePreview(card: CardRecord, form: PurchaseForm): PurchasePreview {
  const totalAmount = parseMoneyInput(form.totalAmount);
  if (totalAmount === null) return { ok: false, errors: { totalAmount: 'Informe um valor como 300,00.' } };
  const parsed = cardPurchaseSchema.safeParse({ description: form.description, categoryId: form.categoryId, totalAmount, count: Number(form.count), purchaseDate: form.purchaseDate, firstMonth: form.firstMonth, confirmed: true });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const count = parsed.data.count;
  return { ok: true, parts: installmentPlan(parsed.data), mutation: {
    method: 'POST', path: `/api/cards/${card.id}/purchases`, body: parsed.data, ifMatch: null,
    label: `Compra no ${card.name}: ${parsed.data.description}${count > 1 ? ` (${count}x)` : ''}`, resource: null, kind: 'card:purchase',
  } };
}
export interface PaymentForm { amount: string; paidDate: string; categoryId: string }
export function paymentMutation(card: CardRecord, invoice: InvoiceView, form: PaymentForm): Built {
  const amount = parseMoneyInput(form.amount);
  if (amount === null) return { ok: false, errors: { amount: 'Informe um valor como 12,34.' } };
  const parsed = invoicePaymentSchema.safeParse({ amount, paidDate: form.paidDate, categoryId: form.categoryId, transactionId: null, transactionRevision: null, confirmed: true });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  return { ok: true, mutation: {
    method: 'POST', path: `/api/invoices/${invoice.id}/pay`, body: parsed.data, ifMatch: invoice.revision,
    label: `Pagamento da fatura ${invoice.month} do ${card.name}`, resource: { type: 'invoice', cardId: card.id, month: invoice.month }, kind: 'invoice:pay',
  } };
}
