import { z } from 'zod';
import { civilDateSchema, competenceSchema, moneySchema, moneyToCents } from './finance';
import { decimalCents } from './manual-finance';
import type { CategorySuggestion } from './assist';

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
/**
 * PDF/image extraction bounds (#10). Files keep the 256 KiB upload limit; pages,
 * decoded pixels and wall time bound the work done by the extraction worker. The
 * time limit stays below the 60 s request timeout of the Cloud Run service, and
 * `queueSeconds` bounds the wait for the single extraction slot of an instance.
 * `ocrHeadroomMb` is the memory an OCR analysis needs beyond the server's current use.
 */
export const IMPORT_DOCUMENT_LIMITS = { pages: 10, imagePixels: 40_000_000, renderPixels: 8_000_000, seconds: 45, queueSeconds: 10, password: 128, ocrHeadroomMb: 320 } as const;
/** Analysis input. A PDF password is used only by that analysis and never stored. */
export const importProcessSchema = z.object({ password: z.string().min(1).max(IMPORT_DOCUMENT_LIMITS.password).optional() }).strict();
/** Bounds of tabular layouts shown for assisted mapping and stored per user. */
export const IMPORT_MAPPING_LIMITS = { columns: 50, headerRow: 2000, sheetName: 120, profiles: 50, sampleRows: 8, sampleText: 60, sheets: 10 } as const;
const columnIndex = z.number().int().min(0).max(IMPORT_MAPPING_LIMITS.columns - 1);
/**
 * User-confirmed interpretation of a CSV/TSV or spreadsheet layout. Columns are
 * zero-based; `headerRow` is the file line/sheet row of the header, or 0 when the
 * data has no header. Null date order/decimal separator means "detect from data".
 */
export const importMappingSchema = z.object({
  sheet: z.string().min(1).max(IMPORT_MAPPING_LIMITS.sheetName).nullable(),
  headerRow: z.number().int().min(0).max(IMPORT_MAPPING_LIMITS.headerRow),
  date: columnIndex, description: columnIndex,
  amount: columnIndex.nullable(), debit: columnIndex.nullable(), credit: columnIndex.nullable(),
  dateOrder: z.enum(['dmy', 'mdy', 'ymd']).nullable(),
  decimal: z.enum([',', '.']).nullable(),
}).strict().superRefine((mapping, context) => {
  const split = mapping.debit !== null && mapping.credit !== null;
  if ((mapping.amount === null) === !split || (mapping.amount !== null && (mapping.debit !== null || mapping.credit !== null))) context.addIssue({ code: 'custom', message: 'Escolha uma coluna de valor ou as colunas de débito e crédito.' });
  const used = [mapping.date, mapping.description, mapping.amount, mapping.debit, mapping.credit].filter(value => value !== null);
  if (new Set(used).size !== used.length) context.addIssue({ code: 'custom', message: 'Cada papel precisa de uma coluna diferente.' });
});
export type ImportMapping = z.infer<typeof importMappingSchema>;
export const importMapRequestSchema = z.object({ mapping: importMappingSchema, remember: z.boolean() }).strict();
export interface ImportLayoutSheet { name: string; fingerprint: string; columns: number; headerRow: number; sample: { line: number; cells: string[] }[] }
/** Evidence persisted with a tabular batch so the user can map unknown layouts. */
export interface ImportLayout { kind: 'delimited' | 'spreadsheet'; sheets: ImportLayoutSheet[]; suggestion: ImportMapping; reasons: string[] }
/** Region of a PDF/image page as fractions (0–1) of the upright page, origin at the top left. */
export interface ImportRegion { x: number; y: number; width: number; height: number }
export interface ImportOrigin { page?: number; row?: number; cell?: string; excerpt?: string; region?: ImportRegion; method?: 'text' | 'ocr'; confidence?: number }
/** Extraction progress persisted while a document batch is processing. */
export interface ImportProgress { page: number; pages: number; stage: 'text' | 'ocr' }
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
  /** Category proposed by a rule or the local model; never applied without review. */
  suggestion: CategorySuggestion | null;
}
export interface ImportBatchView {
  id: string; filename: string; format: string; state: string; revision: string; error: string | null;
  /** Diagnostic code of a failed analysis, e.g. PASSWORD_REQUIRED for a protected PDF. */
  errorCode: string | null; progress: ImportProgress | null;
  accountId: string | null; cardId: string | null; period: string | null; createdAt: string;
  layout: ImportLayout | null; mapping: ImportMapping | null;
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
