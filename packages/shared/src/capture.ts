import { z } from 'zod';
import type { ParsedImportRow } from './imports';

/**
 * Optional expense capture (#19). The Android app forwards notifications of the
 * bank apps the user chose; each one becomes, at most, a row of an import batch in
 * review. Nothing is recorded before the user confirms it, and fields without
 * evidence in the text stay empty for the user to fill.
 */
export const CAPTURE_LIMITS = { events: 50, title: 200, text: 500, sources: 20, label: 60, excerpt: 200 } as const;
export const CAPTURE_PARSER = 'generic-ptbr@1';
const packageName = z.string().max(150).regex(/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/, 'Pacote Android inválido.');
const uuid = z.string().uuid();
export const captureEventSchema = z.object({
  /** Android package of the app that posted the notification: the source, never the bank name in the text. */
  package: packageName,
  /** StatusBarNotification key; Android may reuse it, so the post time is part of the identity. */
  key: z.string().min(1).max(200),
  postedAt: z.string().datetime({ offset: true }),
  title: z.string().max(CAPTURE_LIMITS.title).nullable(),
  text: z.string().max(CAPTURE_LIMITS.text),
}).strict();
export type CaptureEvent = z.infer<typeof captureEventSchema>;
export const captureUploadSchema = z.object({ deviceId: uuid, events: z.array(captureEventSchema).min(1).max(CAPTURE_LIMITS.events) }).strict();
export const captureSourceSchema = z.object({
  package: packageName, label: z.string().trim().min(1).max(CAPTURE_LIMITS.label),
  accountId: uuid.nullable(), cardId: uuid.nullable(),
}).strict().refine(source => !!source.accountId !== !!source.cardId, 'Escolha uma conta ou um cartão para cada app.');
export type CaptureSource = z.infer<typeof captureSourceSchema>;
export const captureSourcesSchema = z.object({ sources: z.array(captureSourceSchema).max(CAPTURE_LIMITS.sources) }).strict()
  .refine(input => new Set(input.sources.map(source => source.package)).size === input.sources.length, 'Cada app aparece uma vez.');

