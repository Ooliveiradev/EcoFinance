import { IMPORT_LIMITS, centsToMoney, formatCents, moneyToCents, type ImportOrigin, type ImportRegion, type ParsedImportRow } from '@ecofinance/shared';
import { parseError } from './import-errors';
import { headerRole, normalizeHeader } from './import-table';
import { inferDateOrder, parseAmountText, parseDateText, type DateOrder } from './import-values';

/**
 * Deterministic reading of PDF text and OCR output (#10). The extraction worker
 * only returns positioned words; this module rebuilds lines and tables, decides
 * the document type and turns transaction lines into the common row contract.
 * Nothing is invented: a value without evidence stays null with a warning.
 */
export interface DocumentWord { text: string; x: number; y: number; width: number; height: number; confidence: number | null }
export interface DocumentPage { page: number; width: number; height: number; method: 'text' | 'ocr'; rotation: number; confidence: number | null; words: DocumentWord[] }
export type DocumentFormat = 'pdf' | 'png' | 'jpeg' | 'webp';
export interface DocumentExtraction { format: DocumentFormat; pages: DocumentPage[]; warnings: string[] }
export type DocumentKind = 'invoice' | 'statement' | 'receipt';
export interface DocumentResult { kind: DocumentKind; format: string; rows: ParsedImportRow[]; warnings: string[] }

interface Line { page: DocumentPage; number: number; words: DocumentWord[]; text: string; key: string; x: number; y: number; width: number; height: number }
type Sign = 'minus' | 'plus' | 'debit' | 'credit' | 'none';
interface Money { words: DocumentWord[]; raw: string; magnitude: string | null; sign: Sign; x: number; confidence: number | null; warning?: string }
type Column = 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'balance';
interface Header { columns: { role: Column; x: number }[] }
interface Transaction { line: Line; lines: Line[]; date: { raw: string; words: DocumentWord[] }; description: DocumentWord[]; money: Money[]; header: Header | null }

/** OCR confidence (0–100) below which a value is unreadable, or must be checked. */
const UNREADABLE = 50, UNCERTAIN = 75, LOW_PAGE = 70;
const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;
const percent = (value: number) => `${Math.round(value)}%`;

/** PDF text runs often hold a whole line; split them into words with proportional positions. */
function splitRuns(words: DocumentWord[]) {
  return words.flatMap(word => {
    const text = word.text.replace(/\s+$/, ''), parts = [...text.matchAll(/\S+/g)];
    if (parts.length <= 1) return parts.length ? [{ ...word, text: parts[0]![0] }] : [];
    const unit = word.width / Math.max(1, text.length);
    return parts.map(part => ({ ...word, text: part[0], x: word.x + part.index * unit, width: part[0].length * unit }));
  });
}
/** Group words into visual lines by vertical overlap, then order them left to right. */
export function documentLines(page: DocumentPage): Line[] {
  const words = splitRuns(page.words).sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x);
  const groups: { center: number; height: number; words: DocumentWord[] }[] = [];
  for (const word of words) {
    const center = word.y + word.height / 2, last = groups.at(-1);
    if (last && Math.abs(center - last.center) <= Math.max(last.height, word.height) * 0.5) {
      last.words.push(word); last.center = (last.center * (last.words.length - 1) + center) / last.words.length; last.height = Math.max(last.height, word.height);
    } else groups.push({ center, height: word.height, words: [word] });
  }
  return groups.map((group, index) => {
    const sorted = group.words.sort((a, b) => a.x - b.x);
    let text = '';
    sorted.forEach((word, i) => {
      const previous = sorted[i - 1];
      const gap = previous ? word.x - (previous.x + previous.width) : 0;
      text += (previous && gap > Math.min(previous.height, word.height) * 0.1 ? ' ' : '') + word.text.trim();
    });
    const x = Math.min(...sorted.map(w => w.x)), y = Math.min(...sorted.map(w => w.y));
    const right = Math.max(...sorted.map(w => w.x + w.width)), bottom = Math.max(...sorted.map(w => w.y + w.height));
    text = text.replace(/\s+/g, ' ').trim();
    return { page, number: index + 1, words: sorted, text, key: fold(text), x, y, width: right - x, height: bottom - y };
  });
}

