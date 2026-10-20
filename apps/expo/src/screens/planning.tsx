import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { PlanningOccurrence, PlanningRule, PlanningView } from '@ecofinance/shared';
import { decimalToCents, money, moneyInput } from '../data/format';
import { generateMutation, monthStateMutation, occurrenceMutation, type OccurrenceAction } from '../data/planning';
import { read } from '../data/resources';
import { useStack } from '../navigation';
import { useData, useResource, useSaver } from '../ui/data-context';
import { Badge, Box, Button, ErrorState, Field, Loading, MoneyLine, MonthBar, Muted, Notice, Screen, SourceBanner, Title } from '../ui/kit';
import { styles } from '../ui/theme';

const STATUS: Record<PlanningOccurrence['status'], string> = { pending: 'pendente', paid: 'pago', postponed: 'adiado', cancelled: 'cancelado' };
const isOpen = (occurrence: PlanningOccurrence) => occurrence.status === 'pending' || occurrence.status === 'postponed';
type Names = ReadonlyMap<string, string>;

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

/** Each limit is independent of the monthly ceiling; a negative remainder is spelled out, not only coloured. */
function CategoryLimits({ view, names }: { view: PlanningView; names: Names }) {
  if (!view.plan?.categories.length) return null;
  return <>
    <Text style={styles.label}>Limites por categoria</Text>
    {view.categoryTotals.map(row => {
      const limit = view.plan?.categories.find(item => item.categoryId === row.categoryId)?.limit ?? null;
      const over = decimalToCents(row.remaining) < 0n;
      return <View key={row.categoryId} accessible accessibilityLabel={`${names.get(row.categoryId) ?? 'Categoria'}: comprometido ${money(row.committed)} de ${money(limit)}, ${over ? 'excedido em ' + money(row.remaining.slice(1)) : 'restam ' + money(row.remaining)}`}>
        <View style={styles.line}>
          <Text style={styles.lineLabel}>{names.get(row.categoryId) ?? 'Categoria indisponível'}</Text>
          <Text style={styles.lineValue}>{money(row.committed)} de {money(limit)}</Text>
        </View>
        <Muted>{over ? `Excedido em ${money(row.remaining.slice(1))}` : `Restam ${money(row.remaining)}`} · realizado {money(row.realized)} · previsto {money(row.pending)}</Muted>
      </View>;
    })}
  </>;
}

function BudgetBox({ view, month, names }: { view: PlanningView; month: string; names: Names }) {
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
    <CategoryLimits view={view} names={names} />
    {!view.closed ? <>
      <Button label={plan ? 'Editar orçamento' : 'Definir orçamento'} variant="secondary" onPress={() => navigation.navigate('Budget', { month, plan })} />
      <Button label="Copiar de outro mês" variant="secondary" onPress={() => navigation.navigate('Budget', { month, plan, copy: true })} />
    </> : null}
  </Box>;
}

function MonthState({ view }: { view: PlanningView }) {
  const { outbox } = useData();
  const { busy, notice, send } = useSaver();
  const [confirming, setConfirming] = useState(false);
  const pending = outbox.some(item => item.resource?.type === 'month' && item.resource.month === view.month);
  async function confirm() {
    const outcome = await send(monthStateMutation(view));
    if (outcome.status !== 'rejected') setConfirming(false);
  }
  return <Box tone={view.closed ? 'danger' : undefined}>
    {view.closed ? <Badge label="Mês fechado" tone="danger" /> : null}
    {pending ? <Badge label="Fechamento ou reabertura pendente de envio" /> : null}
    {confirming ? <>
      <Muted>{view.closed
        ? 'Reabrir permite alterar o orçamento, as ocorrências e os lançamentos deste mês.'
        : 'Fechar preserva este mês. Contas pendentes permanecem previstas; pague, concilie ou cancele antes de fechar se quiser resolver todas. Ajustes e pagamentos ficam bloqueados até reabrir.'}</Muted>
      <Button label={busy ? 'Enviando…' : view.closed ? 'Confirmar reabertura' : 'Confirmar fechamento'} variant={view.closed ? 'primary' : 'danger'} disabled={busy} onPress={() => void confirm()} />
      <Button label="Voltar" variant="secondary" onPress={() => setConfirming(false)} />
    </> : <Button label={view.closed ? 'Reabrir mês' : 'Fechar mês'} variant="secondary" onPress={() => setConfirming(true)} />}
    <Notice message={notice.message} tone={notice.tone} />
  </Box>;
}

