import type { TransactionCategory } from './types';

// =============================================================================
// Category labels (legacy enum keys)
// =============================================================================
// Single source of truth for the pt-BR names shown in the web and mobile apps.
// Owner-defined categories (EF-02) carry their own names; these cover the
// legacy enum values that still exist in historical data.
// =============================================================================

export const TRANSACTION_CATEGORY_LABELS: Readonly<Record<TransactionCategory, string>> = {
  comida: 'Alimentação',
  transporte: 'Transporte',
  assinaturas: 'Assinaturas',
  lazer: 'Lazer',
  saude: 'Saúde',
  educacao: 'Educação',
  moradia: 'Moradia',
  salario: 'Salário',
  investimento: 'Investimento',
  transferencia: 'Transferência',
  desconhecido: 'Outros',
};

export function isTransactionCategory(value: unknown): value is TransactionCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRANSACTION_CATEGORY_LABELS, value);
}

/** Display name for a category key; unknown keys are shown as-is so nothing is silently renamed. */
export function categoryLabel(key: string): string {
  return isTransactionCategory(key) ? TRANSACTION_CATEGORY_LABELS[key] : key;
}

export interface CategoryOption {
  value: TransactionCategory;
  label: string;
}

export const TRANSACTION_CATEGORY_OPTIONS: readonly CategoryOption[] = (
  Object.keys(TRANSACTION_CATEGORY_LABELS) as TransactionCategory[]
).map(value => ({ value, label: TRANSACTION_CATEGORY_LABELS[value] }));
