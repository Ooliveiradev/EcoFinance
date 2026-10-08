import { civilDateSchema, moneySchema } from '@ecofinance/shared';

/** Exact text interpretation of dates and money. Nothing here uses parseFloat or Date parsing. */
export type DateOrder = 'dmy' | 'mdy' | 'ymd';
export type Decimal = ',' | '.';
export interface ValueResult { value: string | null; warning?: string }

const months: Record<string, number> = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
type Parts = { kind: 'fixed'; year: string; month: number; day: number } | { kind: 'pair'; first: number; second: number; year: string };

export function cellColumn(index: number) {
  let column = index + 1, label = '';
  while (column > 0) { label = String.fromCharCode(65 + (column - 1) % 26) + label; column = Math.floor((column - 1) / 26); }
  return label;
}
function year(raw: string) {
  if (raw.length === 4) return { year: raw };
  // Excel's two-digit window: 00–29 → 2000s, 30–99 → 1900s. Always reported.
  const full = (Number(raw) < 30 ? '20' : '19') + raw;
  return { year: full, warning: `Ano com dois dígitos (${raw}) interpretado como ${full}; confira a data.` };
}
function parts(raw: string): (Parts & { warning?: string }) | null {
  const text = raw.trim().toLowerCase().replace(/\s+de\s+/g, ' ')
    .replace(/(?:[ t]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:z|[+-]\d{2}:?\d{2}))?)$/, '');
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return { kind: 'fixed', year: match[1]!, month: Number(match[2]), day: Number(match[3]) };
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(text);
  if (match) { const y = year(match[3]!); return { kind: 'pair', first: Number(match[1]), second: Number(match[2]), ...y }; }
  match = /^(\d{1,2})[-/. ]+([a-zç]{3})[a-zç]*\.?[-/. ]+(\d{4}|\d{2})$/.exec(text);
  if (match && months[match[2]!]) { const y = year(match[3]!); return { kind: 'fixed', month: months[match[2]!]!, day: Number(match[1]), ...y }; }
  return null;
}
function civil(yearText: string, month: number, day: number) {
  const value = `${yearText}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return civilDateSchema.safeParse(value).success ? value : null;
}
/** Evidence of day/month order in a column; ambiguous when no value disambiguates. */
export function inferDateOrder(values: string[]) {
  let dmy = false, mdy = false, ambiguous = false;
  for (const value of values) {
    const parsed = parts(value); if (parsed?.kind !== 'pair') continue;
    if (parsed.first > 12 && parsed.second <= 12) dmy = true;
    else if (parsed.second > 12 && parsed.first <= 12) mdy = true;
    else if (parsed.first !== parsed.second && parsed.first <= 12 && parsed.second <= 12) ambiguous = true;
  }
  return { order: dmy === mdy ? null : dmy ? 'dmy' as const : 'mdy' as const, conflict: dmy && mdy, ambiguous };
}
/** Civil date from text. Day/month pairs require an order; ISO and month names do not. */
export function parseDateText(raw: string, order: DateOrder | null): ValueResult {
  if (!raw.trim()) return { value: null, warning: 'Data ausente.' };
  const parsed = parts(raw);
  if (!parsed) return { value: null, warning: `Data "${raw.trim().slice(0, 40)}" em formato não reconhecido. Use DD/MM/AAAA ou AAAA-MM-DD.` };
  if (parsed.kind === 'fixed') { const value = civil(parsed.year, parsed.month, parsed.day); return value ? { value, ...(parsed.warning ? { warning: parsed.warning } : {}) } : { value: null, warning: `Data "${raw.trim()}" inexistente no calendário.` }; }
  if (parsed.first === parsed.second || order === null && (parsed.first > 12 || parsed.second > 12)) order ??= parsed.first > 12 ? 'dmy' : 'mdy';
  if (order === null) return { value: null, warning: `Data ambígua "${raw.trim()}": escolha DD/MM ou MM/DD no mapeamento.` };
  const [day, month] = order === 'mdy' ? [parsed.second, parsed.first] : [parsed.first, parsed.second];
  const value = order === 'ymd' ? null : civil(parsed.year, month, day);
  return value ? { value, ...(parsed.warning ? { warning: parsed.warning } : {}) } : { value: null, warning: `Data "${raw.trim()}" inválida para a ordem ${order === 'mdy' ? 'MM/DD' : order === 'dmy' ? 'DD/MM' : 'AAAA-MM-DD'}.` };
}
/** Signed money with an explicit separator; returns null instead of guessing. */
export function exactMoney(negative: boolean, whole: string, fraction: string): ValueResult {
  const normalized = `${negative ? '-' : ''}${whole.replace(/^0+(?=\d)/, '')}${fraction ? '.' + fraction : ''}`;
  const parsed = moneySchema.safeParse(normalized);
  if (!parsed.success) return { value: null, warning: 'Valor fora do limite monetário.' };
  if (/^-?0\.00$/.test(parsed.data)) return { value: null, warning: 'Valor zero. Informe um valor diferente de zero.' };
  return { value: parsed.data };
}
interface Number_ { negative: boolean; body: string }
function strip(raw: string): Number_ | null {
  let text = raw.replace(/[\s\u00a0\u202f]/g, '').replace(/R\$|BRL/gi, '').replace(/\u2212/g, '-'), negative = false;
  const suffix = /^(.*\d)([DC])$/i.exec(text);
  if (suffix) { text = suffix[1]!; negative = suffix[2]!.toUpperCase() === 'D'; }
  const parenthesis = /^\((.*)\)$/.exec(text); if (parenthesis) { text = parenthesis[1]!; negative = true; }
  if (/^[-+]/.test(text)) { negative = negative !== (text[0] === '-'); text = text.slice(1); }
  else if (text.endsWith('-')) { negative = !negative; text = text.slice(0, -1); }
  return /^\d[\d.,]*$/.test(text) ? { negative, body: text } : null;
}
/** Decimal separator proven by one value: `,`/`.`; `ambiguous` for `1.234`; null when irrelevant. */
export function decimalEvidence(raw: string): Decimal | 'ambiguous' | null {
  const parsed = strip(raw); if (!parsed) return null;
  const dots = parsed.body.split('.').length - 1, commas = parsed.body.split(',').length - 1;
  if (dots && commas) return parsed.body.lastIndexOf(',') > parsed.body.lastIndexOf('.') ? ',' : '.';
  const separator = dots ? '.' : commas ? ',' : null; if (!separator) return null;
  if (dots + commas > 1) return separator === '.' ? ',' : '.';
  const digits = parsed.body.length - parsed.body.indexOf(separator) - 1;
  return digits === 3 ? 'ambiguous' : digits === 1 || digits === 2 ? separator : null;
}
export function inferDecimal(values: string[]) {
  const evidence = new Set(values.map(decimalEvidence));
  const comma = evidence.has(','), dot = evidence.has('.');
  return { decimal: comma === dot ? null : comma ? ',' as const : '.' as const, conflict: comma && dot, ambiguous: evidence.has('ambiguous') };
}
/** Money from text such as `-1.234,56`, `R$ 10,00 D`, `(5.00)` or `10.50-`. */
export function parseAmountText(raw: string, decimal: Decimal | null): ValueResult {
  if (!raw.trim()) return { value: null, warning: 'Valor ausente.' };
  const parsed = strip(raw);
  if (!parsed) return { value: null, warning: `Valor "${raw.trim().slice(0, 40)}" não reconhecido. Use números como -1.234,56.` };
  const body = parsed.body, evidence = decimalEvidence(raw);
  if (evidence === 'ambiguous' && !decimal) return { value: null, warning: `Valor ambíguo "${raw.trim()}": escolha o separador decimal no mapeamento.` };
  const separator = evidence === 'ambiguous' || evidence === null ? decimal : evidence;
  if (evidence !== null && evidence !== 'ambiguous' && decimal && evidence !== decimal) return { value: null, warning: `Valor "${raw.trim()}" diverge do separador decimal "${decimal}" do arquivo.` };
  const thousands = separator === ',' ? '.' : ',';
  const [whole = '', fraction = '', extra] = separator ? body.split(separator) : [body];
  if (extra !== undefined || fraction.length > 2) return { value: null, warning: `Valor "${raw.trim()}" tem mais de duas casas decimais.` };
  if (whole.includes(thousands) && !new RegExp(`^\\d{1,3}(?:\\${thousands}\\d{3})+$`).test(whole) || /[.,]/.test(whole.replaceAll(thousands, ''))) return { value: null, warning: `Separadores de milhar inválidos em "${raw.trim()}".` };
  return exactMoney(parsed.negative, whole.replaceAll(thousands, ''), fraction);
}
/** Spreadsheet numbers keep their shortest round-trip representation; no rounding. */
export function amountFromNumber(value: number): ValueResult {
  const text = String(value), match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return { value: null, warning: `Número ${text} fora do formato monetário.` };
  if ((match[3] ?? '').length > 2) return { value: null, warning: `Valor ${text} tem mais de duas casas decimais; confira a célula.` };
  return exactMoney(match[1] === '-', match[2]!, match[3] ?? '');
}
