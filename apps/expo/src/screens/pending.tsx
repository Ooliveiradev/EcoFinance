import React, { useState } from 'react';
import { Alert, View } from 'react-native';
import { toApiError } from '../data/api';
import { savedAtLabel } from '../data/format';
import { discard, editable, reapply, type OutboxItem, type ResourceRef } from '../data/outbox';
import { currentVersion, type CurrentVersion } from '../data/resources';
import { useStack } from '../navigation';
import { useData } from '../ui/data-context';
import { Badge, Box, Button, Muted, Notice, Screen, Title } from '../ui/kit';

function ConflictResolver({ item, resource }: { item: OutboxItem; resource: ResourceRef }) {
  const { userId, sync } = useData();
  const [server, setServer] = useState<CurrentVersion | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  async function compare() {
    try { setServer(await currentVersion(resource)); setMessage(''); }
    catch (raw) {
      try { setMessage(toApiError(raw).message); } catch { setMessage('Não foi possível ler a versão atual.'); }
    }
  }
  return <>
    <Muted>Alguém alterou este registro depois que você o abriu. Compare antes de decidir.</Muted>
    {server === undefined ? <Button label="Ver versão atual do servidor" variant="secondary" onPress={() => void compare()} /> : null}
    {server === null ? <Muted>O registro não existe mais no servidor. Descarte sua alteração.</Muted> : null}
    {server ? <Muted>Servidor agora: {server.summary}</Muted> : null}
    {server ? <Button label="Aplicar minha alteração sobre esta versão" onPress={() => void reapply(userId, item.id, server.revision).then(sync)} /> : null}
    <Notice message={message} tone="danger" />
  </>;
}

function stateBadge(item: OutboxItem) {
  if (item.state === 'conflict') return <Badge label="Conflito com outro dispositivo" tone="danger" />;
  if (item.state === 'rejected') return <Badge label="Recusada pelo servidor" tone="danger" />;
  return <Badge label={item.attempts ? 'Enviada, aguardando confirmação' : 'Aguardando conexão'} />;
}

function PendingItem({ item }: { item: OutboxItem }) {
  const { userId } = useData();
  const navigation = useStack();
  function forget() {
    const warning = editable(item)
      ? 'A alteração será apagada deste aparelho e não será enviada.'
      : 'Ela pode já ter chegado ao servidor. Descartar apenas a remove deste aparelho; confira os dados após sincronizar.';
    Alert.alert('Descartar alteração?', warning, [
      { text: 'Manter', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => void discard(userId, item.id) },
    ]);
  }
  const correctable = item.kind.startsWith('entry:') && item.state !== 'pending' && item.resource === null;
  return <Box tone={item.state === 'pending' ? 'warning' : 'danger'}>
    <Title>{item.label}</Title>
    {stateBadge(item)}
    <Muted>Criada em {savedAtLabel(item.createdAt)}{item.error ? ` · ${item.error}` : ''}</Muted>
    {item.state === 'conflict' && item.resource ? <ConflictResolver item={item} resource={item.resource} /> : null}
    {correctable ? <Button label="Corrigir no formulário" variant="secondary" onPress={() => navigation.navigate('EntryForm', { draftId: item.id })} /> : null}
    <Button label="Descartar minha alteração" variant="danger" onPress={forget} />
  </Box>;
}

export function PendingScreen() {
  const { outbox, sync, syncing } = useData();
  const [notice, setNotice] = useState('');
  async function syncNow() {
    await sync();
    setNotice('Sincronização concluída. Itens que continuam aqui precisam de conexão ou de uma decisão sua.');
  }
  return <Screen>
    <Muted>Alterações feitas sem conexão ficam neste aparelho, separadas do que o servidor já confirmou. Ao reconectar, são reenviadas na ordem, com a mesma chave de idempotência: um reenvio nunca duplica um lançamento.</Muted>
    <Button label={syncing ? 'Sincronizando…' : 'Sincronizar agora'} disabled={syncing} onPress={() => void syncNow()} />
    <Notice message={notice} />
    {outbox.length === 0 ? <Muted>Nenhuma alteração pendente. Tudo foi confirmado pelo servidor.</Muted> : null}
    <View style={{ gap: 12 }}>{outbox.map(item => <PendingItem key={item.id} item={item} />)}</View>
  </Screen>;
}
