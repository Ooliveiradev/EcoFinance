import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { CardRecord, CardTransaction, InvoiceView } from '@ecofinance/shared';
import { archiveCardMutation, cardForm, cardMutation, paymentMutation, purchasePreview, type PaymentForm, type PurchaseForm } from '../data/cards';
import { cacheName } from '../data/cache';
import { money, moneyInput } from '../data/format';
import { NO_NOTICE, outcomeMessage, type NoticeState } from '../data/outcome';
import { read } from '../data/resources';
import { useStack, type StackProps } from '../navigation';
import { useData, useResource, useSaver } from '../ui/data-context';
import { Badge, Box, Button, Choice, ErrorState, Field, ListItem, Loading, MoneyLine, MonthBar, Muted, Notice, Screen, SourceBanner, Title } from '../ui/kit';

type Options = (readonly [string, string])[];
const TYPE: Record<CardTransaction['type'], string> = { purchase: 'compra', interest: 'juros', fee: 'tarifa', credit: 'crédito', refund: 'estorno', payment: 'pagamento' };

export function CardsScreen() {
  const navigation = useStack();
  const { outbox } = useData();
  const { loaded, error, loading, refreshing, reload } = useResource('cards', read.cards);
  const drafts = outbox.filter(item => item.kind.startsWith('card:') || item.kind === 'invoice:pay');
  return <Screen refreshing={refreshing} onRefresh={reload}>
    <Button label="Novo cartão" onPress={() => navigation.navigate('CardForm', {})} />
    {drafts.length ? <Box tone="warning"><Muted>{drafts.length} operação(ões) de cartão pendente(s) neste aparelho.</Muted></Box> : null}
    {loading ? <Loading /> : null}
    {error ? <ErrorState error={error} onRetry={reload} /> : null}
    {loaded ? <>
      <SourceBanner loaded={loaded} />
      {loaded.data.cards.length === 0 ? <Muted>Nenhum cartão cadastrado.</Muted> : null}
      {loaded.data.cards.map(card => <ListItem key={card.id} title={card.name} subtitle={`Fecha dia ${card.closingDay} · vence dia ${card.dueDay}${card.archived ? ' · arquivado' : ''}`}
        onPress={() => navigation.navigate('Invoice', { card })} />)}
    </> : null}
  </Screen>;
}

function CardEditor({ card, accounts }: { card?: CardRecord; accounts: Options }) {
  const navigation = useStack();
  const { busy, notice, send } = useSaver();
  const [form, setForm] = useState(() => cardForm(card));
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(build: () => ReturnType<typeof cardMutation>) {
    const built = build();
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    if ((await send(built.mutation)).status === 'synced') navigation.popToTop();
  }
  return <Screen>
    <Field label="Nome" value={form.name} onChangeText={name => setForm({ ...form, name })} error={errors.name} />
    <Choice label="Conta de pagamento" options={accounts} value={form.paymentAccountId} onChange={paymentAccountId => setForm({ ...form, paymentAccountId })} error={errors.paymentAccountId} />
    <Field label="Dia de fechamento (1–31)" value={form.closingDay} onChangeText={closingDay => setForm({ ...form, closingDay })} keyboardType="number-pad" error={errors.closingDay} />
    <Field label="Dia de vencimento (1–31)" value={form.dueDay} onChangeText={dueDay => setForm({ ...form, dueDay })} keyboardType="number-pad" error={errors.dueDay} />
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Salvando…' : 'Salvar cartão'} disabled={busy} onPress={() => void submit(() => cardMutation(form, card))} />
    {card ? <Button label={card.archived ? 'Restaurar cartão' : 'Arquivar cartão'} variant={card.archived ? 'secondary' : 'danger'} disabled={busy}
      onPress={() => void submit(() => ({ ok: true, mutation: archiveCardMutation(card) }))} /> : null}
  </Screen>;
}