export type CaptureKind = 'purchase' | 'declined' | 'refund' | 'transfer-out' | 'transfer-in' | 'bill-payment' | 'sensitive' | 'unknown';
export interface CaptureParse {
  parser: typeof CAPTURE_PARSER; kind: CaptureKind; amount: string | null; merchant: string | null;
  purchaseDate: string | null; installments: number | null; warnings: string[];
}
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MONEY = /R\$\s?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+)(?!\d)/gi;
/** Values next to these words describe the account, not the charge. */
const NOT_CHARGED = /(limite|saldo|disponivel|cashback|economizou|desconto)[^r]{0,25}$/;
const decimal = (raw: string) => {
  const [units, cents = '00'] = raw.replace(/\./g, '').split(',');
  return `${BigInt(units!)}.${cents.padEnd(2, '0').slice(0, 2)}`;
};
const localDate = (instant: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instant));
function kindOf(text: string): CaptureKind {
  if (/\b(codigo|senha|token|otp)\b/.test(text) || /verificacao|autenticacao/.test(text)) return 'sensitive';
  if (/recusad|negad|nao aprovad|nao autorizad|cancelad|nao realizad/.test(text)) return 'declined';
  if (/estorn|reembols|devolucao/.test(text)) return 'refund';
  if (/pagamento (da |de )?fatura|fatura (foi )?paga/.test(text)) return 'bill-payment';
  if (/(pix|transferencia|ted)\s+(recebid)|voce recebeu/.test(text)) return 'transfer-in';
  if (/(pix|transferencia|ted)\s+(enviad|realizad|efetuad|feit|agendad)|voce (enviou|transferiu|fez um pix)/.test(text)) return 'transfer-out';
  if (/compra|debito aprovad|pagamento (aprovad|realizad|efetuad)/.test(text)) return 'purchase';
  return 'unknown';
}
/** Amounts that can be the charge: the explicit "compra de R$" first, else the only one not tied to limit/balance words. */
function chargedAmount(original: string, folded: string): { amount: string | null; ambiguous: boolean } {
  const explicit = /(?:compra|pix|transferencia|pagamento|estorno|debito)[^r$]{0,20}de\s+R\$\s?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+)/i.exec(original.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (explicit) return { amount: decimal(explicit[1]!), ambiguous: false };
  const found = [...original.matchAll(MONEY)].filter(match => !NOT_CHARGED.test(folded.slice(Math.max(0, match.index! - 40), match.index!)));
  const distinct = [...new Set(found.map(match => decimal(match[1]!)))];
  return distinct.length === 1 ? { amount: distinct[0]!, ambiguous: false } : { amount: null, ambiguous: distinct.length > 1 };
}
function merchantOf(original: string, kind: CaptureKind): string | null {
  const after = kind === 'transfer-out' ? /R\$\s?[\d.,]+\s+(?:\w+\s+){0,2}?para\s+(.+?)(?=\s+(?:em|no|na)\s+\d|[.,;]|$)/i
    : kind === 'transfer-in' ? /R\$\s?[\d.,]+\s+(?:\w+\s+){0,2}?de\s+(.+?)(?=\s+(?:em|no|na)\s+\d|[.,;]|$)/i
      : /R\$\s?[\d.,]+\s+(?:\w+\s+){0,2}?(?:em|no|na)\s+(.+?)(?=\s+(?:no|com o|com|para o|para|em)\s+(?:seu\s+)?cart|\s+em\s+\d|[.;]|,\s|$)/i;
  const name = after.exec(original)?.[1]?.replace(/\s+/g, ' ').trim();
  return name && /[a-z]/i.test(name) && !/^(cartao|conta|credito|debito)\b/i.test(fold(name)) ? name.slice(0, 120) : null;
}
function dateOf(folded: string, postedAt: string): { date: string; fromText: boolean } {
  const received = localDate(postedAt), match = /\b(\d{2})\/(\d{2})(?:\/(\d{2}|\d{4}))?\b/.exec(folded);
  if (!match) return { date: received, fromText: false };
  const [, day, month, rawYear] = match;
  let year = rawYear ? Number(rawYear.length === 2 ? '20' + rawYear : rawYear) : Number(received.slice(0, 4));
  let date = `${year}-${month}-${day}`;
  // Without a year, a day after the notice belongs to the previous year (e.g. a 31/12 purchase notified on 02/01).
  if (!rawYear && date > received) date = `${--year}-${month}-${day}`;
  const parsed = new Date(date + 'T12:00:00Z');
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? { date: received, fromText: false } : { date, fromText: true };
}
/** Deterministic, versioned reading of one notification. It never guesses missing fields. */
export function parseCapture(event: Pick<CaptureEvent, 'title' | 'text' | 'postedAt'>): CaptureParse {
  const original = [event.title, event.text].filter(Boolean).join(' — '), folded = fold(original);
  const kind = kindOf(folded), warnings: string[] = [];
  const base = { parser: CAPTURE_PARSER, kind, amount: null, merchant: null, purchaseDate: null, installments: null, warnings } as CaptureParse;
  if (['sensitive', 'declined', 'bill-payment', 'unknown'].includes(kind)) return base;
  const { amount, ambiguous } = chargedAmount(original, folded);
  if (ambiguous) warnings.push('O aviso tem mais de um valor (preço, saldo, limite…): informe o valor cobrado.');
  else if (!amount) warnings.push('Valor ausente no aviso: preencha antes de confirmar.');
  const merchant = merchantOf(original, kind);
  if (!merchant) warnings.push(kind === 'purchase' || kind === 'refund' ? 'Estabelecimento ausente no aviso: preencha a descrição.' : 'Destino/origem ausente no aviso: preencha a descrição.');
  const date = dateOf(folded, event.postedAt);
  if (!date.fromText) warnings.push('Data da compra igual à data do aviso: confira.');
  const parcels = /em (\d{1,2}) ?x\b|(\d{1,2}) parcelas/.exec(folded), installments = parcels ? Number(parcels[1] ?? parcels[2]) : null;
  if (installments && installments > 1) warnings.push(`Parcelado em ${installments}x: confira se o valor é da parcela ou o total. Parcelas futuras não são criadas.`);
  if (kind === 'transfer-out') warnings.push('Pix/transferência: se foi entre contas suas, exclua a linha (não é despesa).');
  if (kind === 'transfer-in') warnings.push('Entrada por Pix/transferência: confira se não é dinheiro seu vindo de outra conta.');
  if (kind === 'refund') warnings.push('Estorno: entra como crédito. Confira a compra original; o histórico dela é mantido.');
  const sign = kind === 'purchase' || kind === 'transfer-out' ? '-' : '';
  return { ...base, amount: amount && amount !== '0.00' ? sign + amount : null, merchant, purchaseDate: date.date, installments };
}
/** Kinds that never become a row: declined purchases, bill payments, codes and non-financial notices. */
export const IGNORED_CAPTURE: Partial<Record<CaptureKind, string>> = {
  declined: 'compra recusada ou cancelada', 'bill-payment': 'pagamento de fatura', sensitive: 'código ou dado sensível', unknown: 'aviso não financeiro',
};
export function captureRow(event: CaptureEvent, parse: CaptureParse, externalId: string): ParsedImportRow | null {
  if (parse.kind in IGNORED_CAPTURE) return null;
  const excerpt = [event.title, event.text].filter(Boolean).join(': ').replace(/\s+/g, ' ').slice(0, CAPTURE_LIMITS.excerpt);
  return { description: parse.merchant, amount: parse.amount, purchaseDate: parse.purchaseDate, externalId, provenance: { excerpt }, warnings: [`Detectado em notificação (${parse.parser}).`, ...parse.warnings] };
}
