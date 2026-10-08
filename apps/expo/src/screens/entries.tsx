import React, { useState } from 'react';
import { View } from 'react-native';
import { money } from '../data/format';
import type { OutboxItem } from '../data/outbox';
import { read } from '../data/resources';
import { useStack } from '../navigation';
import { useData, useResource } from '../ui/data-context';
import { Badge, Box, Button, ErrorState, ListItem, Loading, MonthBar, Muted, Screen, SourceBanner, Title } from '../ui/kit';

const STATUS: Record<string, string> = { planned: 'previsto', recorded: 'registrado', settled: 'pago', cancelled: 'cancelado' };
function stateBadge(item: OutboxItem | undefined) {
  if (!item) return null;
  if (item.state === 'conflict') return <Badge label="Conflito: resolva em Pendências" tone="danger" />;
  if (item.state === 'rejected') return <Badge label="Recusado: revise em Pendências" tone="danger" />;
  return <Badge label="Alteração pendente de envio" />;
}

export function EntriesScreen() {
  const { month, setMonth, outbox } = useData();
  const navigation = useStack();
  const [page, setPage] = useState({ month, number: 1 });
  const current = page.month === month ? page.number : 1;
  const { loaded, error, loading, refreshing, reload } = useResource(`entries.${month}.${current}`, () => read.entries(month, current));
  const drafts = outbox.filter(item => item.kind === 'entry:create');
  const byEntry = new Map(outbox.flatMap(item => item.resource?.type === 'entry' ? [[item.resource.id, item] as const] : []));
  return <Screen refreshing={refreshing} onRefresh={reload}>
    <MonthBar month={month} onChange={setMonth} />
    <Button label="Novo lançamento" onPress={() => navigation.navigate('EntryForm', {})} />
    {drafts.length ? <Box tone="warning">
      <Title>Ainda não sincronizados</Title>
      {drafts.map(item => <ListItem key={item.id} title={item.label} subtitle={item.error ?? 'Salvo só neste aparelho'} badge={stateBadge(item)}
        onPress={() => navigation.navigate('EntryForm', { draftId: item.id })} />)}
    </Box> : null}
    {loading ? <Loading /> : null}
    {error ? <ErrorState error={error} onRetry={reload} /> : null}
    {loaded ? <>
      <SourceBanner loaded={loaded} />
      {loaded.data.entries.length === 0 ? <Muted>Nenhum lançamento confirmado neste mês.</Muted> : null}
      <View style={{ gap: 8 }}>
        {loaded.data.entries.map(entry => <ListItem key={entry.id} title={entry.description}
          subtitle={`${entry.purchaseDate} · ${entry.accountName} · ${entry.categoryName} · ${STATUS[entry.status] ?? entry.status}`}
          right={money(entry.amount)} badge={stateBadge(byEntry.get(entry.id))}
          onPress={() => navigation.navigate('EntryForm', { entry })} />)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {current > 1 ? <Button label="Página anterior" variant="secondary" onPress={() => setPage({ month, number: current - 1 })} /> : null}
        {loaded.data.hasMore ? <Button label="Próxima página" variant="secondary" onPress={() => setPage({ month, number: current + 1 })} /> : null}
      </View>
    </> : null}
  </Screen>;
}
