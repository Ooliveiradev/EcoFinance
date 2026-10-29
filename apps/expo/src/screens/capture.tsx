import React, { useCallback, useEffect, useState } from 'react';
import type { CaptureSource } from '@ecofinance/shared';
import { captureNative } from '../../modules/ecofinance-capture';
import { captureSyncState, loadCaptureSources, saveCaptureSources, syncCaptures } from '../data/capture';
import { read } from '../data/resources';
import { useStack } from '../navigation';
import { useData, useResource } from '../ui/data-context';
import { Box, Button, Choice, Field, ListItem, Muted, Notice, Screen, Title } from '../ui/kit';

/**
 * Optional expense capture (#19). Off by default; Android only. The system grants
 * access to every app's notifications: the app list below is EcoFinance's own
 * filter, applied before anything is stored or sent.
 */
const KNOWN_APPS = [
  ['com.nu.production', 'Nubank'], ['com.itau', 'Itaú'], ['br.com.intermedium', 'Inter'], ['com.bradesco', 'Bradesco'],
  ['br.com.bb.android', 'Banco do Brasil'], ['com.picpay', 'PicPay'], ['com.mercadopago.wallet', 'Mercado Pago'], ['other', 'Outro app (informar pacote)'],
] as const;
const when = (time: number | null | undefined) => time ? new Date(time).toLocaleString('pt-BR') : 'nunca';

function Unavailable() {
  return <Screen>
    <Title>Captura de gastos</Title>
    <Muted>Este aparelho não permite que o EcoFinance leia notificações de outros apps (iPhone e web não oferecem esse acesso). Use a importação de arquivos ou o cadastro manual; tudo funciona sem a captura.</Muted>
  </Screen>;
}

export function CaptureScreen() {
  if (!captureNative) return <Unavailable />;
  return <CaptureSettings />;
}

