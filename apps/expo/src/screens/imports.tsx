import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { ImportBatchView } from '@ecofinance/shared';
import { ApiError, toApiError } from '../data/api';
import { NO_NOTICE, type NoticeState } from '../data/outcome';
import {
  BATCH_STATE, checkPicked, intentKey, pendingReview, processBatch, uploadImports, uploadSignature,
  type BatchAction, type ImportTarget, type PickedFile,
} from '../data/imports';
import { read } from '../data/resources';
import { useStack, type StackProps } from '../navigation';
import { useResource } from '../ui/data-context';
import { Badge, Box, Button, Choice, ErrorState, ListItem, Loading, MoneyLine, Muted, Notice, Screen, SourceBanner, Title } from '../ui/kit';
import { styles } from '../ui/theme';
import { ReviewRow } from './import-review-row';
import { useImportReview } from './use-import-review';

function failure(raw: unknown): NoticeState {
  let error: ApiError;
  try { error = toApiError(raw); } catch { return { message: 'Falha inesperada. Tente novamente.', tone: 'danger' }; }
  if (error.kind === 'offline') return { message: 'Sem conexão: a importação precisa do servidor (a análise não roda no telefone). Tente ao reconectar; repetir não duplica o envio.', tone: 'warning' };
  if (error.kind === 'conflict') return { message: `${error.message} A lista foi recarregada; revise antes de repetir.`, tone: 'danger' };
  return { message: error.message, tone: 'danger' };
}

export function ImportsScreen() {
  const navigation = useStack();
  const list = useResource('imports', read.imports);
  const refs = useResource('references', read.references);
  const cards = useResource('cards', read.cards);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [target, setTarget] = useState('');
  const [notice, setNotice] = useState<NoticeState>(NO_NOTICE);
  const [busy, setBusy] = useState(false);
  const keys = useRef(new Map<string, string>());
  const targets = [
    ...(refs.loaded?.data.accounts ?? []).filter(row => !row.archivedAt).map(row => [`account:${row.id}`, `Conta ${row.name}`] as const),
    ...(cards.loaded?.data.cards ?? []).filter(row => !row.archived).map(row => [`card:${row.id}`, `Cartão ${row.name}`] as const),
  ];
  async function pick() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
    if (result.canceled) return;
    const picked = result.assets.map(asset => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? null, size: asset.size ?? null }));
    setFiles(picked);
    setNotice({ message: checkPicked(picked) ?? '', tone: 'danger' });
  }
  async function upload() {
    const problem = checkPicked(files);
    if (problem) { setNotice({ message: problem, tone: 'danger' }); return; }
    const [kind, id] = target.split(':');
    if (!id) { setNotice({ message: 'Escolha a conta ou o cartão de destino.', tone: 'danger' }); return; }
    const destination: ImportTarget = kind === 'card' ? { accountId: null, cardId: id } : { accountId: id, cardId: null };
    setBusy(true);
    try {
      const { batches } = await uploadImports(files, destination, intentKey(keys.current, uploadSignature(files, destination)));
      // Analysis runs on the server; the phone only uploads and reviews.
      await Promise.all(batches.map(batch => processBatch(batch, intentKey(keys.current, `process:${batch.id}:${batch.revision}`))));
      setFiles([]);
      list.reload();
      if (batches.length === 1) navigation.navigate('ImportReview', { batchId: batches[0]!.id });
      else setNotice({ message: `${batches.length} arquivos enviados. Abra cada lote para revisar.`, tone: 'ok' });
    } catch (raw) { setNotice(failure(raw)); }
    finally { setBusy(false); }
  }
  return <Screen refreshing={list.refreshing} onRefresh={list.reload}>
    <Box>
      <Title>Importar extrato ou fatura</Title>
      <Muted>OFX, CSV, planilha ou PDF de até 256 KiB. A análise roda no servidor; nada é lançado antes da sua revisão e confirmação.</Muted>
      <Button label="Selecionar arquivos" variant="secondary" disabled={busy} onPress={() => void pick()} />
      {files.map(file => <Text key={file.uri} style={styles.muted}>{file.name}{file.size !== null ? ` · ${Math.ceil(file.size / 1024)} KiB` : ''}</Text>)}
      <Choice label="Destino" options={targets} value={target} onChange={setTarget} />
      <Button label={busy ? 'Enviando…' : 'Enviar e analisar'} disabled={busy || !files.length} onPress={() => void upload()} />
      <Notice message={notice.message} tone={notice.tone} />
    </Box>
    <Title>Lotes recentes</Title>
    {list.loading ? <Loading /> : null}
    {list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : null}
    {list.loaded ? <>
      <SourceBanner loaded={list.loaded} />
      {list.loaded.data.batches.length === 0 ? <Muted>Nenhuma importação ainda.</Muted> : null}
      {list.loaded.data.batches.map(batch => <ListItem key={batch.id} title={batch.filename} subtitle={`${BATCH_STATE[batch.state] ?? batch.state} · ${batch.format} · ${batch.createdAt.slice(0, 10)}`}
        onPress={() => navigation.navigate('ImportReview', { batchId: batch.id })} />)}
    </> : null}
  </Screen>;
}