// Money with exactly two decimals, as printed by Brazilian banks: 1.234,56 · 1234,56 · 1,234.56.
const moneyBody = /^\(?(?:R\$)?\d{1,3}(?:([.,])\d{3})*[.,]\d{2}\)?$|^\(?(?:R\$)?\d+[.,]\d{2}\)?$/i;
function moneyAt(words: DocumentWord[], index: number): { money: Money; next: number } | null {
  const parts: DocumentWord[] = [];
  let i = index, prefix = '';
  if (/^(?:[-−+]|R\$|[-−+]R\$)$/i.test(words[i]!.text.trim()) && words[i + 1]) { prefix = words[i]!.text.trim(); parts.push(words[i]!); i++; }
  let body = words[i]!.text.trim().replace(/^R\$/i, ''), sign: Sign = 'none';
  const lead = /^([-−+])(.*)$/.exec(body); if (lead) { body = lead[2]!; prefix += lead[1]; }
  const tail = /^(.*\d\)?)([-+]|[DC])$/i.exec(body); if (tail) body = tail[1]!;
  if (!moneyBody.test(body)) return null;
  parts.push(words[i]!); i++;
  let suffix = tail?.[2] ?? '';
  if (!suffix && words[i] && /^(?:[DC]|[-+])$/i.test(words[i]!.text.trim())) { suffix = words[i]!.text.trim(); parts.push(words[i]!); i++; }
  if (/[-−]/.test(prefix) || suffix === '-' || /^\(.*\)$/.test(body)) sign = 'minus';
  else if (/\+/.test(prefix) || suffix === '+') sign = 'plus';
  else if (/^d$/i.test(suffix)) sign = 'debit';
  else if (/^c$/i.test(suffix)) sign = 'credit';
  const parsed = parseAmountText(body.replace(/^\(|\)$/g, ''), null);
  const confidences = parts.map(w => w.confidence).filter((c): c is number => c !== null);
  const raw = parts.map(w => w.text.trim()).join(' ');
  return { money: { words: parts, raw, magnitude: parsed.value?.replace(/^-/, '') ?? null, sign, x: parts[0]!.x + (parts.at(-1)!.x + parts.at(-1)!.width - parts[0]!.x) / 2, confidence: confidences.length ? Math.min(...confidences) : null, ...(parsed.warning ? { warning: parsed.warning } : {}) }, next: i };
}
function moneyIn(words: DocumentWord[]) {
  const found: Money[] = [];
  for (let i = 0; i < words.length;) { const match = moneyAt(words, i); if (match) { found.push(match.money); i = match.next; } else i++; }
  return found;
}
const shortDate = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/;
const monthWord = /^(jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec)[a-zç]*\.?$/;
/** Date written at the start of a line: 12/09, 12/09/2026, 2026-09-12 or 12 SET. */
function leadingDate(words: DocumentWord[]): { raw: string; words: DocumentWord[] } | null {
  const first = words[0]?.text.trim() ?? '';
  if (shortDate.test(first) || /^\d{4}-\d{2}-\d{2}$/.test(first)) return { raw: first, words: [words[0]!] };
  if (/^\d{1,2}$/.test(first) && words[1] && monthWord.test(fold(words[1].text.trim()))) {
    const year = words[2] && /^\d{4}$/.test(words[2].text.trim()) ? words[2] : null;
    return { raw: [first, words[1].text.trim(), year?.text.trim()].filter(Boolean).join(' '), words: year ? [words[0]!, words[1], year] : [words[0]!, words[1]] };
  }
  return null;
}
const columnAliases: Record<string, Column> = { saldo: 'balance', 'saldo r': 'balance', 'saldo do dia': 'balance', balance: 'balance' };
function headerOf(line: Line): Header | null {
  const columns: Header['columns'] = [];
  for (let i = 0; i < line.words.length; i++) {
    // Two-word labels first ("Data Lançamento", "Valor (R$)"), then single words.
    const pair = line.words[i + 1] ? line.words[i]!.text + ' ' + line.words[i + 1]!.text : null;
    const role = (pair && (headerRole(pair) ?? columnAliases[normalizeHeader(pair)])) || null;
    const single = headerRole(line.words[i]!.text) ?? columnAliases[normalizeHeader(line.words[i]!.text)] ?? null;
    const used = role ?? single; if (!used) continue;
    const words = role ? [line.words[i]!, line.words[i + 1]!] : [line.words[i]!];
    if (role) i++;
    columns.push({ role: used, x: words[0]!.x + (words.at(-1)!.x + words.at(-1)!.width - words[0]!.x) / 2 });
  }
  const roles = new Set(columns.map(c => c.role));
  return roles.has('date') && (roles.has('amount') || roles.has('debit') || roles.has('credit')) && columns.length >= 3 ? { columns } : null;
}
const invoiceWords = /\bfatura\b|cartao de credito|pagamento minimo|limite (?:total|disponivel|de credito)|melhor dia de compra/;
const receiptWords = /comprovante|recibo|cupom fiscal|nfc-?e|nota fiscal|documento auxiliar|autenticacao|transacao (?:realizada|efetuada)/;
const balanceLine = /^(?:saldo\b|s ?a ?l ?d ?o\b)|\bsaldo (?:anterior|do dia|final|atual|disponivel|em conta|bloqueado|inicial)\b|^(?:sub)?total\b|\btotal (?:da fatura|desta fatura|a pagar|geral|de (?:compras|lancamentos|debitos|creditos|despesas))\b|^valor total\b/;
const paymentLine = /\bpagamento (?:efetuado|recebido|da fatura|fatura|obrigado|por debito)\b|\bpgto\b|\bpag(?:to)? fatura\b|^pagamento$/;
const pageMarker = /\bp(?:a|á)g(?:ina)?\.?\s*(\d{1,3})\s*(?:de|\/)\s*(\d{1,3})\b/i;