function CaptureSettings() {
  const native = captureNative!;
  const navigation = useStack();
  const { userId } = useData();
  const refs = useResource('references', read.references);
  const cards = useResource('cards', read.cards);
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [app, setApp] = useState(''), [pkg, setPkg] = useState(''), [target, setTarget] = useState('');
  const [status, setStatus] = useState(() => native.status()), [granted, setGranted] = useState(() => native.isAccessGranted());
  const [sync, setSync] = useState<Awaited<ReturnType<typeof captureSyncState>> | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState({ text: '', tone: 'ok' as 'ok' | 'danger' });
  const refresh = useCallback(async () => {
    setStatus(native.status()); setGranted(native.isAccessGranted()); setSync(await captureSyncState(userId));
    setSources(await loadCaptureSources());
  }, [native, userId]);
  useEffect(() => { refresh().catch(() => setMessage({ text: 'Não foi possível carregar a captura. Verifique a conexão.', tone: 'danger' })); }, [refresh]);
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true); setMessage({ text: '', tone: 'ok' });
    try { await work(); await refresh(); setMessage({ text: done, tone: 'ok' }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : 'Falha ao salvar.', tone: 'danger' }); }
    finally { setBusy(false); }
  }
  const targets = [
    ...(refs.loaded?.data.accounts ?? []).filter(row => !row.archivedAt).map(row => [`account:${row.id}`, `Conta ${row.name}`] as const),
    ...(cards.loaded?.data.cards ?? []).filter(row => !row.archived).map(row => [`card:${row.id}`, `Cartão ${row.name}`] as const),
  ];
  const names = new Map(targets);
  const chosen = app === 'other' ? pkg.trim() : app;
  const label = KNOWN_APPS.find(([id]) => id === app)?.[1] ?? chosen;
  function add() {
    const [kind, id] = target.split(':');
    const next = [...(sources ?? []).filter(source => source.package !== chosen), { package: chosen, label: app === 'other' ? chosen : label, accountId: kind === 'account' ? id! : null, cardId: kind === 'card' ? id! : null }];
    void run(() => saveCaptureSources(native, userId, next), 'App habilitado. Novos avisos dele viram sugestões para revisar.').then(() => { setApp(''); setPkg(''); setTarget(''); });
  }
  const state = !status.owner ? 'pausada' : !granted ? 'sem acesso às notificações' : status.connected ? 'ativa' : 'aguardando o Android conectar o serviço';
  return <Screen>
    <Title>Captura de gastos (opcional)</Title>
    <Muted>Ao autorizar, o Android permite que o EcoFinance veja as notificações de todos os apps. O EcoFinance guarda apenas avisos dos apps que você escolher abaixo e descarta os demais, além de códigos e senhas, antes de salvar ou enviar.</Muted>
    <Muted>Cada aviso vira uma sugestão em Importar; nada entra nos totais sem a sua confirmação. Avisos ocultos, apagados ou nunca recebidos não são recuperados, e o sistema pode encerrar o serviço.</Muted>
    <Box>
      <Muted>Estado: {state} · na fila: {status.queued} · último aviso: {when(status.lastEventAt)} · último envio: {when(sync?.lastSyncAt)}</Muted>
      {status.dropped ? <Notice message={`${status.dropped} aviso(s) antigos descartados porque a fila encheu sem conexão.`} tone="warning" /> : null}
      {sync?.lastError ? <Notice message={`Último envio falhou: ${sync.lastError}`} tone="warning" /> : null}
      {sync?.rejected ? <Notice message={`${sync.rejected} aviso(s) recusados pelo servidor e descartados.`} tone="warning" /> : null}
    </Box>
    <Button label={granted ? 'Revisar acesso às notificações no Android' : 'Autorizar acesso às notificações no Android'} variant="secondary" disabled={busy} onPress={() => native.openAccessSettings()} />
    <Button label="Atualizar estado" variant="secondary" disabled={busy} onPress={() => void run(refresh, 'Estado atualizado.')} />
    <Title>Apps escolhidos</Title>
    {sources === null ? <Muted>Carregando…</Muted> : sources.length ? sources.map(source => <ListItem key={source.package} title={source.label} subtitle={`${source.package} → ${names.get(source.cardId ? `card:${source.cardId}` : `account:${source.accountId}`) ?? 'destino arquivado'}`}
      onPress={() => void run(() => saveCaptureSources(native, userId, sources.filter(item => item.package !== source.package)), `${source.label} removido.`)} right="Remover" />) : <Muted>Nenhum app escolhido: a captura está desligada.</Muted>}
    <Choice label="App do banco" options={KNOWN_APPS} value={app as typeof KNOWN_APPS[number][0] | ''} disabled={busy} onChange={setApp} />
    {app === 'other' ? <Field label="Pacote Android (ex.: com.exemplo.banco)" value={pkg} onChangeText={setPkg} editable={!busy} /> : null}
    <Choice label="Conta ou cartão desses gastos" options={targets} value={target} disabled={busy} onChange={setTarget} />
    <Muted>A conta ou o cartão é sempre escolhido por você; o nome do banco no aviso nunca define o destino.</Muted>
    <Button label="Habilitar app" disabled={busy || !chosen || !target} onPress={add} />
    {sources?.length ? <Button label="Pausar captura (remover todos os apps)" variant="danger" disabled={busy} onPress={() => void run(() => saveCaptureSources(native, userId, []), 'Captura pausada. Nenhum aviso novo é guardado.')} /> : null}
    <Button label="Enviar avisos agora" variant="secondary" disabled={busy || !status.queued} onPress={() => void run(() => syncCaptures(native, userId, undefined, undefined, true), 'Avisos enviados para revisão.')} />
    <Button label="Revisar gastos detectados" disabled={busy} onPress={() => navigation.navigate('Imports')} />
    <Notice message={message.text} tone={message.tone} />
  </Screen>;
}
