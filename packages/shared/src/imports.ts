import { z } from 'zod';
import { civilDateSchema, competenceSchema, moneySchema, moneyToCents } from './finance';
import { decimalCents } from './manual-finance';

/** Small bounded files keep staging and confirmation within one atomic commit. */
export const IMPORT_LIMITS = { files: 10, bytes: 256 * 1024, rows: 60 } as const;
export const importSourceSchema = z.enum(['ofx','csv','spreadsheet','document']);
export type ImportSource = z.infer<typeof importSourceSchema>;
export const importIdSchema=z.string().uuid();
export const importTargetSchema=z.object({accountId:importIdSchema.nullable(),cardId:importIdSchema.nullable()}).strict().refine(target=>!!target.accountId!==!!target.cardId,'Escolha uma conta ou cartão de destino.');
export const importReviewSchema = z.object({
  description: z.string().trim().min(1).max(500),
  amount: moneySchema.refine(value => moneyToCents(value) !== 0n, 'Informe valor diferente de zero.'),
  purchaseDate: civilDateSchema, competenceMonth: competenceSchema,
  categoryId: z.string().uuid(), selected: z.boolean(),
  resolution: z.enum(['new', 'link', 'exclude']),
  duplicateId: z.string().uuid().nullable(),
}).strict().refine(row => row.resolution !== 'link' || row.duplicateId !== null, 'Escolha o lançamento existente.');
export const importConfirmSchema = z.object({ confirmed: z.literal(true) }).strict();
export interface ImportOrigin { page?: number; row?: number; cell?: string; excerpt?: string }
export interface ParsedImportRow {
  description: string | null; amount: string | null; purchaseDate: string | null;
  externalId: string | null; provenance: ImportOrigin; warnings: string[];
}
export interface ImportCandidate { id: string; description: string; amount: string; purchaseDate: string; exact: boolean; categoryId?:string; competenceMonth?:string; status?:string;archived?:boolean }
export interface ImportRowView {
  id: string; position: number; state: string; revision: string;
  description: string | null; amount: string | null; purchaseDate: string | null; competenceMonth: string | null;
  categoryId: string | null; selected: boolean; resolution: 'new' | 'link' | 'exclude'; duplicateId: string | null;
  warnings: string[]; provenance: ImportOrigin; candidates: ImportCandidate[]; undoReason: string | null;
}
export interface ImportBatchView {
  id: string; filename: string; format: string; state: string; revision: string; error: string | null;
  accountId: string | null; cardId: string | null; period: string | null; createdAt: string;
  rows: ImportRowView[]; preview: ReturnType<typeof importPreview>;
}
export function importPreview(rows: Pick<ImportRowView, 'selected' | 'resolution' | 'state' | 'amount' | 'competenceMonth'>[], card = false) {
  const monthly = new Map<string, { income: bigint; expenses: bigint; balance: bigint }>();
  for (const row of rows) {
    if (!row.selected || row.resolution !== 'new' || row.state !== 'valid' || !row.amount || !row.competenceMonth) continue;
    const cents = moneyToCents(row.amount), month = row.competenceMonth.slice(0, 7);
    const value = monthly.get(month) ?? { income: 0n, expenses: 0n, balance: 0n };
    if (cents < 0n) value.expenses -= cents;
    else if (card) value.expenses -= cents;
    else value.income += cents;
    if (!card) value.balance += cents;
    monthly.set(month, value);
  }
  return [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({
    month, income: decimalCents(value.income), expenses: decimalCents(value.expenses), balance: decimalCents(value.balance),
  }));
}