function lineMoney(line: Line) { return moneyIn(line.words); }
function region(lines: Line[]): ImportRegion {
  const page = lines[0]!.page, x = Math.min(...lines.map(l => l.x)), y = Math.min(...lines.map(l => l.y));
  const right = Math.max(...lines.map(l => l.x + l.width)), bottom = Math.max(...lines.map(l => l.y + l.height));
  return { x: round(x / page.width), y: round(y / page.height), width: round((right - x) / page.width), height: round((bottom - y) / page.height) };
}
function origin(lines: Line[]): ImportOrigin {
  const page = lines[0]!.page, confidences = lines.flatMap(l => l.words.map(w => w.confidence)).filter((c): c is number => c !== null);
  return { page: page.page, row: lines[0]!.number, excerpt: lines.map(l => l.text).join(' ⏎ ').slice(0, 500), region: region(lines), method: page.method,
    ...(page.method === 'ocr' && confidences.length ? { confidence: Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) } : {}) };
}
function confidenceWarnings(label: string, confidence: number | null): { unreadable: boolean; warning?: string } {
  if (confidence === null || confidence >= UNCERTAIN) return { unreadable: false };
  if (confidence < UNREADABLE) return { unreadable: true, warning: `${label} ilegível na leitura óptica (confiança ${percent(confidence)}); digite conforme o original.` };
  return { unreadable: false, warning: `${label} lido com confiança ${percent(confidence)}; confira com o original.` };
}
/** Reference date for short dates without a year: the due date of an invoice, else the latest full date. */
function referenceDate(lines: Line[], kind: DocumentKind, order: DateOrder) {
  const full = (line: Line) => line.words.flatMap(word => {
    const text = word.text.trim().replace(/[.,;:]$/, '');
    if (!/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(text)) return [];
    const parsed = parseDateText(text, order).value; return parsed ? [{ value: parsed, text }] : [];
  });
  if (kind === 'invoice') for (const [index, line] of lines.entries()) if (/\bvencimento\b|\bvence em\b/.test(line.key)) {
    const found = full(line)[0] ?? (lines[index + 1] ? full(lines[index + 1]!)[0] : undefined);
    if (found) return { ...found, label: 'vencimento' };
  }
  const all = lines.flatMap(full).sort((a, b) => a.value.localeCompare(b.value));
  return all.length ? { ...all.at(-1)!, label: 'data mais recente do documento' } : null;
}
function rowDate(raw: string, order: DateOrder, reference: ReturnType<typeof referenceDate>): { value: string | null; warning?: string } {
  const short = shortDate.exec(raw), named = /^(\d{1,2}) (\S+)$/.exec(raw);
  if (short && !short[3] || named) {
    if (!reference) return { value: null, warning: `Data "${raw}" sem ano e documento sem data de referência; informe a data completa.` };
    const [, a, b] = short ?? [];
    const year = Number(reference.value.slice(0, 4));
    const probe = (y: number) => short ? parseDateText(`${a}/${b}/${y}`, order) : parseDateText(`${raw} ${y}`, order);
    const same = probe(year);
    if (!same.value) return { value: null, warning: same.warning ?? `Data "${raw}" inválida.` };
    // A line after the reference date belongs to the previous year (e.g. December in a January invoice).
    const value = same.value > reference.value ? probe(year - 1).value : same.value;
    if (!value) return { value: null, warning: `Data "${raw}" inexistente no ano anterior ao documento; informe a data.` };
    return { value, warning: `Ano ${value.slice(0, 4)} inferido pela ${reference.label} ${reference.text}; confira a data.` };
  }
  return parseDateText(raw, order);
}
function transactionOf(line: Line, header: Header | null): Transaction | null {
  const date = leadingDate(line.words); if (!date) return null;
  const rest = line.words.slice(date.words.length), money = moneyIn(rest);
  if (!money.length) return null;
  const used = new Set(money.flatMap(m => m.words));
  const description = rest.filter(word => !used.has(word) && word.x < money[0]!.words[0]!.x);
  if (!description.some(word => /\p{L}/u.test(word.text))) return null;
  return { line, lines: [line], date, description, money, header };
}
/** Pick the transaction value: by the header column when the table names one, else the only value. */
function chooseMoney(transaction: Transaction, header: Header | null): { money: Money | null; column: Column | null; warning?: string } {
  if (header) {
    const columnOf = (money: Money) => header.columns.reduce((best, column) => Math.abs(column.x - money.x) < Math.abs(best.x - money.x) ? column : best).role;
    const values = transaction.money.map(money => ({ money, column: columnOf(money) })).filter(entry => ['amount', 'debit', 'credit'].includes(entry.column));
    if (values.length === 1) return { money: values[0]!.money, column: values[0]!.column };
    if (!values.length && transaction.money.length === 1 && columnOf(transaction.money[0]!) !== 'balance') return { money: transaction.money[0]!, column: null };
    if (values.length > 1) return { money: null, column: null, warning: `Linha com mais de um valor nas colunas de movimentação (${values.map(v => v.money.raw).join('; ')}); informe o valor.` };
    return { money: null, column: null, warning: 'Só há valor na coluna de saldo; informe o valor da movimentação.' };
  }
  if (transaction.money.length === 1) return { money: transaction.money[0]!, column: null };
  return { money: null, column: null, warning: `Linha com ${transaction.money.length} valores (${transaction.money.map(m => m.raw).join('; ')}) e sem cabeçalho de colunas; informe o valor da movimentação.` };
}
function signed(magnitude: string, negative: boolean) { return negative ? '-' + magnitude : magnitude; }
function amountOf(choice: ReturnType<typeof chooseMoney>, kind: DocumentKind, unsignedCredits: boolean): { value: string | null; warnings: string[] } {
  const money = choice.money; if (!money) return { value: null, warnings: choice.warning ? [choice.warning] : [] };
  const legibility = confidenceWarnings('Valor', money.confidence), warnings = [money.warning, legibility.warning].filter((w): w is string => !!w);
  if (!money.magnitude || legibility.unreadable) return { value: null, warnings };
  if (choice.column === 'debit') return { value: signed(money.magnitude, true), warnings };
  if (choice.column === 'credit') return { value: money.magnitude, warnings };
  // Invoices list purchases without sign; "-" or "C" marks credits and refunds.
  if (kind === 'invoice') return { value: signed(money.magnitude, !['minus', 'credit'].includes(money.sign)), warnings };
  if (money.sign === 'minus' || money.sign === 'debit') return { value: signed(money.magnitude, true), warnings };
  if (money.sign === 'plus' || money.sign === 'credit' || unsignedCredits) return { value: money.magnitude, warnings };
  return { value: null, warnings: [...warnings, `Sinal de ${money.raw} não identificado: informe valor negativo para saída ou positivo para entrada.`] };
}
function descriptionOf(words: DocumentWord[]): { value: string | null; warnings: string[] } {
  const text = words.map(w => w.text.trim()).join(' ').replace(/\s+/g, ' ').trim();
  const legibility = confidenceWarnings('Descrição', words.length ? Math.min(...words.map(w => w.confidence ?? 100)) : null);
  if (!/\p{L}/u.test(text)) return { value: null, warnings: ['Descrição ausente.'] };
  const warnings = [legibility.warning, text.length > 500 && 'Descrição reduzida a 500 caracteres; confira o original.', /^[=+@]/.test(text) && 'Descrição começa com caractere de fórmula; mantida apenas como texto.'].filter((w): w is string => !!w);
  return { value: text.slice(0, 500), warnings };
}
const sum = (values: string[]) => values.reduce((total, value) => total + moneyToCents(value), 0n);
/** Value printed after a label, on the same line or the next one; patterns in priority order. */
function labelled(lines: Line[], ...patterns: RegExp[]) {
  for (const pattern of patterns) for (const [index, line] of lines.entries()) {
    const match = pattern.exec(line.key); if (!match) continue;
    // Words to the right of the label: "Vencimento 10/10 · Total da fatura R$ 9,90" reads 9,90.
    const start = line.key.slice(0, match.index).split(' ').filter(Boolean).length;
    const money = moneyIn(line.words.slice(start)).at(-1) ?? lineMoney(line).at(-1) ?? (lines[index + 1] ? lineMoney(lines[index + 1]!)[0] : undefined);
    if (money?.magnitude) return { line, money };
  }
  return null;
}
const balanceValue = (money: Money) => signed(money.magnitude!, money.sign === 'minus' || money.sign === 'debit');
function reconcile(kind: DocumentKind, lines: Line[], rows: ParsedImportRow[]): string[] {
  const values = rows.map(r => r.amount);
  if (kind === 'invoice') {
    // Purchases total first: the invoice total may also include previous balance and charges.
    const total = labelled(lines, /\btotal (?:de|dos) (?:compras|lancamentos|despesas)\b/, /\btotal (?:desta fatura|da fatura|a pagar|geral)\b|^valor total\b|^total\b/);
    if (!total) return ['O documento não traz total da fatura legível; confira as linhas com o original.'];
    if (values.some(v => v === null)) return [`Total do documento ${formatCents(moneyToCents(total.money.magnitude!))} não conferido: há linhas sem valor. Corrija-as e compare com o total.`];
    const computed = -sum(values as string[]), expected = moneyToCents(total.money.magnitude!);
    if (computed === expected) return [`Soma das linhas confere com o total do documento (${formatCents(expected)}).`];
    return [`Total do documento ${formatCents(expected)} difere da soma das linhas ${formatCents(computed)} (diferença ${formatCents(expected - computed)}): pode haver saldo anterior, pagamentos, encargos ou linhas não lidas. Revise antes de confirmar.`];
  }
  if (kind === 'statement') {
    const opening = labelled(lines, /\bsaldo anterior\b|\bsaldo inicial\b/), closing = labelled(lines, /\bsaldo (?:final|atual|em \d)/);
    if (!opening || !closing) return [];
    if (values.some(v => v === null)) return ['Saldos anterior e final não conferidos: há linhas sem valor.'];
    const expected = moneyToCents(balanceValue(closing.money)) - moneyToCents(balanceValue(opening.money)), computed = sum(values as string[]);
    if (computed === expected) return [`Saldo anterior + movimentações confere com o saldo final (${formatCents(moneyToCents(balanceValue(closing.money)))}).`];
    return [`Saldo anterior + movimentações (${formatCents(moneyToCents(balanceValue(opening.money)) + computed)}) difere do saldo final ${formatCents(moneyToCents(balanceValue(closing.money)))}: confira linhas ausentes ou ilegíveis.`];
  }
  return [];
}
function receiptRow(lines: Line[], order: DateOrder): ParsedImportRow | null {
  const total = labelled(lines, /\bvalor (?:total|pago|da compra|do pagamento|da transferencia|transferido|do pix|cobrado)\b|\btotal a pagar\b/, /^total\b|^valor\b/);
  const dated = lines.flatMap(line => line.words.flatMap(word => {
    const text = word.text.trim().replace(/[.,;:]$/, '');
    if (!/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^\d{4}-\d{2}-\d{2}$/.test(text)) return [];
    const parsed = parseDateText(text, order); return [{ line, word, parsed }];
  }));
  const date = dated.find(d => d.parsed.value) ?? dated[0];
  if (!total && !date) return null;
  const named = lines.find(line => /\b(?:favorecido|destinatario|recebedor|beneficiario|estabelecimento|para)\b\s*:?/.test(line.key) && !lineMoney(line).length);
  const fallback = lines.find(line => /\p{L}{3}/u.test(line.text) && !receiptWords.test(line.key) && !/\b(?:cnpj|cpf|data|hora|valor|total|autenticacao|agencia|conta|banco|id|pix|ted|doc|transferencia|pagamento|enviad[oa]|recebid[oa]|realizad[oa]|efetuad[oa])\b/.test(line.key));
  const source = named ?? fallback;
  const description = source ? descriptionOf(source.words.filter(w => !/^(?:favorecido|destinat[aá]rio|recebedor|benefici[aá]rio|estabelecimento|para):?$/i.test(w.text.trim()))) : { value: null, warnings: ['Descrição não encontrada no comprovante.'] };
  const incoming = lines.some(line => /\b(?:pix recebido|transferencia recebida|deposito recebido|credito em conta|recebimento)\b/.test(line.key));
  const legibility = total ? confidenceWarnings('Valor', total.money.confidence) : { unreadable: false };
  const amount = total?.money.magnitude && !legibility.unreadable ? signed(total.money.magnitude, !incoming) : null;
  const dateLegibility = date ? confidenceWarnings('Data', date.word.confidence) : { unreadable: false };
  const evidence = [total?.line, date?.line, source].filter((l): l is Line => !!l).filter((l, i, all) => all.indexOf(l) === i).sort((a, b) => a.page.page - b.page.page || a.number - b.number);
  return {
    amount, purchaseDate: dateLegibility.unreadable ? null : date?.parsed.value ?? null, description: description.value, externalId: null, provenance: origin(evidence),
    warnings: [
      total ? null : 'Valor total não encontrado no comprovante; informe o valor.', date ? date.parsed.warning : 'Data não encontrada no comprovante; informe a data.',
      legibility.warning, dateLegibility.warning, ...description.warnings,
      amount && (incoming ? 'Comprovante de recebimento tratado como entrada; confira o sinal.' : 'Comprovante tratado como saída (pagamento ou compra); altere o sinal se for recebimento.'),
      'Comprovante gera um único lançamento pelo valor total; itens do cupom não viram lançamentos separados.',
    ].filter((w): w is string => !!w),
  };
}
const formatLabels: Record<DocumentFormat, string> = { pdf: 'PDF', png: 'Imagem PNG', jpeg: 'Imagem JPEG', webp: 'Imagem WebP' };
const kindLabels: Record<DocumentKind, string> = { invoice: 'fatura de cartão', statement: 'extrato', receipt: 'comprovante' };
function formatOf(extraction: DocumentExtraction, kind: DocumentKind) {
  const methods = new Set(extraction.pages.map(p => p.method));
  const base = extraction.format !== 'pdf' ? `${formatLabels[extraction.format]} (OCR)` : methods.size > 1 ? 'PDF misto (texto e OCR)' : methods.has('ocr') ? 'PDF escaneado (OCR)' : 'PDF digital';
  return `${base} · ${kindLabels[kind]}`;
}