function BatchSummary({ view }: { view: ImportBatchView }) {
  const ready = view.rows.filter(row => row.selected && row.state === 'valid').length;
  return <Box>
    <Title>{view.filename}</Title>
    <Muted>{BATCH_STATE[view.state] ?? view.state} · {view.format}{view.period ? ` · ${view.period}` : ''}</Muted>
    {view.error ? <Badge label={view.error} tone="danger" /> : null}
    {view.preview.map(month => <View key={month.month} style={{ gap: 2 }}>
      <Text style={styles.strongText}>Prévia {month.month}</Text>
      <MoneyLine label="Receitas" value={month.income} />
      <MoneyLine label="Despesas" value={month.expenses} />
    </View>)}
    {view.state === 'review' ? <Muted>{ready} de {view.rows.length} linha(s) prontas para lançar.</Muted> : null}
  </Box>;
}

function BatchActions({ view, live, busy, dirty, onAction }: { view: ImportBatchView; live: boolean; busy: boolean; dirty: boolean; onAction: (action: BatchAction) => void }) {
  if (!live) return <Muted>Cópia salva: conecte-se para revisar ou confirmar este lote.</Muted>;
  const ready = view.rows.some(row => row.selected && row.state === 'valid');
  return <View style={{ gap: 8 }}>
    {dirty ? <Notice message="Há alterações pendentes. Salve ou descarte cada linha e atualize a prévia antes de continuar." tone="warning" /> : null}
    {view.state === 'review' ? <Button label={busy ? 'Enviando…' : 'Confirmar importação'} disabled={busy || dirty || !ready} onPress={() => onAction('confirm')} /> : null}
    {view.state === 'confirmed' ? <Button label="Desfazer importação" variant="danger" disabled={busy || dirty} onPress={() => onAction('undo')} /> : null}
    {['received', 'review', 'failed'].includes(view.state) ? <Button label="Cancelar lote" variant="secondary" disabled={busy || dirty} onPress={() => onAction('cancel')} /> : null}
  </View>;
}

export function ImportReviewScreen({ route, navigation }: StackProps<'ImportReview'>) {
  const { batchId } = route.params;
  const batch = useResource('import.' + batchId, () => read.importBatch(batchId));
  const refs = useResource('references', read.references);
  const actions = useImportReview(batchId, batch.reload, failure);
  const view = batch.loaded?.data;
  useEffect(() => { if (view) navigation.setOptions({ title: view.filename }); }, [navigation, view]);
  const categories = (refs.loaded?.data.categories ?? []).filter(row => !row.archivedAt).map(row => [row.id, row.name] as const);
  if (batch.loading) return <Screen><Loading /></Screen>;
  if (!batch.loaded || !view) return <Screen>{batch.error ? <ErrorState error={batch.error} onRetry={batch.reload} /> : null}</Screen>;
  // Review and commit need the live version: a cached batch is shown read-only.
  const live = batch.loaded.source === 'network';
  const editable = live && view.state === 'review';
  return <Screen refreshing={batch.refreshing} onRefresh={batch.reload}>
    <SourceBanner loaded={batch.loaded} />
    <BatchSummary view={view} />
    <Notice message={actions.notice.message} tone={actions.notice.tone} />
    <BatchActions view={view} live={live} busy={actions.busy || batch.refreshing} dirty={actions.dirty(view)} onAction={action => void actions.act(view, action)} />
    {view.rows.map(row => <View key={row.id} style={{ gap: 4 }}>
      <ReviewRow row={row} draft={pendingReview(actions.drafts[row.id], row)} categories={categories} editable={editable} busy={actions.busy || batch.refreshing}
        onChange={form => actions.change(row, form)} onSave={() => void actions.review(row)} onDiscard={() => actions.discard(row)} />
    </View>)}
  </Screen>;
}
