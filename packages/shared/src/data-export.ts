import { z } from 'zod';
import { csvCell } from './metrics';
import { civilDateSchema } from './finance';

export const USER_BACKUP_FORMAT = 'ecofinance-user-backup';
export const USER_BACKUP_VERSION = 1;
/** Restore is one Firestore transaction (10 MiB request, 270 s): these bounds keep it atomic. */
export const DATA_LIMITS = { backupBytes: 6 * 1024 * 1024, restoreDocuments: 3000 };
export const IMPORT_ORIGINAL_RETENTION_DAYS = 7;
export const RESTORE_CONFIRMATION = 'RESTAURAR';
export const DELETE_DATA_CONFIRMATION = 'EXCLUIR MEUS DADOS';
export const DELETE_ACCOUNT_CONFIRMATION = 'EXCLUIR MINHA CONTA';

/** Owned collections in a user backup, in referential write order. */
export const BACKUP_COLLECTIONS = ['uberTripsMetadata', 'accounts', 'categories', 'cards', 'invoices', 'installmentGroups', 'installments', 'recurrenceRules', 'recurrenceOccurrences', 'budgets', 'budgetCategories', 'planningMonths', 'preferences', 'transactions', 'importBatches', 'importItems'] as const;
export type BackupCollection = typeof BACKUP_COLLECTIONS[number];
export const BACKUP_COLLECTION_LABELS: Record<BackupCollection, string> = {
  uberTripsMetadata: 'Metadados legados de viagens', accounts: 'Contas', categories: 'Categorias', cards: 'Cartões', invoices: 'Faturas',
  installmentGroups: 'Compras parceladas', installments: 'Parcelas', recurrenceRules: 'Recorrências', recurrenceOccurrences: 'Ocorrências de recorrência',
  budgets: 'Orçamentos', budgetCategories: 'Limites por categoria', planningMonths: 'Meses de planejamento', preferences: 'Preferências',
  transactions: 'Lançamentos', importBatches: 'Lotes de importação', importItems: 'Linhas importadas',
};

export const restoreRequestSchema = z.object({
  backup: z.record(z.string(), z.unknown()),
  ownerMode: z.enum(['same', 'adopt']).default('same'),
  confirm: z.literal(RESTORE_CONFIRMATION).optional(),
}).strict();
export const deleteDataSchema = z.object({ scope: z.enum(['data', 'account']), confirm: z.string().max(40) }).strict()
  .refine(input => input.confirm === (input.scope === 'data' ? DELETE_DATA_CONFIRMATION : DELETE_ACCOUNT_CONFIRMATION), { path: ['confirm'], message: 'Digite a confirmação exatamente como indicado.' });
export const entriesExportSchema = z.object({ from: civilDateSchema.optional(), to: civilDateSchema.optional() }).strict()
  .refine(q => !q.from || !q.to || q.from <= q.to, 'Intervalo inválido.');

export interface RestorePreview {
  createdAt: string; foreignOwner: boolean; currentRevision: string; sha256: string;
  backup: Record<BackupCollection, number>; current: Record<BackupCollection, number>;
  totals: { entries: number; amount: string; archived: number };
}
export interface DataSummary {
  revision: string; counts: Record<BackupCollection, number>; retentionDays: number;
  originals: { id: string; filename: string; state: string; createdAt: string; expiresAt: string; revision: string }[];
  limits: typeof DATA_LIMITS;
}

const KIND: Record<string, string> = { income: 'receita', expense: 'despesa', transfer: 'transferência', refund: 'estorno', adjustment: 'ajuste', unclassified: 'não classificado' };
const STATUS: Record<string, string> = { planned: 'previsto', recorded: 'registrado', settled: 'pago', cancelled: 'cancelado' };
export interface CsvEntry {
  id: string; purchaseDate: string; competenceMonth: string; description: string; amount: string; kind: string; status: string;
  account: string; category: string; dueDate: string | null; paidDate: string | null; notes: string | null; source: string;
  archived: boolean; transferId: string | null;
}
/** Entry-level CSV: every user-controlled cell is neutralized against formula injection. */
export function entriesCsv(rows: CsvEntry[]): string {
  const lines: (string | number)[][] = [
    ['data', 'competência', 'descrição', 'valor', 'tipo', 'status', 'conta', 'categoria', 'vencimento', 'pagamento', 'observações', 'origem', 'arquivado', 'id', 'transferência'],
    ...rows.map(row => [row.purchaseDate, row.competenceMonth.slice(0, 7), row.description, row.amount, KIND[row.kind] ?? row.kind, STATUS[row.status] ?? row.status,
      row.account, row.category, row.dueDate ?? '', row.paidDate ?? '', row.notes ?? '', row.source, row.archived ? 'sim' : 'não', row.id, row.transferId ?? '']),
  ];
  return '﻿' + lines.map(line => line.map(csvCell).join(';')).join('\r\n') + '\r\n';
}
