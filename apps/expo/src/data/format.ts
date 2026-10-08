import { formatCents, moneySchema, type ZodError } from '@ecofinance/shared';

/**
 * Turns what a person types ("1.234,56", "R$ 12,3", "12.50") into the decimal
 * string accepted by the shared money schema. Returns null when invalid; the
 * amount itself is never rounded through floating point.
 */
export function parseMoneyInput(text: string): string | null {
  let value = text.replace(/\s|R\$/g, '');
  if (!value) return null;
  if (value.includes(',')) value = value.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(value)) value = value.replace(/\./g, '');
  const parsed = moneySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
/** Decimal strings from the API ("-1234.50"); aggregates may exceed a single entry limit. */
export function decimalToCents(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error('Valor decimal inválido.');
  const cents = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}
/** Missing values stay visibly missing; they are never shown as R$ 0,00. */
export function money(value: string | null | undefined, missing = 'indisponível'): string {
  if (value === null || value === undefined) return missing;
  return formatCents(decimalToCents(value));
}
export function absolute(value: string) { return value.startsWith('-') ? value.slice(1) : value; }
/** Amount in an input field: "1234.50" → "1234,50". */
export function moneyInput(value: string) { return absolute(value).replace('.', ','); }
const GENERIC: Record<string, string> = {
  too_small: 'Preencha este campo.', too_big: 'Valor longo demais.', invalid_type: 'Preencha este campo.',
  invalid_format: 'Escolha uma opção válida.', invalid_value: 'Escolha uma opção válida.',
};
/** Shared schemas carry Portuguese messages for business rules; structural issues get a generic one. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : 'form';
    result[key] ??= issue.code === 'custom' ? issue.message : GENERIC[issue.code] ?? 'Valor inválido.';
  }
  return result;
}
export function savedAtLabel(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
