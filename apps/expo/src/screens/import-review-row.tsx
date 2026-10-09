import React from 'react';
import { Text, View } from 'react-native';
import type { ImportRowView } from '@ecofinance/shared';
import { money } from '../data/format';
import { reviewForm, type ReviewDraft, type ReviewForm } from '../data/imports';
import { Badge, Box, Button, Choice, Field, Muted, Notice } from '../ui/kit';
import { styles } from '../ui/theme';

interface RowProps {
  row: ImportRowView; draft?: ReviewDraft; categories: (readonly [string, string])[]; editable: boolean; busy: boolean;
  onChange: (form: ReviewForm) => void; onSave: () => void; onDiscard: () => void;
}

function CurrentReview({ row, categories }: Pick<RowProps, 'row' | 'categories'>) {
  const category = categories.find(([id]) => id === row.categoryId)?.[1] ?? row.categoryId ?? 'sem categoria';
  const resolution = { new: 'criar', link: 'vincular existente', exclude: 'excluir' }[row.resolution];
  return <Muted>Versão atual no servidor: competência {row.competenceMonth?.slice(0, 7) ?? 'ausente'} · categoria {category} · ação {resolution} · {row.selected ? 'incluída' : 'não incluída'}{row.duplicateId ? ` · vínculo ${row.duplicateId}` : ''}.</Muted>;
}

function ReviewActions({ row, draft, categories, disabled, busy, onSave, onDiscard }: Pick<RowProps, 'row' | 'draft' | 'categories' | 'busy' | 'onSave' | 'onDiscard'> & { disabled: boolean }) {
  const stale = !!draft && draft.base.revision !== row.revision;
  return <>
    {stale ? <>
      <CurrentReview row={row} categories={categories} />
      <Notice message="Esta linha mudou no servidor. Seu rascunho foi mantido. Compare os dados acima e descarte o rascunho para editar a versão atual." tone="warning" />
    </> : null}
    {draft?.saved ? <Muted>Linha salva. Atualize o lote para conferir a prévia antes de confirmar.</Muted> : null}
    <Button label={`Salvar linha ${row.position}`} disabled={disabled || !draft || stale} onPress={onSave} />
    {draft && !draft.saved ? <Button label={`Descartar alterações da linha ${row.position}`} variant="secondary" disabled={busy} onPress={onDiscard} /> : null}
  </>;
}

function ReviewChoices({ row, form, categories, disabled, errors, change }: Pick<RowProps, 'row' | 'categories'> & {
  form: ReviewForm; disabled: boolean; errors: Record<string, string>; change: (patch: Partial<ReviewForm>) => void;
}) {
  const duplicates = row.candidates.map(candidate => [candidate.id, `${candidate.description} · ${money(candidate.amount)} · ${candidate.purchaseDate}${candidate.exact ? ' (mesmo lançamento)' : ''}`] as const);
  return <>
    <Choice label="Categoria" options={categories} value={form.categoryId} disabled={disabled} error={errors.categoryId} onChange={categoryId => change({ categoryId })} />
    <Choice label="Ação" options={[['new', 'Criar'], ...(duplicates.length ? [['link', 'Vincular existente'] as const] : []), ['exclude', 'Excluir']] as const}
      value={form.resolution} disabled={disabled} error={errors.resolution} onChange={resolution => change({ resolution, selected: resolution !== 'exclude' && form.selected, duplicateId: resolution === 'link' ? form.duplicateId ?? duplicates[0]?.[0] ?? null : null })} />
    {form.resolution !== 'exclude' ? <Choice label="Incluir na confirmação" options={[['yes', 'Sim'], ['no', 'Não']] as const} value={form.selected ? 'yes' : 'no'} disabled={disabled} onChange={selected => change({ selected: selected === 'yes' })} /> : null}
    {form.resolution === 'link' ? <Choice label="Lançamento existente" options={duplicates} value={form.duplicateId ?? ''} disabled={disabled} error={errors.duplicateId} onChange={duplicateId => change({ duplicateId })} /> : null}
  </>;
}

function RowEditor(props: RowProps) {
  const { row, draft, categories, editable, busy, onChange } = props;
  const form = draft?.form ?? reviewForm(row), errors = draft?.errors ?? {};
  const disabled = !editable || busy || !!draft?.saved;
  const change = (patch: Partial<ReviewForm>) => onChange({ ...form, ...patch });
  return <>
      <Field label="Descrição" value={form.description} editable={!disabled} error={errors.description} onChangeText={description => change({ description })} />
      <Muted>Use valor negativo para saída e positivo para entrada ou estorno.</Muted>
      <Field label="Valor com sinal" value={form.amount} editable={!disabled} error={errors.amount} placeholder="-123,45" onChangeText={amount => change({ amount })} />
      <Field label="Data da compra (AAAA-MM-DD)" value={form.purchaseDate} editable={!disabled} error={errors.purchaseDate} onChangeText={purchaseDate => change({ purchaseDate })} />
      <Field label="Competência (AAAA-MM)" value={form.competenceMonth} editable={!disabled} error={errors.competenceMonth} onChangeText={competenceMonth => change({ competenceMonth })} />
      <ReviewChoices row={row} form={form} categories={categories} disabled={disabled} errors={errors} change={change} />
      <Notice message={errors.form ?? ''} tone="danger" />
      <ReviewActions {...props} disabled={disabled} />
  </>;
}

export function ReviewRow(props: RowProps) {
  const { row, draft, editable } = props;
  return <Box tone={row.state === 'invalid' ? 'danger' : undefined}>
    <View style={styles.line}>
      <Text style={styles.itemTitle}>{row.description ?? 'Sem descrição'}</Text>
      <Text style={styles.itemRight}>{money(row.amount, 'sem valor')}</Text>
    </View>
    <Muted>Linha {row.position} · {row.purchaseDate ?? 'sem data'} · {row.state === 'valid' ? 'pronta' : row.state === 'invalid' ? 'inválida' : row.state}</Muted>
    {row.provenance.excerpt ? <Muted>Origem: “{row.provenance.excerpt}”</Muted> : null}
    {row.warnings.map(warning => <Badge key={warning} label={warning} />)}
    {editable || draft ? <RowEditor {...props} /> : null}
  </Box>;
}
