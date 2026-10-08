import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { PlanningOccurrence, PlanningView } from '@ecofinance/shared';
import { money, moneyInput } from '../data/format';
import { budgetForm, budgetMutation, generateMutation, occurrenceMutation, ruleMutation, type OccurrenceAction, type RuleForm } from '../data/planning';
import { read } from '../data/resources';
import { useStack, type StackProps } from '../navigation';
import { useData, useResource, useSaver } from '../ui/data-context';
import { Badge, Box, Button, Choice, ErrorState, Field, Loading, MoneyLine, MonthBar, Muted, Notice, Screen, SourceBanner, Title } from '../ui/kit';
import { styles } from '../ui/theme';

const STATUS: Record<PlanningOccurrence['status'], string> = { pending: 'pendente', paid: 'pago', postponed: 'adiado', cancelled: 'cancelado' };
const isOpen = (occurrence: PlanningOccurrence) => occurrence.status === 'pending' || occurrence.status === 'postponed';

function OccurrenceForm({ occurrence, month, mode, onClose }: { occurrence: PlanningOccurrence; month: string; mode: 'pay' | 'postpone'; onClose: () => void }) {
  const { today } = useData();
  const { busy, notice, send } = useSaver();
  const [amount, setAmount] = useState(() => moneyInput(occurrence.amount));
  const [date, setDate] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function confirm() {
    const built = occurrenceMutation(occurrence, month, mode, { amount, date: date ?? today });
    if (!built.ok) { setErrors(built.errors); return; }
    const outcome = await send(built.mutation);
    if (outcome.status !== 'rejected') onClose();
  }
  return <>
    {mode === 'pay' ? <Field label="Valor pago (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" error={errors.amount} /> : null}
    <Field label={mode === 'pay' ? 'Data do pagamento (AAAA-MM-DD)' : 'Novo vencimento (AAAA-MM-DD)'} value={date ?? today} onChangeText={setDate} error={errors.paidDate ?? errors.dueDate} />
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Enviando…' : mode === 'pay' ? 'Confirmar pagamento' : 'Confirmar adiamento'} disabled={busy} onPress={() => void confirm()} />
    <Button label="Voltar" variant="secondary" onPress={onClose} />
  </>;
}

function OccurrenceRow({ occurrence, month, closed, pending }: { occurrence: PlanningOccurrence; month: string; closed: boolean; pending: boolean }) {
  const { busy, notice, send } = useSaver();
  const [mode, setMode] = useState<'pay' | 'postpone' | null>(null);
  const act = (action: OccurrenceAction) => {
    const built = occurrenceMutation(occurrence, month, action);
    if (built.ok) void send(built.mutation);
  };
  const actionable = !closed && !mode;
  return <Box>
    <View style={styles.line}>
      <Text style={styles.itemTitle}>{occurrence.description}</Text>
      <Text style={styles.itemRight}>{money(occurrence.amount)}</Text>
    </View>
    <Muted>Vence {occurrence.dueDate} · {STATUS[occurrence.status]}{occurrence.estimated ? ' · valor estimado' : ''}</Muted>
    {pending ? <Badge label="Ação pendente de envio" /> : null}
    <Notice message={notice.message} tone={notice.tone} />
    {actionable && isOpen(occurrence) ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button label="Pagar" onPress={() => setMode('pay')} />
      <Button label="Adiar" variant="secondary" onPress={() => setMode('postpone')} />
      <Button label="Cancelar" variant="danger" disabled={busy} onPress={() => act('cancel')} />
    </View> : null}
    {actionable && occurrence.status === 'cancelled' ? <Button label="Restaurar" variant="secondary" disabled={busy} onPress={() => act('restore')} /> : null}
    {mode ? <OccurrenceForm occurrence={occurrence} month={month} mode={mode} onClose={() => setMode(null)} /> : null}
  </Box>;
}

function BudgetBox({ view, month }: { view: PlanningView; month: string }) {
  const navigation = useStack();
  const plan = view.plan;
  return <Box>
    <Title>Orçamento</Title>
    {plan ? <>
      <MoneyLine label="Limite de gastos" value={plan.limit} />
      <MoneyLine label="Renda prevista" value={plan.expectedIncome} />
      <MoneyLine label="Reserva" value={plan.reserve} />
    </> : <Muted>Sem orçamento para este mês. Limite disponível e saldo após reserva não são calculados sem ele.</Muted>}
    <MoneyLine label="Realizado" value={view.summary.realized} />
    <MoneyLine label="Previsto pendente" value={view.summary.pending} />
    <MoneyLine label="Comprometido" value={view.summary.committed} strong />
    {plan ? <>
      <MoneyLine label="Disponível no limite" value={view.summary.remaining} />
      <MoneyLine label="Após reserva" value={view.summary.afterReserve} strong />
      <MoneyLine label="Déficit" value={view.summary.deficit} />
    </> : null}
    {!view.closed ? <Button label={plan ? 'Editar orçamento' : 'Definir orçamento'} variant="secondary" onPress={() => navigation.navigate('Budget', { month, plan })} /> : null}
  </Box>;
}