export function CardFormScreen({ route, navigation }: StackProps<'CardForm'>) {
  const { card } = route.params;
  const refs = useResource('references', read.references);
  useEffect(() => { navigation.setOptions({ title: card ? 'Editar cartão' : 'Novo cartão' }); }, [navigation, card]);
  if (refs.error && !refs.loaded) return <Screen><ErrorState error={refs.error} onRetry={refs.reload} /></Screen>;
  if (!refs.loaded) return <Screen><Loading /></Screen>;
  const accounts = refs.loaded.data.accounts.filter(row => !row.archivedAt || row.id === card?.paymentAccountId).map(row => [row.id, row.name] as const);
  return <CardEditor card={card} accounts={accounts} />;
}

function InvoiceTotals({ view }: { view: InvoiceView }) {
  const divergent = view.totals.divergence !== null && view.totals.divergence !== '0.00';
  return <Box>
    <Title>Fatura de {view.month}</Title>
    <Muted>Fecha {view.closingDate} · vence {view.dueDate} · {view.closed ? 'fechada' : 'aberta'}</Muted>
    <MoneyLine label="Saldo anterior" value={view.previousBalance} />
    <MoneyLine label="Compras" value={view.totals.purchases} />
    <MoneyLine label="Juros e tarifas" value={view.totals.charges} />
    <MoneyLine label="Créditos e estornos" value={view.totals.credits} />
    <MoneyLine label="Total calculado" value={view.totals.computed} strong />
    <MoneyLine label="Pagamentos" value={view.totals.payments} />
    <MoneyLine label="Restante" value={view.totals.remaining} strong />
    {divergent ? <Badge label={`Divergência com o total do banco: ${money(view.totals.divergence)}`} tone="danger" /> : null}
  </Box>;
}

