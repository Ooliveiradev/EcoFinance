import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { money } from '../data/format';
import { ACCOUNT_TYPES, accountForm, accountMutation, archiveReferenceMutation, categoryForm, categoryMutation, PALETTE } from '../data/references';
import { read } from '../data/resources';
import { useStack, type StackProps } from '../navigation';
import { outcomeMessage } from '../data/outcome';
import { useData, useResource } from '../ui/data-context';
import { Badge, Box, Button, Choice, ErrorState, Field, ListItem, Loading, Muted, Notice, Screen, SourceBanner, Title } from '../ui/kit';

export function ReferencesScreen() {
  const navigation = useStack();
  const { outbox } = useData();
  const { loaded, error, loading, refreshing, reload } = useResource('references', read.references);
  const pending = new Set(outbox.flatMap(item => item.resource && 'id' in item.resource ? [item.resource.id] : []));
  const newDrafts = outbox.filter(item => item.kind === 'account:save' || item.kind === 'category:save').filter(item => !item.resource);
  return <Screen refreshing={refreshing} onRefresh={reload}>
    {loading ? <Loading /> : null}
    {error ? <ErrorState error={error} onRetry={reload} /> : null}
    {newDrafts.map(item => <ListItem key={item.id} title={item.label} subtitle={item.error ?? 'Pendente de envio'} badge={<Badge label="Pendente" />} />)}
    {loaded ? <>
      <SourceBanner loaded={loaded} />
      <Title>Contas</Title>
      <Button label="Nova conta" onPress={() => navigation.navigate('ReferenceForm', { type: 'account' })} />
      {loaded.data.accounts.length === 0 ? <Muted>Nenhuma conta cadastrada.</Muted> : null}
      {loaded.data.accounts.map(account => <ListItem key={account.id} title={account.name}
        subtitle={`${account.type === 'banco' ? 'Banco' : 'Carteira'}${account.archivedAt ? ' · arquivada' : ''}`}
        right={money(account.balance, 'sem saldo')} badge={pending.has(account.id) ? <Badge label="Alteração pendente" /> : null}
        onPress={() => navigation.navigate('ReferenceForm', { type: 'account', record: account })} />)}
      <Title>Categorias</Title>
      <Button label="Nova categoria" onPress={() => navigation.navigate('ReferenceForm', { type: 'category' })} />
      {loaded.data.categories.map(category => <ListItem key={category.id} title={category.name}
        subtitle={category.archivedAt ? 'arquivada' : undefined} badge={pending.has(category.id) ? <Badge label="Alteração pendente" /> : null}
        onPress={() => navigation.navigate('ReferenceForm', { type: 'category', record: category })} />)}
    </> : null}
  </Screen>;
}

export function ReferenceFormScreen({ route, navigation }: StackProps<'ReferenceForm'>) {
  const params = route.params;
  const { today, save } = useData();
  const [account, setAccount] = useState(() => accountForm(params.type === 'account' ? params.record : undefined, today));
  const [category, setCategory] = useState(() => categoryForm(params.type === 'category' ? params.record : undefined));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ message: string; tone: 'ok' | 'warning' | 'danger' }>({ message: '', tone: 'ok' });
  const [busy, setBusy] = useState(false);
  const record = params.record;
  useEffect(() => {
    navigation.setOptions({ title: `${record ? 'Editar' : 'Nova'} ${params.type === 'account' ? 'conta' : 'categoria'}` });
  }, [navigation, record, params.type]);

  async function send(build: () => ReturnType<typeof accountMutation>) {
    const built = build();
    if (!built.ok) { setErrors(built.errors); return; }
    setErrors({}); setBusy(true);
    try {
      const outcome = await save(built.mutation);
      setNotice(outcomeMessage(outcome));
      if (outcome.status === 'synced') navigation.goBack();
    } finally { setBusy(false); }
  }
  const submit = () => void send(() => params.type === 'account' ? accountMutation(account, params.record) : categoryMutation(category, params.record));
  return <Screen>
    {params.type === 'account' ? <>
      <Field label="Nome" value={account.name} onChangeText={name => setAccount({ ...account, name })} error={errors.name} />
      <Choice label="Tipo" options={ACCOUNT_TYPES} value={account.type} onChange={type => setAccount({ ...account, type })} />
      <Field label="Saldo inicial (R$)" value={account.openingBalance} keyboardType="numbers-and-punctuation" onChangeText={openingBalance => setAccount({ ...account, openingBalance })} error={errors.openingBalance} />
      <Field label="Data do saldo inicial (AAAA-MM-DD)" value={account.openingDate} onChangeText={openingDate => setAccount({ ...account, openingDate })} error={errors.openingDate} />
      <Choice label="Cor" options={PALETTE} value={account.color} onChange={color => setAccount({ ...account, color })} />
    </> : <>
      <Field label="Nome" value={category.name} onChangeText={name => setCategory({ ...category, name })} error={errors.name} />
      <Choice label="Cor" options={PALETTE} value={category.color} onChange={color => setCategory({ ...category, color })} error={errors.color} />
    </>}
    <Notice message={notice.message} tone={notice.tone} />
    <View style={{ gap: 8 }}>
      <Button label={busy ? 'Salvando…' : 'Salvar'} disabled={busy} onPress={submit} />
      {record ? <Button label={record.archivedAt ? 'Restaurar' : 'Arquivar'} variant={record.archivedAt ? 'secondary' : 'danger'} disabled={busy}
        onPress={() => void send(() => ({ ok: true, mutation: archiveReferenceMutation(params.type, record) }))} /> : null}
    </View>
    {record && !record.archivedAt ? <Box><Muted>Arquivar mantém o histórico e os totais; o item só deixa de aparecer em novos lançamentos.</Muted></Box> : null}
  </Screen>;
}
