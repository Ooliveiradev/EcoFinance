import { formatCents, IMPORT_LIMITS, moneyToCents, type ImportDocumentInfo, type ImportDocumentKind, type ImportOrigin, type ParsedImportRow } from '@ecofinance/shared';
import { parseError } from './import-errors';
import { normalizeHeader } from './import-table';
import { parseAmountText, parseDateText, type ValueResult } from './import-values';
import type { DocumentType } from './import-document-file';

/**
 * Interpretation of positioned text, shared by digital PDFs (text layer) and OCR
 * (scans and photos). The worker only extracts tokens; everything that decides a
 * value happens here, deterministically, so every row carries its page, region,
 * excerpt and the lowest confidence of the words it used.
 */
export interface DocumentToken { text: string; x: number; y: number; width: number; height: number; confidence: number | null }
export interface DocumentPage { number: number; width: number; height: number; method: 'text' | 'ocr' | 'none'; tokens: DocumentToken[]; confidence: number | null; rotation?: number }
export interface DocumentExtraction { type: DocumentType; pages: DocumentPage[]; ocrAvailable: boolean }
export interface DocumentOptions { target: 'account' | 'card' }
export interface DocumentResult { rows: ParsedImportRow[]; warnings: string[]; format: string; document: ImportDocumentInfo }

interface Word { text: string; x: number; y: number; width: number; height: number; confidence: number | null }
interface Line { page: DocumentPage; index: number; words: Word[]; text: string; key: string }
interface Amount { value: string | null; warning?: string; words: Word[]; x: number; right: number; marked: boolean }
interface Columns { amount: number | null; debit: number | null; credit: number | null; balance: number | null; description: number }
interface Draft { line: Line; lines: Line[]; date: ValueResult & { partial?: { day: number; month: number } }; amount: Amount; description: string; used: Word[]; payment: boolean; warnings: string[] }

/** Below this OCR confidence a date or value is never used; between both it is used with a warning. */
export const OCR_REJECT = 60, OCR_WARN = 80;
const months: Record<string, number> = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const amountPattern = /^\(?[-−+]?(?:R\$)?[-−]?\d{1,3}(?:[.,]?\d{3})*[.,]\d{2}\)?-?$/i;
const datePattern = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/;
const summaryPattern = /^(?:saldo|total|subtotal|sub total|valor total|pagamento minimo|limite|transporte|a transportar|resumo)\b/;
const paymentPattern = /^(?:pagamento|pgto|pag )\b(?!.*\b(?:estorno|devolucao)\b)/;

