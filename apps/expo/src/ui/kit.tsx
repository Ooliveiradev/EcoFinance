import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { monthLabel, shiftMonth } from '@ecofinance/shared';
import type { ApiError } from '../data/api';
import type { Loaded } from '../data/cache';
import { money, savedAtLabel } from '../data/format';
import { colors, styles } from './theme';



export function Screen({ children, refreshing = false, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
    refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}>
    {children}
  </ScrollView>;
}
export function Title({ children }: { children: React.ReactNode }) {
  return <Text accessibilityRole="header" style={styles.title}>{children}</Text>;
}
export function Muted({ children }: { children: React.ReactNode }) { return <Text style={styles.muted}>{children}</Text>; }
export function Box({ children, tone }: { children: React.ReactNode; tone?: 'warning' | 'danger' }) {
  return <View style={[styles.box, tone === 'warning' && styles.warningBox, tone === 'danger' && styles.dangerBox]}>{children}</View>;
}
export function Button({ label, onPress, variant = 'primary', disabled = false, hint }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; hint?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, variant === 'secondary' && styles.secondary, variant === 'danger' && styles.danger, (disabled || pressed) && styles.dim]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
export function Field({ label, value, onChangeText, error, keyboardType, placeholder, multiline, editable = true }: {
  label: string; value: string; onChangeText: (value: string) => void; error?: string; keyboardType?: KeyboardTypeOptions; placeholder?: string; multiline?: boolean; editable?: boolean;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput accessibilityLabel={label} accessibilityHint={error} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholder={placeholder}
      placeholderTextColor={colors.subtle} multiline={multiline} editable={editable} style={[styles.input, !!error && styles.inputError]} />
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}
export function Choice<T extends string>({ label, options, value, onChange, error, disabled = false }: { label: string; options: readonly (readonly [T, string])[]; value: T | ''; onChange: (value: T) => void; error?: string; disabled?: boolean }) {
  return <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel={label}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.chips}>
      {options.map(([option, text]) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: option === value, disabled }} disabled={disabled} onPress={() => onChange(option)}
        style={[styles.chip, option === value && styles.chipSelected, disabled && styles.dim]}>
        <Text style={styles.chipText}>{text}</Text>
      </Pressable>)}
    </View>
    {options.length === 0 ? <Text style={styles.muted}>Nenhuma opção ativa. Cadastre uma antes.</Text> : null}
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}
export function MoneyLine({ label, value, missing, strong }: { label: string; value: string | null | undefined; missing?: string; strong?: boolean }) {
  const text = money(value, missing);
  return <View style={styles.line} accessible accessibilityLabel={`${label}: ${text}`}>
    <Text style={[styles.lineLabel, strong && styles.strong]}>{label}</Text>
    <Text style={[styles.lineValue, strong && styles.strong, value === null && styles.missing]}>{text}</Text>
  </View>;
}
/** Horizontal bar whose spoken label carries the value; colour is never the only signal. */
export function Bar({ label, value, share, color }: { label: string; value: string; share: number; color: string }) {
  const width = `${Math.max(0, Math.min(100, share))}%` as const;
  return <View accessible accessibilityLabel={`${label}: ${money(value)}, ${share.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% das despesas`} style={styles.barRow}>
    <View style={styles.line}><Text style={styles.lineLabel}>{label}</Text><Text style={styles.lineValue}>{money(value)}</Text></View>
    <View style={styles.barTrack}><View style={[styles.barFill, { width, backgroundColor: color }]} /></View>
  </View>;
}
export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return <View style={styles.center} accessibilityLabel={label}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>{label}</Text></View>;
}
const ERROR_TITLE: Record<ApiError['kind'], string> = {
  offline: 'Sem conexão e sem cópia salva neste aparelho',
  unavailable: 'Servidor indisponível e sem cópia salva',
  expired: 'Sessão expirada', conflict: 'Conflito', invalid: 'Pedido recusado', 'not-found': 'Não encontrado', forbidden: 'Acesso recusado',
};
/** Real failure state: nothing is replaced by empty lists or zero totals. */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return <Box tone="danger">
    <Text accessibilityRole="alert" style={styles.strongText}>{ERROR_TITLE[error.kind]}</Text>
    <Text style={styles.muted}>{error.message} Os valores não são exibidos para não mostrar números incorretos.</Text>
    {onRetry ? <Button label="Tentar novamente" variant="secondary" onPress={onRetry} /> : null}
  </Box>;
}
export function SourceBanner<T>({ loaded }: { loaded: Loaded<T> }) {
  if (loaded.source === 'network') return null;
  return <Box tone="warning">
    <Text accessibilityRole="alert" style={styles.strongText}>Mostrando cópia salva em {savedAtLabel(loaded.savedAt)}</Text>
    <Text style={styles.muted}>{loaded.error?.message} Puxe para atualizar quando a conexão voltar. Alterações feitas agora ficam pendentes.</Text>
  </Box>;
}
export function MonthBar({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  const previous = shiftMonth(month, -1), next = shiftMonth(month, 1);
  return <View style={styles.monthBar}>
    <Pressable accessibilityRole="button" accessibilityLabel="Mês anterior" disabled={!previous} onPress={() => previous && onChange(previous)} style={styles.monthButton}><Text style={styles.monthArrow}>‹</Text></Pressable>
    <Text accessibilityRole="header" style={styles.monthLabel}>{monthLabel(month)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Próximo mês" disabled={!next} onPress={() => next && onChange(next)} style={styles.monthButton}><Text style={styles.monthArrow}>›</Text></Pressable>
  </View>;
}
export function Badge({ label, tone = 'warning' }: { label: string; tone?: 'warning' | 'danger' | 'ok' }) {
  return <Text style={[styles.badge, tone === 'danger' && styles.badgeDanger, tone === 'ok' && styles.badgeOk]}>{label}</Text>;
}
export function Notice({ message, tone = 'ok' }: { message: string; tone?: 'ok' | 'warning' | 'danger' }) {
  if (!message) return null;
  return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.notice, tone === 'warning' && { color: colors.warning }, tone === 'danger' && { color: colors.dangerText }]}>{message}</Text>;
}
export function ListItem({ title, subtitle, right, onPress, badge }: { title: string; subtitle?: string; right?: string; onPress?: () => void; badge?: React.ReactNode }) {
  const body = <>
    <View style={styles.itemMain}>
      <Text style={styles.itemTitle}>{title}</Text>
      {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      {badge}
    </View>
    {right ? <Text style={styles.itemRight}>{right}</Text> : null}
  </>;
  if (!onPress) return <View style={styles.item} accessible>{body}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.dim]}>{body}</Pressable>;
}