function PurchaseBox({ card, categories, onClose, onDone }: { card: CardRecord; categories: Options; onClose: () => void; onDone: (notice: NoticeState) => void }) {
  const { month, today } = useData();
  const { busy, notice, send } = useSaver();
  const [form, setForm] = useState<PurchaseForm>(() => ({ description: '', categoryId: '', totalAmount: '', count: '1', purchaseDate: today, firstMonth: month }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const preview = purchasePreview(card, form);
  async function confirm() {
    if (!preview.ok) { setErrors(preview.errors); return; }
    const outcome = await send(preview.mutation);
    if (outcome.status === 'synced' || outcome.status === 'pending') onDone(outcomeMessage(outcome));
  }
  return <Box>
    <Title>Nova compra</Title>
    <Field label="Descrição" value={form.description} onChangeText={description => setForm({ ...form, description })} error={errors.description} />
    <Choice label="Categoria" options={categories} value={form.categoryId} onChange={categoryId => setForm({ ...form, categoryId })} error={errors.categoryId} />
    <Field label="Valor total (R$)" value={form.totalAmount} onChangeText={totalAmount => setForm({ ...form, totalAmount })} keyboardType="decimal-pad" error={errors.totalAmount} />
    <Field label="Parcelas (1–24)" value={form.count} onChangeText={count => setForm({ ...form, count })} keyboardType="number-pad" error={errors.count} />
    <Field label="Data da compra (AAAA-MM-DD)" value={form.purchaseDate} onChangeText={purchaseDate => setForm({ ...form, purchaseDate })} error={errors.purchaseDate} />
    <Field label="Primeira fatura (AAAA-MM)" value={form.firstMonth} onChangeText={firstMonth => setForm({ ...form, firstMonth })} error={errors.firstMonth} />
    {preview.ok ? <Muted>Confira as parcelas antes de confirmar:</Muted> : null}
    {preview.ok ? preview.parts.map(part => <MoneyLine key={part.number} label={`${part.number}/${preview.parts.length} · fatura ${part.month}`} value={part.amount} />) : null}
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Enviando…' : 'Confirmar compra'} disabled={busy} onPress={() => void confirm()} />
    <Button label="Voltar" variant="secondary" onPress={onClose} />
  </Box>;
}

function PaymentBox({ card, view, categories, onClose, onDone }: { card: CardRecord; view: InvoiceView; categories: Options; onClose: () => void; onDone: (notice: NoticeState) => void }) {
  const { today } = useData();
  const { busy, notice, send } = useSaver();
  const [form, setForm] = useState<PaymentForm>(() => ({ amount: view.totals.remaining.startsWith('-') ? '' : moneyInput(view.totals.remaining), paidDate: today, categoryId: '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function confirm() {
    const built = paymentMutation(card, view, form);
    if (!built.ok) { setErrors(built.errors); return; }
    const outcome = await send(built.mutation);
    if (outcome.status === 'synced' || outcome.status === 'pending') onDone(outcomeMessage(outcome));
  }
  return <Box>
    <Title>Pagamento da fatura</Title>
    <Muted>O pagamento sai da conta de pagamento do cartão e não cria uma despesa adicional.</Muted>
    <Field label="Valor (R$)" value={form.amount} onChangeText={amount => setForm({ ...form, amount })} keyboardType="decimal-pad" error={errors.amount} />
    <Field label="Data (AAAA-MM-DD)" value={form.paidDate} onChangeText={paidDate => setForm({ ...form, paidDate })} error={errors.paidDate} />
    <Choice label="Categoria do pagamento" options={categories} value={form.categoryId} onChange={categoryId => setForm({ ...form, categoryId })} error={errors.categoryId} />
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Enviando…' : 'Confirmar pagamento'} disabled={busy} onPress={() => void confirm()} />
    <Button label="Voltar" variant="secondary" onPress={onClose} />
  </Box>;
}

function InvoiceBody({ card, view }: { card: CardRecord; view: InvoiceView }) {
  const navigation = useStack();
  const refs = useResource('references', read.references);
  const [mode, setMode] = useState<'purchase' | 'pay' | null>(null);
  const [notice, setNotice] = useState<NoticeState>(NO_NOTICE);
  const done = (next: NoticeState) => { setNotice(next); setMode(null); };
  const categories = (refs.loaded?.data.categories ?? []).filter(row => !row.archivedAt).map(row => [row.id, row.name] as const);
  const editable = !card.archived && !view.monthClosed && !mode;
  return <>
    <InvoiceTotals view={view} />
    <Notice message={notice.message} tone={notice.tone} />
    {editable ? <View style={{ gap: 8 }}>
      <Button label="Registrar compra" onPress={() => setMode('purchase')} />
      <Button label="Pagar fatura" variant="secondary" disabled={view.revision === 'new'} hint={view.revision === 'new' ? 'Fatura ainda sem lançamentos' : undefined} onPress={() => setMode('pay')} />
    </View> : null}
    {mode === 'purchase' ? <PurchaseBox card={card} categories={categories} onClose={() => setMode(null)} onDone={done} /> : null}
    {mode === 'pay' ? <PaymentBox card={card} view={view} categories={categories} onClose={() => setMode(null)} onDone={done} /> : null}
    <Title>Lançamentos da fatura</Title>
    {view.entries.length === 0 ? <Muted>Nenhum lançamento nesta fatura.</Muted> : null}
    {view.entries.map(entry => <ListItem key={entry.id} title={entry.description}
      subtitle={`${entry.purchaseDate} · ${TYPE[entry.type]}${entry.installmentNumber ? ` · parcela ${entry.installmentNumber}/${entry.installmentCount}` : ''}`}
      right={money(entry.amount)} />)}
    <Button label="Editar cartão" variant="secondary" onPress={() => navigation.navigate('CardForm', { card })} />
  </>;
}

export function InvoiceScreen({ route, navigation }: StackProps<'Invoice'>) {
  const { card } = route.params;
  const { month, setMonth } = useData();
  const invoice = useResource(cacheName('invoice', card.id, month), () => read.invoice(card.id, month));
  useEffect(() => { navigation.setOptions({ title: card.name }); }, [navigation, card.name]);
  return <Screen refreshing={invoice.refreshing} onRefresh={invoice.reload}>
    <MonthBar month={month} onChange={setMonth} />
    {invoice.loading ? <Loading /> : null}
    {invoice.error ? <ErrorState error={invoice.error} onRetry={invoice.reload} /> : null}
    {invoice.loaded ? <>
      <SourceBanner loaded={invoice.loaded} />
      <InvoiceBody card={card} view={invoice.loaded.data} />
    </> : null}
  </Screen>;
}