function words(page: DocumentPage): Word[] {
  // Text layers may hold several words per token; positions are split proportionally.
  return page.tokens.flatMap(token => {
    const parts = token.text.split(/(\s+)/), out: Word[] = [];
    let offset = 0;
    for (const part of parts) {
      if (part.trim()) out.push({ text: part, x: token.x + token.width * offset / token.text.length, y: token.y, width: token.width * part.length / token.text.length, height: token.height, confidence: token.confidence });
      offset += part.length;
    }
    return out;
  });
}
/** Words grouped by vertical overlap, then ordered left to right. */
export function documentLines(page: DocumentPage): Line[] {
  const sorted = words(page).sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2) || a.x - b.x), groups: Word[][] = [];
  for (const word of sorted) {
    const last = groups.at(-1), center = word.y + word.height / 2;
    const anchor = last?.[0];
    if (last && anchor && Math.abs(center - (anchor.y + anchor.height / 2)) <= Math.max(anchor.height, word.height) * 0.5) last.push(word);
    else groups.push([word]);
  }
  return groups.map((group, index) => {
    group.sort((a, b) => a.x - b.x);
    const text = group.reduce((out, word, i) => out + (i && word.x - (group[i - 1]!.x + group[i - 1]!.width) > word.height * 1.2 ? '  ' : i ? ' ' : '') + word.text, '');
    return { page, index: index + 1, words: group, text, key: normalizeHeader(text) };
  });
}
const lowest = (used: Word[]) => used.reduce<number | null>((min, word) => word.confidence === null ? min : min === null ? word.confidence : Math.min(min, word.confidence), null);
function legibility(used: Word[], label: string): string | null {
  const confidence = lowest(used);
  if (confidence === null || confidence >= OCR_WARN) return null;
  return confidence < OCR_REJECT ? `${label} ilegível no documento (confiança ${Math.round(confidence)}%); informe o valor correto.` : `${label} com baixa legibilidade (confiança ${Math.round(confidence)}%); confira no documento.`;
}
/** Money with exactly two decimals; `R$`, `-`, `D`/`C` may be separate words. */
function amounts(line: Line): Amount[] {
  const found: Amount[] = [];
  for (let i = 0; i < line.words.length; i++) {
    const word = line.words[i]!;
    if (!amountPattern.test(word.text)) continue;
    const used = [word];
    let raw = word.text;
    // Up to two separate prefixes ("R$ -", "- R$") and a D/C suffix belong to the value.
    for (let back = i - 1; back >= Math.max(0, i - 2); back--) {
      const prefix = line.words[back]!;
      if (/^R\$$/i.test(prefix.text) && !used.some(w => /^R\$$/i.test(w.text))) used.unshift(prefix);
      else if (/^[-−]$/.test(prefix.text) && !raw.startsWith('-')) { used.unshift(prefix); raw = '-' + raw; }
      else break;
    }
    const next = line.words[i + 1];
    if (next && /^[DC]$/.test(next.text)) { used.push(next); raw += next.text; i++; }
    const decimal = /([.,])\d{2}\)?-?[DC]?$/i.exec(raw.replace(/\s/g, ''))?.[1] as ',' | '.';
    // Legibility is judged on the digits; a faint "R$" does not make the value doubtful.
    const parsed = parseAmountText(raw, decimal), unreadable = legibility([word], 'Valor');
    const rejected = unreadable && (word.confidence ?? 100) < OCR_REJECT;
    found.push({ value: rejected ? null : parsed.value, warning: [parsed.warning, unreadable].filter(Boolean).join(' ') || undefined, words: used, x: used[0]!.x, right: word.x + word.width, marked: /^[-−(]|[-)DC]$/i.test(raw) });
  }
  return found;
}
function leadingDate(line: Line): { result: ValueResult & { partial?: { day: number; month: number } }; used: Word[] } | null {
  const [first, second] = line.words;
  if (!first) return null;
  const match = datePattern.exec(first.text);
  let used = [first], result: ValueResult & { partial?: { day: number; month: number } };
  if (match) {
    if (match[3]) result = parseDateText(first.text.replace(/[.-]/g, '/'), 'dmy');
    else result = { value: null, partial: { day: Number(match[1]), month: Number(match[2]) } };
  } else {
    // "05 OUT", "05/OUT" and "05 OUT 2026"
    const glued = /^(\d{1,2})[/.-]?([a-zç]{3})\.?$/i.exec(first.text) ?? (second && /^\d{1,2}$/.test(first.text) ? /^()([a-zç]{3})\.?$/i.exec(second.text) : null);
    if (!glued) return null;
    const day = Number(glued[1] || first.text), month = months[normalizeHeader(glued[2]!).slice(0, 3)];
    if (!month) return null;
    used = glued[1] ? [first] : [first, second!];
    const yearWord = line.words[used.length];
    if (yearWord && /^\d{4}$/.test(yearWord.text)) { used.push(yearWord); result = parseDateText(`${day}/${month}/${yearWord.text}`, 'dmy'); }
    else result = { value: null, partial: { day, month } };
  }
  const unreadable = legibility(used, 'Data');
  if (unreadable && (lowest(used) ?? 100) < OCR_REJECT) return { result: { value: null, warning: unreadable }, used };
  return { result: unreadable ? { ...result, warning: [result.warning, unreadable].filter(Boolean).join(' ') } : result, used };
}
function columnsOf(line: Line): Columns | null {
  const center = (word: Word) => word.x + word.width / 2;
  const find = (pattern: RegExp) => line.words.find(word => pattern.test(normalizeHeader(word.text)));
  const date = find(/^(data|dia|date)$/), description = find(/^(descricao|historico|lancamento|lancamentos|estabelecimento|detalhes|movimentacao)$/);
  const amount = find(/^(valor|valores|amount)$/), debit = find(/^(debito|debitos|saida|saidas)$/), credit = find(/^(credito|creditos|entrada|entradas)$/), balance = find(/^saldo$/);
  if (!date || !description || !(amount || debit || credit) || amounts(line).length) return null;
  return { amount: amount ? center(amount) : null, debit: debit ? center(debit) : null, credit: credit ? center(credit) : null, balance: balance ? center(balance) : null, description: description.x };
}
/** "Página 2 de 3", "Pág. 2/3" or a bare "2/3" line: [page, declared total]. */
function pageMarker(line: Line): [number, number] | null {
  const match = /^(?:pagina|pag|folha) (\d{1,3}) (?:de )?(\d{1,3})$/.exec(line.key) ?? /^\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*$/.exec(line.text);
  return match ? [Number(match[1]), Number(match[2])] : null;
}
function kindOf(text: string, dated: number): ImportDocumentKind {
  const count = (pattern: RegExp) => (text.match(pattern) ?? []).length;
  const receipt = count(/\b(comprovante|recibo|autenticacao|transferencia realizada|pix enviado|pix recebido|pagamento efetuado|cupom fiscal)\b/g);
  const invoice = count(/\b(fatura|cartao de credito|pagamento minimo|limite de credito|limite disponivel|vencimento)\b/g);
  const statement = count(/\b(extrato|saldo anterior|conta corrente|saldo do dia|saldo final|agencia)\b/g);
  if (receipt && dated <= 1) return 'receipt';
  if (!invoice && !statement) return receipt ? 'receipt' : 'unknown';
  return invoice > statement ? 'invoice' : 'statement';
}
const imageLabel: Record<DocumentType, string> = { pdf: 'PDF', png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };
const kindLabel: Record<ImportDocumentKind, string> = { statement: 'extrato', invoice: 'fatura de cartão', receipt: 'comprovante', unknown: 'tipo não identificado' };
function region(used: Word[], page: DocumentPage): ImportOrigin['region'] {
  const x0 = Math.min(...used.map(w => w.x)), y0 = Math.min(...used.map(w => w.y)), x1 = Math.max(...used.map(w => w.x + w.width)), y1 = Math.max(...used.map(w => w.y + w.height));
  const round = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;
  return { x: round(x0 / page.width), y: round(y0 / page.height), width: round((x1 - x0) / page.width), height: round((y1 - y0) / page.height) };
}
function civil(year: number, month: number, day: number) { return parseDateText(`${day}/${month}/${year}`, 'dmy'); }
/** Reference dates for day/month rows: period end, due date, else the latest full date. */
function yearContext(lines: Line[], kind: ImportDocumentKind) {
  const full: string[] = [];
  let period: string | null = null, due: string | null = null;
  for (const line of lines) {
    const dates = [...line.text.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/g)].map(m => parseDateText(m[1]!, 'dmy').value).filter((v): v is string => !!v);
    full.push(...dates);
    if (/\b(periodo|de .* a |ate)\b/.test(line.key) && dates.length >= 2) period ??= dates.sort().at(-1)!;
    if (/\bvencimento\b/.test(line.key) && dates.length) due ??= dates[0]!;
  }
  const reference = kind === 'invoice' ? due ?? period : period ?? due;
  return reference ? { date: reference, source: reference === period ? 'período' : 'vencimento' } : full.length ? { date: full.sort().at(-1)!, source: 'data mais recente do documento' } : null;
}
function receiptRow(lines: Line[], text: string): Draft | null {
  const labelled = (pattern: RegExp) => {
    for (const [i, line] of lines.entries()) {
      const match = pattern.exec(line.key);
      if (!match) continue;
      const rest = line.text.replace(/^[^:]*:\s*/, '');
      if (line.text.includes(':') && rest.trim() && normalizeHeader(rest) !== line.key) return { line, text: rest.trim() };
      const next = lines[i + 1];
      if (next && next.page === line.page) return { line: next, text: next.text.trim() };
    }
    return null;
  };
  const valueAt = labelled(/^(valor|valor pago|valor total|total pago|valor da transferencia|valor do pagamento|valor do pix)\b/);
  const amountLine = valueAt && amounts(valueAt.line).length ? valueAt.line : lines.find(line => amounts(line).length) ?? null;
  const amount = amountLine ? amounts(amountLine)[0] : undefined;
  if (!amount || !amountLine) return null;
  const dateAt = labelled(/^(data|data do pagamento|data da transferencia|data da transacao|data e hora|realizado em|efetuado em)\b/);
  // The labelled field wins; otherwise the first full date anywhere in the receipt.
  const dateText = [dateAt?.text ?? '', ...lines.map(line => line.text)].join('\n').match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/)?.[0] ?? null;
  const date = dateText ? parseDateText(dateText, 'dmy') : { value: null, warning: 'Data do comprovante não encontrada; informe a data.' };
  const payee = labelled(/^(favorecido|destinatario|recebedor|beneficiario|estabelecimento|para|nome do recebedor|empresa|pago a|loja)\b/);
  const description = payee?.text.replace(/\s{2,}.*$/, '') || lines.find(line => !amounts(line).length && line.text.trim().length > 3)?.text.trim() || '';
  const incoming = /\b(recebido|recebimento|voce recebeu|pix recebido)\b/.test(text);
  const magnitude = amount.value?.replace(/^-/, '') ?? null;
  return { line: amountLine, lines: [amountLine, ...(payee && payee.line !== amountLine ? [payee.line] : [])], date, amount: { ...amount, value: magnitude && (incoming ? magnitude : '-' + magnitude) }, description, used: [...amount.words, ...(payee?.line.words ?? [])], payment: false,
    warnings: [incoming ? 'Comprovante de valor recebido: lançado como entrada.' : 'Comprovante de pagamento: lançado como saída.', ...(amount.warning ? [amount.warning] : []), ...(date.warning ? [date.warning] : [])] };
}
export function interpretDocument(extraction: DocumentExtraction, options: DocumentOptions): DocumentResult {
  const pages = extraction.pages, lines = pages.flatMap(documentLines), warnings: string[] = [];
  const read = pages.filter(page => page.method !== 'none'), ocrPages = pages.filter(page => page.method === 'ocr').length;
  const typeLabel = extraction.type === 'pdf' ? (ocrPages === 0 ? 'PDF digital' : ocrPages === pages.length ? 'PDF escaneado (OCR)' : 'PDF misto (texto e OCR)') : `Imagem ${imageLabel[extraction.type]} (OCR)`;
  if (!read.length) parseError('OCR_UNAVAILABLE', extraction.ocrAvailable ? 'Nenhum texto legível foi encontrado. Envie uma digitalização mais nítida ou o PDF original do banco.' : 'O documento não tem camada de texto e o OCR está desativado neste servidor. Envie o PDF original do banco ou exporte OFX/CSV.', typeLabel);
  for (const page of pages) {
    if (page.method === 'none') warnings.push(`Página ${page.number} sem texto: ${extraction.ocrAvailable ? 'nenhuma palavra reconhecida' : 'OCR desativado neste servidor'}. Movimentações dessa página não foram lidas.`);
    else if (!page.tokens.length) warnings.push(`Página ${page.number} sem texto legível. Movimentações dessa página não foram lidas.`);
    if (page.rotation) warnings.push(`Página ${page.number} lida após girar ${page.rotation}°.`);
  }
  // Declared page count ("Página 2 de 3") reveals missing pages.
  const seen = new Set<number>();
  let declared = 0;
  for (const line of lines) {
    const marker = pageMarker(line);
    if (marker) { seen.add(marker[0]); declared = Math.max(declared, marker[1]); }
  }
  if (declared > pages.length) warnings.push(`O documento indica ${declared} páginas, mas o arquivo tem ${pages.length}. Envie as páginas faltantes; os totais podem não conferir.`);
  else for (let n = 1; n <= declared; n++) if (seen.size && !seen.has(n)) { warnings.push(`A numeração de páginas não inclui a página ${n}; confira se alguma página está faltando.`); break; }

  const fullText = lines.map(line => line.key).join('\n');
  const datedLines = lines.filter(line => leadingDate(line) && amounts(line).length).length;
  const kind = kindOf(fullText, datedLines);
  const confidences = read.map(page => page.confidence).filter((c): c is number => c !== null);
  const confidence = confidences.length ? Math.round(Math.min(...confidences)) : null;
  const document: ImportDocumentInfo = { kind, pages: pages.length, ocrPages, textPages: pages.filter(page => page.method === 'text').length, passwordRequired: false, confidence };
  const format = `${typeLabel} · ${kindLabel[kind]}`;
  if (options.target === 'card' && kind === 'statement') warnings.push('O documento parece um extrato de conta, mas o destino é um cartão. Confira o destino antes de confirmar.');
  if (options.target === 'account' && kind === 'invoice') warnings.push('O documento parece uma fatura de cartão, mas o destino é uma conta. Compras da fatura não são pagamentos da conta; confira o destino.');

  const drafts: Draft[] = [], summaries: { key: string; cents: bigint }[] = [];
  let skippedHeaders = 0;
  if (kind === 'receipt') {
    const row = receiptRow(lines, fullText);
    if (row) drafts.push(row);
  } else {
    const middle = (line: Line) => line.words[0]!.y + line.words[0]!.height / 2, pitch = new Map<DocumentPage, number>();
    for (const page of pages) {
      const centers = lines.filter(line => line.page === page).map(middle), gaps = centers.slice(1).map((c, i) => c - centers[i]!).sort((a, b) => a - b);
      pitch.set(page, gaps[Math.floor(gaps.length / 2)] ?? 0);
    }
    let columns: Columns | null = null, headerKey: string | null = null, last: Draft | null = null, previousLine: Line | null = null;
    for (const line of lines) {
      const found = columnsOf(line);
      if (found) {
        if (headerKey === line.key) skippedHeaders++;
        columns = found; headerKey = line.key; continue;
      }
      if (pageMarker(line)) continue;
      const date = leadingDate(line), values = amounts(line);
      const descriptionWords = line.words.filter(word => !date?.used.includes(word) && !values.some(v => v.words.includes(word)));
      const description = descriptionWords.map(word => word.text).join(' ').replace(/\s+/g, ' ').trim(), descriptionKey = normalizeHeader(description);
      if (!date || !values.length || summaryPattern.test(descriptionKey)) {
        if (values.length && summaryPattern.test(descriptionKey)) for (const value of values.slice(-1)) if (value.value) summaries.push({ key: descriptionKey, cents: moneyToCents(value.value) });
        // Continuation of a description wrapped onto the next line, within the table's line pitch.
        const close = previousLine?.page === line.page && middle(line) - middle(previousLine) <= (pitch.get(line.page) ?? 0) * 1.3;
        if (last && !date && !values.length && previousLine === last.lines.at(-1) && close && !summaryPattern.test(line.key) && (!columns || line.words[0]!.x >= columns.description - line.words[0]!.height)) {
          last.description = `${last.description} ${line.text.trim()}`; last.lines.push(line); last.used.push(...line.words.filter(w => w.confidence !== null));
          previousLine = line; continue;
        }
        if (line.key) { last = null; previousLine = line; }
        continue;
      }
      let amount = values[0]!, sign: 'written' | 'debit' | 'credit' = 'written';
      const rowWarnings: string[] = [];
      if (columns && [columns.amount, columns.debit, columns.credit].some(c => c !== null)) {
        const role = (value: Amount) => {
          const center = (value.x + value.right) / 2;
          const options = (['amount', 'debit', 'credit', 'balance'] as const).filter(name => columns![name] !== null);
          return options.sort((a, b) => Math.abs(columns![a]! - center) - Math.abs(columns![b]! - center))[0]!;
        };
        const usable = values.filter(value => role(value) !== 'balance');
        if (!usable.length) { previousLine = line; continue; }
        amount = usable[0]!; const which = role(amount);
        sign = which === 'debit' ? 'debit' : which === 'credit' ? 'credit' : 'written';
        if (usable.length > 1) rowWarnings.push('Linha com mais de um valor fora da coluna de saldo; usado o primeiro. Confira.');
      } else if (values.length > 1) rowWarnings.push('Linha com mais de um valor; usado o primeiro (o último costuma ser o saldo). Confira.');
      if (amount.warning) rowWarnings.push(amount.warning);
      let value = amount.value;
      if (value && sign !== 'written') value = (sign === 'debit' ? '-' : '') + value.replace(/^-/, '');
      const draft: Draft = { line, lines: [line], date: date.result, amount: { ...amount, value }, description, used: [...date.used, ...amount.words, ...descriptionWords], payment: paymentPattern.test(normalizeHeader(description)), warnings: rowWarnings };
      if (date.result.warning) draft.warnings.push(date.result.warning);
      drafts.push(draft); last = draft; previousLine = line;
    }
  }
  if (skippedHeaders) warnings.push(`${skippedHeaders} cabeçalho(s) de tabela repetido(s) entre páginas ignorado(s).`);
  if (!drafts.length && confidence !== null && confidence < OCR_REJECT) parseError('LOW_LEGIBILITY', `O documento está ilegível (confiança do OCR ${confidence}%). Envie uma foto mais nítida, sem sombras e de frente, ou o PDF original do banco. Nada foi importado.`, format);
  if (!drafts.length) parseError('NO_ROWS', `Nenhuma movimentação com data e valor foi encontrada no documento (${pages.length} página(s), ${kindLabel[kind]}). Nada foi importado; confira se é o arquivo certo.`, format);
  if (drafts.length > IMPORT_LIMITS.rows) parseError('ROW_LIMIT', `O documento tem ${drafts.length} movimentações; o limite é ${IMPORT_LIMITS.rows} por lote. Divida o PDF em partes menores (por página) e envie cada parte.`, format);

  // Day/month rows take the year from the period, due date or latest full date.
  const context = yearContext(lines, kind);
  if (drafts.some(d => d.date.partial)) {
    if (context) warnings.push(`Datas sem ano completadas pelo ${context.source} (${context.date.split('-').reverse().join('/')}); confira.`);
    else warnings.push('O documento não informa o ano das datas; preencha a data completa de cada linha.');
  }
  // Signs: card invoices list purchases as positive values; statements are signed as written.
  const signed = drafts.some(d => d.amount.marked) || drafts.some(d => d.amount.value?.startsWith('-'));
  if (kind !== 'invoice' && kind !== 'receipt' && !signed && drafts.length > 1) warnings.push('O documento não indica débito/crédito (sinal, D/C ou colunas). Valores lidos como entradas; corrija o sinal das saídas.');
  const written = drafts.map(d => d.amount.value);
  const rows: ParsedImportRow[] = drafts.map(draft => {
    let purchaseDate = draft.date.value, dateWarning: string | undefined;
    if (draft.date.partial) {
      if (!context) { purchaseDate = null; dateWarning = 'Data sem ano.'; }
      else {
        const [refYear, refMonth] = context.date.split('-').map(Number) as [number, number];
        const year = draft.date.partial.month > refMonth ? refYear - 1 : refYear;
        const parsed = civil(year, draft.date.partial.month, draft.date.partial.day);
        purchaseDate = parsed.value; dateWarning = parsed.warning;
      }
    }
    let amount = draft.amount.value;
    const rowWarnings = [...draft.warnings, ...(dateWarning ? [dateWarning] : [])];
    if (kind === 'invoice' && amount) {
      amount = amount.startsWith('-') ? amount.slice(1) : '-' + amount;
      if (draft.payment) rowWarnings.push('Pagamento de fatura anterior: não é compra nem estorno. Exclua se não for um crédito real.');
    }
    const description = draft.description.slice(0, 500) || null;
    if (!description) rowWarnings.push('Descrição ausente.');
    const used = draft.lines.flatMap(line => line.words), confidence = lowest(draft.used);
    const descriptionWarning = legibility(draft.used.filter(w => !draft.amount.words.includes(w)), 'Texto da linha');
    if (descriptionWarning && !rowWarnings.some(w => w.includes('legib') || w.includes('ilegível'))) rowWarnings.push(descriptionWarning);
    const origin: ImportOrigin = { page: draft.line.page.number, row: draft.line.index, excerpt: draft.lines.map(line => line.text.trim()).join(' ⏎ ').slice(0, 500), region: region(used, draft.line.page) };
    if (confidence !== null) origin.confidence = Math.round(confidence);
    return { amount, purchaseDate, description, externalId: null, provenance: origin, warnings: rowWarnings };
  });
  // Declared totals are checked against what was read, as written in the document.
  const cents = written.map(value => value ? moneyToCents(value) : null);
  const complete = cents.every(value => value !== null);
  const sum = cents.reduce<bigint>((total, value) => total + (value ?? 0n), 0n);
  const noPayments = drafts.reduce<bigint>((total, d, i) => total + (d.payment ? 0n : cents[i] ?? 0n), 0n);
  const abs = (value: bigint) => value < 0n ? -value : value;
  const opening = summaries.find(s => /^saldo anterior\b/.test(s.key)), closing = summaries.find(s => /^saldo (final|atual|em)\b/.test(s.key));
  const totals = summaries.filter(s => /^(total|valor total)\b/.test(s.key) && !/\b(minimo|limite)\b/.test(s.key));
  const checks: { label: string; ok: boolean; declared: bigint }[] = [];
  if (opening && closing && kind !== 'invoice') checks.push({ label: 'saldo final', declared: closing.cents, ok: opening.cents + sum === closing.cents });
  if (totals.length) {
    const declaredTotal = totals[0]!.cents;
    checks.push({ label: 'total', declared: declaredTotal, ok: [sum, noPayments].some(value => abs(value) === abs(declaredTotal)) });
  }
  for (const check of checks.filter(c => !c.ok)) warnings.push(`O ${check.label} declarado (${formatCents(check.declared)}) não confere com o calculado a partir das linhas lidas (${formatCents(check.label === 'saldo final' ? opening!.cents + sum : noPayments)}). Há linha faltante, ilegível ou a mais: revise antes de confirmar.`);
  if (!complete && !checks.length) warnings.push('Há valores ilegíveis; corrija-os na revisão antes de confirmar.');
  return { rows, warnings, format, document };
}