function Occurrences({ view, month }: { view: PlanningView; month: string }) {
  const navigation = useStack();
  const { outbox } = useData();
  const { notice, send } = useSaver();
  const pending = new Set(outbox.flatMap(item => item.resource?.type === 'occurrence' ? [item.resource.id] : []));
  return <>
    <Title>Previstos e recorrências</Title>
    {!view.closed ? <View style={{ gap: 8 }}>
      <Button label="Gerar previstos do mês" variant="secondary" onPress={() => void send(generateMutation(month))} />
      <Button label="Nova recorrência" variant="secondary" onPress={() => navigation.navigate('RecurrenceForm', { month })} />
    </View> : null}
    <Notice message={notice.message} tone={notice.tone} />
    {view.occurrences.length === 0 ? <Muted>Nenhum previsto neste mês. Gere os previstos a partir das recorrências.</Muted> : null}
    {view.occurrences.map(occurrence => <OccurrenceRow key={occurrence.id} occurrence={occurrence} month={month} closed={view.closed} pending={pending.has(occurrence.id)} />)}
  </>;
}

export function PlanningScreen() {
  const { month, setMonth } = useData();
  const { loaded, error, loading, refreshing, reload } = useResource('planning.' + month, () => read.planning(month));
  return <Screen refreshing={refreshing} onRefresh={reload}>
    <MonthBar month={month} onChange={setMonth} />
    {loading ? <Loading /> : null}
    {error ? <ErrorState error={error} onRetry={reload} /> : null}
    {loaded ? <>
      <SourceBanner loaded={loaded} />
      {loaded.data.closed ? <Badge label="Mês fechado: reabra pela web para alterar" tone="danger" /> : null}
      <BudgetBox view={loaded.data} month={month} />
      <Occurrences view={loaded.data} month={month} />
    </> : null}
  </Screen>;
}

export function BudgetScreen({ route, navigation }: StackProps<'Budget'>) {
  const { month, plan } = route.params;
  const { busy, notice, send } = useSaver();
  const [form, setForm] = useState(() => budgetForm(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { navigation.setOptions({ title: `Orçamento ${month}` }); }, [navigation, month]);
  async function submit() {
    const built = budgetMutation(month, plan, form);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    if ((await send(built.mutation)).status === 'synced') navigation.goBack();
  }
  return <Screen>
    <Field label="Limite de gastos (R$)" value={form.limit} onChangeText={limit => setForm({ ...form, limit })} keyboardType="decimal-pad" error={errors.limit} />
    <Field label="Renda prevista (R$)" value={form.expectedIncome} onChangeText={expectedIncome => setForm({ ...form, expectedIncome })} keyboardType="decimal-pad" error={errors.expectedIncome} />
    <Field label="Reserva (R$)" value={form.reserve} onChangeText={reserve => setForm({ ...form, reserve })} keyboardType="decimal-pad" error={errors.reserve} />
    {plan?.categories.length ? <Muted>Os limites por categoria definidos na web são mantidos.</Muted> : null}
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Salvando…' : 'Salvar orçamento'} disabled={busy} onPress={() => void submit()} />
  </Screen>;
}

function RecurrenceFields({ form, setForm, errors, accounts, categories }: { form: RuleForm; setForm: (form: RuleForm) => void; errors: Record<string, string>; accounts: (readonly [string, string])[]; categories: (readonly [string, string])[] }) {
  return <>
    <Field label="Descrição" value={form.description} onChangeText={description => setForm({ ...form, description })} error={errors.description} />
    <Field label="Valor (R$)" value={form.amount} onChangeText={amount => setForm({ ...form, amount })} keyboardType="decimal-pad" error={errors.amount} />
    <Choice label="Conta" options={accounts} value={form.accountId} onChange={accountId => setForm({ ...form, accountId })} error={errors.accountId} />
    <Choice label="Categoria" options={categories} value={form.categoryId} onChange={categoryId => setForm({ ...form, categoryId })} error={errors.categoryId} />
    <Field label="Dia do vencimento (1–31)" value={form.dueDay} onChangeText={dueDay => setForm({ ...form, dueDay })} keyboardType="number-pad" error={errors.dueDay} />
    <Field label="Início (AAAA-MM-DD)" value={form.startDate} onChangeText={startDate => setForm({ ...form, startDate })} error={errors.startDate ?? errors.form} />
    <Choice label="Valor" options={[['fixed', 'Exato'], ['estimated', 'Estimado']] as const} value={form.estimated ? 'estimated' : 'fixed'} onChange={value => setForm({ ...form, estimated: value === 'estimated' })} />
  </>;
}

export function RecurrenceFormScreen({ route, navigation }: StackProps<'RecurrenceForm'>) {
  const { month } = route.params;
  const { busy, notice, send } = useSaver();
  const refs = useResource('references', read.references);
  const [form, setForm] = useState<RuleForm>(() => ({ description: '', amount: '', accountId: '', categoryId: '', dueDay: '10', startDate: month + '-01', estimated: false }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (refs.error && !refs.loaded) return <Screen><ErrorState error={refs.error} onRetry={refs.reload} /></Screen>;
  if (!refs.loaded) return <Screen><Loading /></Screen>;
  const accounts = refs.loaded.data.accounts.filter(row => !row.archivedAt).map(row => [row.id, row.name] as const);
  const categories = refs.loaded.data.categories.filter(row => !row.archivedAt).map(row => [row.id, row.name] as const);
  async function submit() {
    const built = ruleMutation(month, form);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    if ((await send(built.mutation)).status === 'synced') navigation.goBack();
  }
  return <Screen>
    <Muted>Despesa mensal fixa. Depois de salvar, use “Gerar previstos do mês” para criar a ocorrência deste mês.</Muted>
    <RecurrenceFields form={form} setForm={setForm} errors={errors} accounts={accounts} categories={categories} />
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Salvando…' : 'Salvar recorrência'} disabled={busy} onPress={() => void submit()} />
  </Screen>;
}
