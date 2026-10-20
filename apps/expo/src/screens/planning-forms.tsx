import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { shiftMonth } from '@ecofinance/shared';
import { toApiError } from '../data/api';
import { budgetForm, budgetMutation, categoryField, ruleForm, ruleMutation, type BudgetForm, type RuleForm } from '../data/planning';
import { read, type CopyPreview, type References } from '../data/resources';
import type { StackProps } from '../navigation';
import { useResource, useSaver } from '../ui/data-context';
import { Box, Button, Choice, ErrorState, Field, Loading, Muted, Notice, Screen } from '../ui/kit';
import { styles } from '../ui/theme';

/** Active categories, plus archived ones that already carry a limit in this form. */
function CategoryLimitFields({ form, setForm, errors, categories }: { form: BudgetForm; setForm: (form: BudgetForm) => void; errors: Record<string, string>; categories: References['categories'] }) {
  const shown = categories.filter(row => !row.archivedAt || row.id in form.categories);
  const unknown = Object.keys(form.categories).filter(id => !categories.some(row => row.id === id));
  const change = (id: string, text: string) => setForm({ ...form, categories: { ...form.categories, [id]: text } });
  return <>
    <Text style={styles.label}>Limites por categoria</Text>
    <Muted>Deixe vazio para remover o limite; zero é um limite de zero reais. Os limites são independentes do limite de gastos do mês.</Muted>
    {shown.map(row => <Field key={row.id} label={`${row.name}${row.archivedAt ? ' (arquivada)' : ''} (R$)`} value={form.categories[row.id] ?? ''} placeholder="Sem limite"
      onChangeText={text => change(row.id, text)} keyboardType="decimal-pad" error={errors[categoryField(row.id)]} />)}
    {unknown.map(id => <Field key={id} label="Categoria indisponível (R$)" value={form.categories[id] ?? ''} placeholder="Sem limite"
      onChangeText={text => change(id, text)} keyboardType="decimal-pad" error={errors[categoryField(id)]} />)}
    {shown.length + unknown.length === 0 ? <Muted>Nenhuma categoria ativa. Cadastre uma em Mais › Contas e categorias.</Muted> : null}
  </>;
}

/** The copy is only a starting point: every value is reviewed here before it replaces this month's plan. */
function CopySourcePicker({ month, onLoaded }: { month: string; onLoaded: (preview: CopyPreview) => void }) {
  const [source, setSource] = useState(() => shiftMonth(month, -1) ?? month);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  async function load() {
    setLoading(true); setMessage('');
    try { onLoaded(await read.copyPreview(source.trim())); }
    catch (raw) {
      const error = toApiError(raw);
      setMessage(error.kind === 'not-found' ? 'Esse mês não tem orçamento salvo para copiar.' : error.message);
    } finally { setLoading(false); }
  }
  return <Box>
    <Field label="Mês de origem (AAAA-MM)" value={source} onChangeText={setSource} />
    <Button label={loading ? 'Carregando…' : 'Carregar para revisão'} disabled={loading || source.trim() === month} onPress={() => void load()} />
    <Muted>Carregar exige conexão. As recorrências continuam com suas próprias regras; a cópia não cria outras recorrências.</Muted>
    <Notice message={message} tone="danger" />
  </Box>;
}

export function BudgetScreen({ route, navigation }: StackProps<'Budget'>) {
  const { month, plan, copy = false } = route.params;
  const refs = useResource('references', read.references);
  const { busy, notice, send } = useSaver();
  const [form, setForm] = useState(() => budgetForm(copy ? null : plan));
  const [preview, setPreview] = useState<CopyPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { navigation.setOptions({ title: `${copy ? 'Copiar orçamento' : 'Orçamento'} ${month}` }); }, [navigation, month, copy]);
  if (refs.error && !refs.loaded) return <Screen><ErrorState error={refs.error} onRetry={refs.reload} /></Screen>;
  if (!refs.loaded) return <Screen><Loading /></Screen>;
  function loaded(next: CopyPreview) {
    setPreview(next); setForm(budgetForm(next.plan)); setErrors({});
  }
  async function submit() {
    const built = budgetMutation(month, plan, form, preview ? { sourceMonth: preview.sourceMonth, sourceRevision: preview.sourceRevision } : undefined);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    if ((await send(built.mutation)).status === 'synced') navigation.goBack();
  }
  const ready = !copy || preview;
  return <Screen>
    {copy ? <CopySourcePicker month={month} onLoaded={loaded} /> : null}
    {copy && plan ? <Muted>O orçamento atual de {month} será substituído pelos valores revisados abaixo.</Muted> : null}
    {preview ? <Muted>Valores de {preview.sourceMonth}. Revise antes de confirmar.</Muted> : null}
    {ready ? <>
      <Field label="Limite de gastos (R$)" value={form.limit} onChangeText={limit => setForm({ ...form, limit })} keyboardType="decimal-pad" error={errors.limit} />
      <Field label="Renda prevista (R$)" value={form.expectedIncome} onChangeText={expectedIncome => setForm({ ...form, expectedIncome })} keyboardType="decimal-pad" error={errors.expectedIncome} />
      <Field label="Reserva (R$)" value={form.reserve} onChangeText={reserve => setForm({ ...form, reserve })} keyboardType="decimal-pad" error={errors.reserve} />
      <CategoryLimitFields form={form} setForm={setForm} errors={errors} categories={refs.loaded.data.categories} />
      <Notice message={errors.categories ?? errors.form ?? ''} tone="danger" />
      <Notice message={notice.message} tone={notice.tone} />
      <Button label={busy ? 'Salvando…' : copy ? 'Confirmar plano revisado' : 'Salvar orçamento'} disabled={busy} onPress={() => void submit()} />
    </> : null}
  </Screen>;
}