export function interpretDocument(extraction: DocumentExtraction): DocumentResult {
  const pages = extraction.pages, lines = pages.flatMap(documentLines);
  const text = lines.map(l => l.key).join('\n'), warnings = [...extraction.warnings];
  for (const page of pages) {
    if (page.rotation) warnings.push(`Página ${page.page} lida girada ${page.rotation}°.`);
    if (page.method === 'ocr' && page.confidence !== null && page.confidence < LOW_PAGE) warnings.push(`Página ${page.page} lida por OCR com baixa legibilidade (confiança ${percent(page.confidence)}); confira valores e datas com o original.`);
    if (page.method === 'ocr' && !page.words.length) warnings.push(`Página ${page.page} sem texto legível.`);
  }
  const declared = Math.max(0, ...lines.map(l => Number(pageMarker.exec(l.text)?.[2] ?? 0)));
  if (declared && declared !== pages.length) warnings.push(`O documento indica ${declared} página(s), mas o arquivo tem ${pages.length}. Confira se falta alguma página.`);
  const ocrConfidence = pages.filter(p => p.method === 'ocr' && p.confidence !== null).map(p => p.confidence!);
  const unreadable = ocrConfidence.length > 0 && ocrConfidence.reduce((a, b) => a + b, 0) / ocrConfidence.length < 40;

  // A header applies until the next one; a repeated header is the table continuing on another page.
  let header: Header | null = null, headers = 0;
  const transactions: Transaction[] = [], skipped: { reason: 'balance' | 'payment'; line: Line }[] = [];
  const invoice = invoiceWords.test(text);
  for (const line of lines) {
    const found = headerOf(line); if (found) { header = found; headers++; continue; }
    const transaction = transactionOf(line, header);
    if (transaction) {
      const description = fold(transaction.description.map(w => w.text).join(' '));
      if (balanceLine.test(description)) { skipped.push({ reason: 'balance', line }); continue; }
      if (invoice && paymentLine.test(description)) { skipped.push({ reason: 'payment', line }); continue; }
      transactions.push(transaction);
      continue;
    }
    // A wrapped description continues right below its transaction, without date or value.
    const previous = transactions.at(-1), last = previous?.lines.at(-1);
    if (previous && last && last.page === line.page && line.number === last.number + 1 && !lineMoney(line).length && /\p{L}/u.test(line.text)
      && line.y - (last.y + last.height) < last.height * 1.5 && Math.abs(line.x - previous.description[0]!.x) <= last.height && line.text.length <= 80
      && !balanceLine.test(line.key) && !paymentLine.test(line.key) && !pageMarker.test(line.text) && !headerOf(line)) {
      previous.lines.push(line); previous.description.push(...line.words);
    }
  }
  const kind: DocumentKind = transactions.length ? (invoice ? 'invoice' : 'statement') : 'receipt';
  const dateTexts = [...transactions.map(t => t.date.raw), ...lines.flatMap(l => l.words.map(w => w.text.trim()).filter(t => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(t)))];
  const evidence = inferDateOrder(dateTexts.map(raw => shortDate.test(raw) && !shortDate.exec(raw)![3] ? raw + '/2000' : raw));
  const order: DateOrder = evidence.order ?? 'dmy';
  if (!evidence.order && evidence.ambiguous) warnings.push('Datas lidas como DD/MM, padrão de documentos brasileiros; confira dia e mês.');
  if (evidence.conflict) warnings.push('O documento mistura datas DD/MM e MM/DD; confira cada data.');

  if (kind === 'receipt') {
    const row = /\p{L}/u.test(text) ? receiptRow(lines, order) : null;
    if (!row) {
      if (unreadable) parseError('LOW_QUALITY', 'Documento ilegível na leitura óptica. Envie uma foto nítida, bem iluminada e sem cortes, ou um PDF digital.', formatOf(extraction, kind));
      parseError('NO_ROWS', 'Nenhuma movimentação com data e valor foi encontrada no documento. Confira se é extrato, fatura ou comprovante e se as páginas estão completas.', formatOf(extraction, kind));
    }
    return { kind, format: formatOf(extraction, kind), rows: [row], warnings };
  }
  if (transactions.length > IMPORT_LIMITS.rows) parseError('ROW_LIMIT', `Documento com ${transactions.length} movimentações; divida em até ${IMPORT_LIMITS.rows} por arquivo (por exemplo, menos páginas).`, formatOf(extraction, kind));
  const reference = referenceDate(lines, kind, order);
  const unsignedCredits = kind === 'statement' && transactions.some(t => t.money.some(m => m.sign === 'minus' || m.sign === 'debit'));
  if (unsignedCredits && transactions.some(t => t.money.some(m => m.sign === 'none'))) warnings.push('Valores sem sinal tratados como entradas, pois o extrato marca as saídas com sinal negativo ou D.');
  const rows = transactions.map((transaction): ParsedImportRow => {
    const choice = chooseMoney(transaction, transaction.header);
    const amount = amountOf(choice, kind, unsignedCredits), description = descriptionOf(transaction.description);
    const dateConfidence = confidenceWarnings('Data', Math.min(...transaction.date.words.map(w => w.confidence ?? 100)));
    const date = dateConfidence.unreadable ? { value: null } : rowDate(transaction.date.raw, order, reference);
    const installment = /\b(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i.exec(description.value ?? '');
    return { amount: amount.value, purchaseDate: date.value, description: description.value, externalId: null, provenance: origin(transaction.lines),
      warnings: [date.warning, dateConfidence.warning, ...amount.warnings, ...description.warnings,
        kind === 'invoice' && installment && Number(installment[1]) <= Number(installment[2]) && `Parcela ${installment[1]}/${installment[2]} identificada na descrição; a competência segue a data da linha.`,
        extraction.format !== 'pdf' || transaction.line.page.method === 'ocr' ? 'Lido por OCR: confira valor, data e descrição com o original.' : null,
      ].filter((w): w is string => !!w) };
  });
  const balances = skipped.filter(s => s.reason === 'balance'), payments = skipped.filter(s => s.reason === 'payment');
  if (headers > 1) warnings.push(`Cabeçalho da tabela repetido ${headers} vezes (uma por página) e mantido fora das movimentações.`);
  if (balances.length) warnings.push(`${balances.length} linha(s) de saldo, total ou subtotal ficaram fora da revisão: ${balances.slice(0, 5).map(s => `“${s.line.text.slice(0, 60)}” (pág. ${s.line.page.page})`).join('; ')}.`);
  if (payments.length) warnings.push(`${payments.length} pagamento(s) de fatura ficaram fora da revisão; registre o pagamento pelo fluxo de cartões: ${payments.slice(0, 5).map(s => `“${s.line.text.slice(0, 60)}”`).join('; ')}.`);
  warnings.push(...reconcile(kind, lines, rows));
  return { kind, format: formatOf(extraction, kind), rows, warnings };
}
/** Exact total of rows with a value, for tests and summaries. */
export const documentTotal = (rows: ParsedImportRow[]) => centsToMoney(sum(rows.flatMap(r => r.amount ? [r.amount] : [])));
