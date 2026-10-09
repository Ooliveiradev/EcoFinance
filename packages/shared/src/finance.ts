import { z } from 'zod';

export const MAX_CENTS = 999_999_999_999_999n; // PostgreSQL numeric(15,2).

export function moneyToCents(value: string): bigint {
  if (!/^-?(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid decimal money.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > MAX_CENTS) throw new Error('Money exceeds numeric(15,2).');
  return negative ? -cents : cents;
}

export function centsToMoney(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  if (absolute > MAX_CENTS) throw new Error('Money exceeds numeric(15,2).');
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= maximum;
}

export const moneySchema = z.string().superRefine((value, context) => {
  try { moneyToCents(value); } catch { context.addIssue({ code: 'custom', message: 'Valor decimal inválido ou fora do limite.' }); }
}).transform(value => centsToMoney(moneyToCents(value)));
export const civilDateSchema = z.string().refine(isCivilDate, 'Data civil inválida (YYYY-MM-DD).');
export const competenceSchema = civilDateSchema.refine(value => value.endsWith('-01'), 'Competência deve ser o primeiro dia do mês.');
export const currencySchema = z.literal('BRL');
export const entryKindSchema = z.enum(['income', 'expense', 'transfer', 'refund', 'adjustment', 'unclassified']);
export const entryStatusSchema = z.enum(['planned', 'recorded', 'settled', 'cancelled']);
// notification, pluggy and uber are historical origins (retired in #15): no current
// flow writes them, but old entries keep them for reading, export and restore.
export const financialSourceSchema = z.enum(['manual', 'ofx', 'csv', 'spreadsheet', 'document', 'notification', 'email', 'pluggy', 'uber']);

const ownership = { ownerId: z.string().uuid() };
const reference = z.string().uuid();

export const financialAccountSchema = z.object({
  ...ownership, name: z.string().trim().min(1).max(120), type: z.enum(['banco', 'carteira']),
  currency: currencySchema, openingBalance: moneySchema, openingDate: civilDateSchema,
}).strict();
export const categoryInputSchema = z.object({
  ...ownership, name: z.string().trim().min(1).max(120), color: z.string().regex(/^#[\da-fA-F]{6}$/),
  icon: z.string().min(1).max(60), sortOrder: z.number().int().min(0),
}).strict();

export const financialEntrySchema = z.object({
  ...ownership, accountId: reference, categoryId: reference,
  description: z.string().trim().min(1).max(500), amount: moneySchema, currency: currencySchema,
  kind: entryKindSchema, status: entryStatusSchema, purchaseDate: civilDateSchema,
  competenceMonth: competenceSchema, dueDate: civilDateSchema.nullable(), paidDate: civilDateSchema.nullable(),
  source: financialSourceSchema, externalId: z.string().min(1).max(255).nullable(),
  invoiceId: reference.nullable(), installmentId: reference.nullable(), recurrenceOccurrenceId: reference.nullable(),
}).strict().superRefine((entry, context) => {
  const parsed = moneySchema.safeParse(entry.amount);
  if (!parsed.success) return;
  const cents = moneyToCents(parsed.data);
  if (entry.kind === 'unclassified') context.addIssue({ code: 'custom', path: ['kind'], message: 'Legado exige classificação antes de uma nova gravação.' });
  if (cents === 0n) context.addIssue({ code: 'custom', path: ['amount'], message: 'Valor zero não é um lançamento.' });
  if ((entry.kind === 'expense' && cents >= 0n) || (['income', 'refund'].includes(entry.kind) && cents <= 0n)) {
    context.addIssue({ code: 'custom', path: ['amount'], message: 'Sinal incompatível com o tipo explícito.' });
  }
  if (entry.status === 'settled' && !entry.paidDate) context.addIssue({ code: 'custom', path: ['paidDate'], message: 'Liquidação exige data de pagamento.' });
});

export const recurrenceInputSchema = z.object({
  ...ownership, accountId: reference, categoryId: reference, description: z.string().min(1).max(500),
  amount: moneySchema, currency: currencySchema, startDate: civilDateSchema, endDate: civilDateSchema.nullable(),
  dueDay: z.number().int().min(1).max(31), estimated: z.boolean(),
}).strict().refine(rule => !rule.endDate || rule.endDate >= rule.startDate, 'Fim anterior ao início.');

export const budgetInputSchema = z.object({ ...ownership, competenceMonth: competenceSchema, limit: moneySchema, expectedIncome: moneySchema, reserve: moneySchema, currency: currencySchema }).strict()
  .refine(budget => [budget.limit, budget.expectedIncome, budget.reserve].every(value => { const parsed = moneySchema.safeParse(value); return parsed.success && moneyToCents(parsed.data) >= 0n; }), 'Planejamento não aceita valores negativos.');
export const cardInputSchema = z.object({ ...ownership, name: z.string().min(1).max(120), paymentAccountId: reference, closingDay: z.number().int().min(1).max(31), dueDay: z.number().int().min(1).max(31), currency: currencySchema }).strict();
export const invoiceInputSchema = z.object({ ...ownership, cardId: reference, competenceMonth: competenceSchema, closingDate: civilDateSchema, dueDate: civilDateSchema, statedTotal: moneySchema.nullable(), currency: currencySchema }).strict();
export const installmentGroupInputSchema = z.object({ ...ownership, cardId: reference, description: z.string().min(1).max(500), totalAmount: moneySchema, purchaseDate: civilDateSchema, count: z.number().int().min(1).max(600), currency: currencySchema }).strict()
  .refine(group => { const parsed = moneySchema.safeParse(group.totalAmount); return parsed.success && moneyToCents(parsed.data) > 0n; }, 'Total deve ser positivo.');
export const importBatchStateSchema = z.enum(['received', 'processing', 'review', 'confirmed', 'failed', 'cancelled', 'reverted']);
export const importItemSchema = z.object({
  ...ownership, batchId: reference, position: z.number().int().min(1),
  accountId: reference.nullable(), categoryId: reference.nullable(), invoiceId: reference.nullable(),
  amount: moneySchema.nullable(), currency: currencySchema.nullable(), purchaseDate: civilDateSchema.nullable(),
  competenceMonth: competenceSchema.nullable(), kind: entryKindSchema.nullable(),
  description: z.string().max(500).nullable(), provenance: z.object({ page: z.number().int().min(1).optional(), row: z.number().int().min(1).optional(), cell: z.string().max(40).optional(), excerpt: z.string().max(500).optional() }).strict(),
  warnings: z.array(z.string().max(200)), state: z.enum(['pending', 'valid', 'invalid', 'excluded', 'committed']),
}).strict();

export type FinancialEntryInput = z.infer<typeof financialEntrySchema>;
export type FinancialAccountInput = z.infer<typeof financialAccountSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type ImportItemInput = z.infer<typeof importItemSchema>;

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBRL(value: number): string {
  return brlFormatter.format(value);
}