type Options = (readonly [string, string])[];
function RecurrenceFields({ form, setForm, errors, accounts, categories, editing }: { form: RuleForm; setForm: (form: RuleForm) => void; errors: Record<string, string>; accounts: Options; categories: Options; editing: boolean }) {
  return <>
    {editing ? <Field label="Alterar a partir de (AAAA-MM)" value={form.fromMonth} onChangeText={fromMonth => setForm({ ...form, fromMonth })} error={errors.fromMonth} /> : null}
    <Field label="Descrição" value={form.description} onChangeText={description => setForm({ ...form, description })} error={errors.description} />
    <Field label="Valor (R$)" value={form.amount} onChangeText={amount => setForm({ ...form, amount })} keyboardType="decimal-pad" error={errors.amount} />
    <Choice label="Valor" options={[['fixed', 'Exato'], ['estimated', 'Estimado']] as const} value={form.estimated ? 'estimated' : 'fixed'} onChange={value => setForm({ ...form, estimated: value === 'estimated' })} />
    <Choice label="Conta" options={accounts} value={form.accountId} onChange={accountId => setForm({ ...form, accountId })} error={errors.accountId} />
    <Choice label="Categoria" options={categories} value={form.categoryId} onChange={categoryId => setForm({ ...form, categoryId })} error={errors.categoryId} />
    <Field label="Dia do vencimento (1–31)" value={form.dueDay} onChangeText={dueDay => setForm({ ...form, dueDay })} keyboardType="number-pad" error={errors.dueDay} />
    <Field label="Início (AAAA-MM-DD)" value={form.startDate} onChangeText={startDate => setForm({ ...form, startDate })} error={errors.startDate ?? errors.form} />
    <Field label="Fim opcional (AAAA-MM-DD)" value={form.endDate} onChangeText={endDate => setForm({ ...form, endDate })} placeholder="Sem data de fim" error={errors.endDate ?? errors.schedule} />
    <Field label="Lembrar quantos dias antes (0–30)" value={form.reminderDays} onChangeText={reminderDays => setForm({ ...form, reminderDays })} keyboardType="number-pad" placeholder="Sem lembrete" error={errors.reminderDays} />
    <Choice label="Situação" options={[['active', 'Ativa'], ['paused', editing ? 'Pausar a partir do mês escolhido' : 'Pausada']] as const} value={form.paused ? 'paused' : 'active'} onChange={value => setForm({ ...form, paused: value === 'paused' })} />
  </>;
}

/** Archived references stay selectable only when the rule already uses them. */
function options(rows: References['accounts'] | References['categories'], current?: string): Options {
  return rows.filter(row => !row.archivedAt || row.id === current).map(row => [row.id, row.archivedAt ? `${row.name} (arquivada)` : row.name] as const);
}

export function RecurrenceFormScreen({ route, navigation }: StackProps<'RecurrenceForm'>) {
  const { month, rule } = route.params;
  const { busy, notice, send } = useSaver();
  const refs = useResource('references', read.references);
  const [form, setForm] = useState<RuleForm>(() => ruleForm(month, rule));
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { navigation.setOptions({ title: rule ? 'Editar recorrência' : 'Nova recorrência' }); }, [navigation, rule]);
  if (refs.error && !refs.loaded) return <Screen><ErrorState error={refs.error} onRetry={refs.reload} /></Screen>;
  if (!refs.loaded) return <Screen><Loading /></Screen>;
  const accounts = options(refs.loaded.data.accounts, rule?.accountId);
  const categories = options(refs.loaded.data.categories, rule?.categoryId);
  async function submit() {
    const built = ruleMutation(month, form, rule);
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({});
    if ((await send(built.mutation)).status === 'synced') navigation.goBack();
  }
  return <Screen>
    <Muted>{rule
      ? 'A alteração vale para os meses a partir do escolhido; os anteriores mantêm a versão antiga. Pagamentos e ajustes feitos em uma ocorrência são preservados.'
      : 'Despesa mensal. Depois de salvar, use “Gerar previstos do mês” para criar a ocorrência deste mês.'}</Muted>
    <Muted>Vencimentos fora do início/fim não geram previsão. Dia 31 usa o último dia de meses menores.</Muted>
    <RecurrenceFields form={form} setForm={setForm} errors={errors} accounts={accounts} categories={categories} editing={!!rule} />
    <Notice message={notice.message} tone={notice.tone} />
    <Button label={busy ? 'Salvando…' : 'Salvar recorrência'} disabled={busy} onPress={() => void submit()} />
  </Screen>;
}