function RuleRow({ rule, month, closed, pending }: { rule: PlanningRule; month: string; closed: boolean; pending: boolean }) {
  const navigation = useStack();
  return <Box>
    <View style={styles.line}>
      <Text style={styles.itemTitle}>{rule.description}</Text>
      <Text style={styles.itemRight}>{money(rule.amount)}</Text>
    </View>
    <Muted>Dia {rule.dueDay}{rule.estimated ? ' · valor estimado' : ''}{rule.endDate ? ` · até ${rule.endDate}` : ''}{rule.paused ? ' · pausada' : ''}</Muted>
    {pending ? <Badge label="Alteração pendente de envio" /> : null}
    {!closed ? <Button label="Editar ou pausar próximas" variant="secondary" hint={`Altera ${rule.description} a partir do mês escolhido`} onPress={() => navigation.navigate('RecurrenceForm', { month, rule })} /> : null}
  </Box>;
}

function Occurrences({ view, month }: { view: PlanningView; month: string }) {
  const navigation = useStack();
  const { outbox } = useData();
  const { notice, send } = useSaver();
  const pending = new Set(outbox.flatMap(item => item.resource?.type === 'occurrence' ? [item.resource.id] : []));
  return <>
    <Title>Previstos do mês</Title>
    {!view.closed ? <View style={{ gap: 8 }}>
      <Button label="Gerar previstos do mês" variant="secondary" onPress={() => void send(generateMutation(month))} />
      <Button label="Nova recorrência" variant="secondary" onPress={() => navigation.navigate('RecurrenceForm', { month })} />
    </View> : null}
    <Notice message={notice.message} tone={notice.tone} />
    {view.occurrences.length === 0 ? <Muted>Nenhum previsto neste mês. Gere os previstos a partir das recorrências.</Muted> : null}
    {view.occurrences.map(occurrence => <OccurrenceRow key={occurrence.id} occurrence={occurrence} month={month} closed={view.closed} pending={pending.has(occurrence.id)} />)}
  </>;
}

function Rules({ view, month }: { view: PlanningView; month: string }) {
  const { outbox } = useData();
  if (!view.rules.length) return null;
  const pending = new Set(outbox.flatMap(item => item.resource?.type === 'recurrence' ? [item.resource.id] : []));
  return <>
    <Title>Recorrências mensais</Title>
    <Muted>Edite ou pause a partir do mês que escolher. Depois, gere os previstos no mês desejado; repetir a geração não duplica contas.</Muted>
    {view.rules.map(rule => <RuleRow key={rule.id} rule={rule} month={month} closed={view.closed} pending={pending.has(rule.id)} />)}
  </>;
}

export function PlanningScreen() {
  const { month, setMonth } = useData();
  const { loaded, error, loading, refreshing, reload } = useResource('planning.' + month, () => read.planning(month));
  const refs = useResource('references', read.references);
  const names: Names = new Map(refs.loaded?.data.categories.map(row => [row.id, row.name]) ?? []);
  return <Screen refreshing={refreshing} onRefresh={reload}>
    <MonthBar month={month} onChange={setMonth} />
    {loading ? <Loading /> : null}
    {error ? <ErrorState error={error} onRetry={reload} /> : null}
    {loaded ? <>
      <SourceBanner loaded={loaded} />
      <MonthState view={loaded.data} />
      <BudgetBox view={loaded.data} month={month} names={names} />
      <Occurrences view={loaded.data} month={month} />
      <Rules view={loaded.data} month={month} />
    </> : null}
  </Screen>;
}
