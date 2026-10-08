import React, { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import type { ManualEntry, ManualEntryRecord } from '@ecofinance/shared';
import {
  archiveEntryMutation, ENTRY_KINDS, ENTRY_STATUSES, entryFormFrom, entryFormFromData, newEntryForm, saveEntryMutation,
  validateEntry, withPurchaseDate, type EntryForm,
} from '../data/entries';
import { readLocal, removeLocal, writeLocal } from '../data/local-store';
import { discard, type Mutation, type OutboxItem } from '../data/outbox';
import { read, type References } from '../data/resources';
import { useStack, type StackProps } from '../navigation';
import { useData, useResource, useSaver } from '../ui/data-context';
import { Badge, Button, Choice, ErrorState, Field, Loading, Muted, Notice, Screen, SourceBanner } from '../ui/kit';

/** Typed but unsaved quick-entry fields survive closing the app (per user, cleared on logout). */
const FORM_DRAFT = 'draft.entry-form';
type Options = (readonly [string, string])[];

function options(references: References, form: EntryForm) {
  const accounts: Options = references.accounts.filter(row => !row.archivedAt || row.id === form.accountId || row.id === form.toAccountId).map(row => [row.id, row.name] as const);
  const categories: Options = references.categories.filter(row => !row.archivedAt || row.id === form.categoryId).map(row => [row.id, row.name] as const);
  return { accounts, categories };
}

function EntryFields({ form, update, errors, references }: { form: EntryForm; update: (form: EntryForm) => void; errors: Record<string, string>; references: References }) {
  const { accounts, categories } = options(references, form);
  const transfer = form.kind === 'transfer';
  return <>
    <Choice label="Tipo" options={ENTRY_KINDS} value={form.kind} onChange={kind => update({ ...form, kind, toAccountId: kind === 'transfer' ? form.toAccountId : '' })} />
    <Field label="Descrição" value={form.description} onChangeText={description => update({ ...form, description })} error={errors.description} />
    <Field label="Valor (R$)" value={form.amount} onChangeText={amount => update({ ...form, amount })} keyboardType="decimal-pad" placeholder="0,00" error={errors.amount} />
    <Choice label={transfer ? 'Conta de origem' : 'Conta'} options={accounts} value={form.accountId} onChange={accountId => update({ ...form, accountId })} error={errors.accountId} />
    {transfer ? <Choice label="Conta de destino" options={accounts} value={form.toAccountId} onChange={toAccountId => update({ ...form, toAccountId })} error={errors.toAccountId} /> : null}
    <Choice label="Categoria" options={categories} value={form.categoryId} onChange={categoryId => update({ ...form, categoryId })} error={errors.categoryId} />
    <Choice label="Situação" options={ENTRY_STATUSES} value={form.status} onChange={status => update({ ...form, status })} />
    <Field label="Data da compra (AAAA-MM-DD)" value={form.purchaseDate} onChangeText={value => update(withPurchaseDate(form, value))} error={errors.purchaseDate} />
    <Field label="Mês de competência (AAAA-MM)" value={form.month} onChangeText={month => update({ ...form, month })} error={errors.competenceMonth} />
    {form.status === 'settled' ? <Field label="Data do pagamento (AAAA-MM-DD)" value={form.paidDate} onChangeText={paidDate => update({ ...form, paidDate })} error={errors.paidDate} /> : null}
    <Field label="Observações" value={form.notes} onChangeText={notes => update({ ...form, notes })} multiline error={errors.notes} />
  </>;
}

interface EditorProps { initial: EntryForm; references: References; entry?: ManualEntryRecord; draftId?: string }
function EntryEditor({ initial, references, entry, draftId }: EditorProps) {
  const navigation = useStack();
  const { userId, month, today } = useData();
  const { busy, notice, setNotice, send } = useSaver();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isNew = !entry && !draftId;
  const archived = !!entry?.archivedAt;
  const update = (next: EntryForm) => {
    setForm(next);
    if (isNew) void writeLocal(userId, FORM_DRAFT, next).catch(() => undefined);
  };
  async function run(mutation: Mutation, replaceId?: string) {
    const outcome = await send(mutation, replaceId);
    if (outcome.status !== 'synced' && outcome.status !== 'pending') return;
    if (outcome.status === 'pending') Alert.alert('Pendente neste aparelho', 'Sem conexão com o servidor. A alteração foi guardada e será enviada ao reconectar.');
    if (isNew) await removeLocal(userId, FORM_DRAFT).catch(() => undefined);
    navigation.goBack();
  }
  function submit() {
    const result = validateEntry(form);
    if (!result.ok) { setErrors(result.errors); setNotice({ message: 'Revise os campos destacados.', tone: 'danger' }); return; }
    setErrors({});
    void run(saveEntryMutation(result.data, entry ?? null), draftId);
  }
  function reset() {
    void removeLocal(userId, FORM_DRAFT).catch(() => undefined);
    setForm(newEntryForm(today, month, references.accounts, references.categories));
    setErrors({});
  }
  return <>
    {archived ? <Muted>Este lançamento está excluído. Restaure para editar.</Muted> : null}
    <EntryFields form={form} update={update} errors={errors} references={references} />
    <Notice message={notice.message} tone={notice.tone} />
    <View style={{ gap: 8 }}>
      {!archived ? <Button label={busy ? 'Salvando…' : 'Salvar'} disabled={busy} onPress={submit} /> : null}
      {entry ? <Button label={archived ? 'Restaurar lançamento' : 'Excluir lançamento'} variant={archived ? 'primary' : 'danger'} disabled={busy} onPress={() => void run(archiveEntryMutation(entry, archived))} /> : null}
      {draftId ? <Button label="Descartar rascunho" variant="danger" disabled={busy} onPress={() => void discard(userId, draftId).then(() => navigation.goBack())} /> : null}
      {isNew ? <Button label="Limpar formulário" variant="secondary" disabled={busy} onPress={reset} /> : null}
    </View>
  </>;
}

function draftBadge(draft: OutboxItem | undefined) {
  if (!draft) return null;
  return draft.state === 'pending' ? <Badge label="Pendente de envio" /> : <Badge label={draft.error ?? 'Precisa de revisão'} tone="danger" />;
}
/** Server record, queued draft, or new form (restoring unsent typed fields). */
function useInitialForm(references: References | undefined, entry?: ManualEntryRecord, draft?: OutboxItem) {
  const { userId, month, today } = useData();
  const [loaded, setLoaded] = useState<EntryForm | null>(null);
  const fixed = entry ? entryFormFrom(entry) : draft ? entryFormFromData(draft.body as ManualEntry) : null;
  const needsLocal = !fixed && !!references;
  useEffect(() => {
    if (!needsLocal || !references) return;
    let active = true;
    void readLocal<EntryForm>(userId, FORM_DRAFT).catch(() => null).then(saved => {
      if (active) setLoaded(saved ?? newEntryForm(today, month, references.accounts, references.categories));
    });
    return () => { active = false; };
  }, [needsLocal, references, userId, today, month]);
  return fixed ?? loaded;
}

export function EntryFormScreen({ route, navigation }: StackProps<'EntryForm'>) {
  const { entry, draftId } = route.params;
  const { outbox } = useData();
  const refs = useResource('references', read.references);
  const draft = draftId ? outbox.find(item => item.id === draftId) : undefined;
  const references = refs.loaded?.data;
  const initial = useInitialForm(references, entry, draft);
  useEffect(() => { navigation.setOptions({ title: entry ? 'Editar lançamento' : draftId ? 'Rascunho pendente' : 'Novo lançamento' }); }, [navigation, entry, draftId]);

  if (draftId && !draft) return <Screen><Muted>Este rascunho já foi enviado ou descartado. Confira a lista de lançamentos.</Muted><Button label="Voltar" onPress={() => navigation.goBack()} /></Screen>;
  if (refs.error && !references) return <Screen><ErrorState error={refs.error} onRetry={refs.reload} /></Screen>;
  if (!initial || !references || !refs.loaded) return <Screen><Loading /></Screen>;
  return <Screen>
    <SourceBanner loaded={refs.loaded} />
    {draftBadge(draft)}
    <EntryEditor initial={initial} references={references} entry={entry} draftId={draftId} />
  </Screen>;
}
