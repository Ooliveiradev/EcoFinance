import { describe, expect, it } from 'vitest';
import { documentLines, interpretDocument, OCR_REJECT, type DocumentPage, type DocumentToken } from './import-document';
import { ImportParseError } from './import-errors';

type Cell = [x: number, text: string, confidence?: number];
/** Page from rows of cells; each row sits 20 units below the previous one. */
function page(rows: (Cell[] | null)[], options: Partial<DocumentPage> = {}, ocr = false): DocumentPage {
  const tokens: DocumentToken[] = rows.flatMap((row, i) => (row ?? []).map(([x, text, confidence]) => ({ text, x, y: 40 + i * 20, width: text.length * 5, height: 10, confidence: confidence ?? (ocr ? 95 : null) })));
  return { number: 1, width: 600, height: 800, method: ocr ? 'ocr' : 'text', tokens, confidence: ocr ? 90 : null, ...options };
}
const pdf = (...pages: DocumentPage[]) => ({ type: 'pdf' as const, pages: pages.map((p, i) => ({ ...p, number: i + 1 })), ocrAvailable: true });
const run = (pages: DocumentPage[], target: 'account' | 'card' = 'account') => interpretDocument(pdf(...pages), { target });
function failure(fn: () => unknown) {
  try { fn(); } catch (error) { if (error instanceof ImportParseError) return error; throw error; }
  throw new Error('expected diagnostic');
}
const rows = (result: ReturnType<typeof run>) => result.rows.map(row => [row.amount, row.purchaseDate, row.description]);
const statementHead: (Cell[] | null)[] = [[[40, 'Extrato de conta corrente']], [[40, 'Período: 01/12/2025 a 31/01/2026']]];

describe('document lines', () => {
  it('groups words by vertical overlap, orders them and splits multi-word tokens', () => {
    const lines = documentLines({ number: 1, width: 600, height: 800, method: 'text', confidence: null, tokens: [
      { text: 'Valor', x: 300, y: 41, width: 25, height: 10, confidence: null }, { text: 'Data Descrição', x: 40, y: 40, width: 70, height: 10, confidence: null },
      { text: 'Rodapé', x: 40, y: 700, width: 30, height: 10, confidence: null }, { text: '   ', x: 0, y: 0, width: 5, height: 10, confidence: null }] });
    expect(lines.map(line => line.text)).toEqual(['Data Descrição  Valor', 'Rodapé']);
    expect(lines[0]!.words.map(word => Math.round(word.x))).toEqual([40, 65, 300]);
  });
});
describe('statements', () => {
  it('reads signed values, debit/credit and balance columns, D/C marks and wrapped descriptions', () => {
    const result = run([page([...statementHead,
      [[40, 'Data'], [100, 'Histórico'], [300, 'Débito'], [380, 'Crédito'], [460, 'Saldo']],
      [[40, '30/12'], [100, 'Mercado'], [300, '10,00'], [460, '90,00']],
      [[100, 'Filial Centro']],
      [[40, '02/01'], [100, 'Depósito'], [380, '50,00'], [460, '140,00']],
      [[40, '03/01'], [100, 'Pagamento'], [300, '1.000,00'], [380, '5,00']],
      [[40, '04/01'], [100, 'SALDO DO DIA'], [460, '140,00']],
    ])]);
    expect(rows(result)).toEqual([['-10.00', '2025-12-30', 'Mercado Filial Centro'], ['50.00', '2026-01-02', 'Depósito'], ['-1000.00', '2026-01-03', 'Pagamento']]);
    expect(result.rows[2]!.warnings.join(' ')).toContain('mais de um valor fora da coluna de saldo');
    expect(result.rows[0]!.provenance).toMatchObject({ page: 1, row: 4, excerpt: '30/12  Mercado  10,00  90,00 ⏎ Filial Centro' });
    expect(result.warnings.join(' ')).toContain('pelo período (31/01/2026)');
  });
  it('accepts separated signs and currency, D/C suffixes, textual months and full dates', () => {
    const result = run([page([...statementHead,
      [[40, '05/01/2026'], [100, 'Taxa'], [300, 'R$'], [320, '-'], [330, '3,00']],
      [[40, '06'], [55, 'JAN'], [100, 'Compra'], [300, '-'], [310, '4,50']],
      [[40, '07/jan'], [100, 'Venda'], [300, '8,00'], [340, 'C']],
      [[40, '08'], [55, 'jan'], [75, '2026'], [100, 'Juros'], [300, '1,00'], [340, 'D']],
      [[40, '09'], [55, 'xyz'], [100, 'Ignorada'], [300, '1,00']],
    ])]);
    expect(rows(result)).toEqual([['-3.00', '2026-01-05', 'Taxa'], ['-4.50', '2026-01-06', 'Compra'], ['8.00', '2026-01-07', 'Venda'], ['-1.00', '2026-01-08', 'Juros']]);
  });
  it('warns on several values without columns, unsigned statements and invalid separators', () => {
    const result = run([page([...statementHead,
      [[40, '05/01'], [100, 'Loja'], [300, '3,00'], [400, '97,00']],
      [[40, '06/01'], [100, 'Outra'], [300, '1,234,56']],
    ])]);
    expect(result.rows[0]!.warnings.join(' ')).toContain('o último costuma ser o saldo');
    expect(result.rows[1]!.amount).toBeNull();
    expect(result.warnings.join(' ')).toContain('não indica débito/crédito');
  });
  it('checks opening and closing balances and declared totals', () => {
    const result = run([page([...statementHead,
      [[40, 'Saldo anterior'], [300, '100,00']],
      [[40, '05/01'], [100, 'Loja'], [300, '-30,00']],
      [[40, 'Saldo final'], [300, '80,00']],
      [[40, 'Total'], [300, '-30,00']],
    ])]);
    expect(result.warnings.join(' ')).toMatch(/saldo final declarado .*80,00.* não confere .*70,00/);
    expect(result.warnings.join(' ')).not.toContain('O total declarado');
  });
  it('fills years from the latest full date and leaves dates empty without any year', () => {
    const latest = run([page([[[40, 'Extrato emitido em 15/02/2026']], [[40, '20/12'], [100, 'Loja'], [300, '-1,00']], [[40, '31/02'], [100, 'Errada'], [300, '-1,00']]])]);
    expect(latest.rows.map(row => row.purchaseDate)).toEqual(['2025-12-20', null]);
    expect(latest.warnings.join(' ')).toContain('data mais recente do documento');
    const none = run([page([[[40, 'Extrato']], [[40, '20/12'], [100, 'Loja'], [300, '-1,00']]])]);
    expect(none.rows[0]!.purchaseDate).toBeNull(); expect(none.rows[0]!.warnings).toContain('Data sem ano.');
    expect(none.warnings.join(' ')).toContain('não informa o ano');
  });
  it('reports missing pages, page gaps, unreadable pages, rotation and the destination mismatch', () => {
    const body = (marker: string) => page([...statementHead, [[40, '05/01'], [100, 'Loja'], [300, '-1,00']], [[400, marker]]]);
    const missing = run([body('Página 1 de 4'), body('Página 2 de 4')], 'card');
    expect(missing.warnings.join(' ')).toContain('indica 4 páginas, mas o arquivo tem 2');
    expect(missing.warnings.join(' ')).toContain('destino é um cartão');
    const gap = run([body('1/3'), { ...body('3/3'), rotation: 180 }, { ...page([]), method: 'none' }]);
    expect(gap.warnings.join(' ')).toContain('não inclui a página 2');
    expect(gap.warnings.join(' ')).toContain('Página 2 lida após girar 180°');
    expect(gap.warnings.join(' ')).toContain('Página 3 sem texto: nenhuma palavra reconhecida');
    const empty = run([body('x'), { ...page([], {}, true), tokens: [] }]);
    expect(empty.warnings.join(' ')).toContain('Página 2 sem texto legível');
    expect(empty.format).toBe('PDF misto (texto e OCR) · extrato');
  });
});
describe('OCR legibility', () => {
  it('rejects values and dates below the threshold and warns between thresholds', () => {
    const result = run([page([...statementHead,
      [[40, '05/01', 99], [100, 'Loja', 99], [300, '-3,00', OCR_REJECT - 1]],
      [[40, '06/01', OCR_REJECT - 5], [100, 'Feira', 99], [300, '-4,00', 99]],
      [[40, '07/01', 99], [100, 'Café', 70], [300, '-5,00', 75]],
    ], {}, true)]);
    expect(rows(result)).toEqual([[null, '2026-01-05', 'Loja'], ['-4.00', null, 'Feira'], ['-5.00', '2026-01-07', 'Café']]);
    expect(result.rows[0]!.warnings.join(' ')).toContain('Valor ilegível no documento (confiança 59%)');
    expect(result.rows[1]!.warnings.join(' ')).toContain('Data ilegível');
    expect(result.rows[2]!.warnings.join(' ')).toContain('Valor com baixa legibilidade (confiança 75%)');
    expect(result.rows[2]!.provenance.confidence).toBe(70);
    expect(result.warnings.join(' ')).toContain('Há valores ilegíveis');
    expect(result.document).toMatchObject({ ocrPages: 1, textPages: 0, confidence: 90 });
  });
  it('flags low-confidence descriptions and dates that are only doubtful', () => {
    const result = run([page([...statementHead, [[40, '05/01', 75], [100, 'Lojinha', 65], [300, '-3,00', 99]]], {}, true)]);
    expect(result.rows[0]!.warnings.join(' ')).toContain('Data com baixa legibilidade');
    const text = run([page([...statementHead, [[40, '05/01', 99], [100, 'Lojinha', 65], [300, '-3,00', 99]]], {}, true)]);
    expect(text.rows[0]!.warnings.join(' ')).toContain('Texto da linha com baixa legibilidade (confiança 65%)');
  });
  it('fails as illegible when nothing is read from a low-confidence scan', () => {
    const error = failure(() => run([{ ...page([[[40, 'xx', 20]]], {}, true), confidence: 30 }]));
    expect(error.code).toBe('LOW_LEGIBILITY'); expect(error.message).toContain('30%');
  });
});
describe('card invoices', () => {
  it('turns purchases into expenses, credits into refunds and flags invoice payments', () => {
    const result = run([page([[[40, 'Fatura do cartão de crédito']], [[40, 'Vencimento: 10/01/2026']],
      [[40, 'Data'], [100, 'Lançamento'], [300, 'Valor']],
      [[40, '28/12'], [100, 'Pagamento recebido'], [300, '-500,00']],
      [[40, '29/12'], [100, 'Livraria'], [300, '40,00']],
      [[40, '30/12'], [100, 'Estorno Livraria'], [300, '-10,00']],
      [[40, '02/01'], [100, 'Mercado'], [300, '20,00']],
      [[100, 'Total da fatura'], [300, '50,00']],
    ])], 'account');
    expect(rows(result)).toEqual([['500.00', '2025-12-28', 'Pagamento recebido'], ['-40.00', '2025-12-29', 'Livraria'], ['10.00', '2025-12-30', 'Estorno Livraria'], ['-20.00', '2026-01-02', 'Mercado']]);
    expect(result.rows[0]!.warnings.join(' ')).toContain('Pagamento de fatura anterior');
    expect(result.warnings.join(' ')).toContain('destino é uma conta');
    expect(result.warnings.join(' ')).not.toContain('não confere');
    expect(result.document.kind).toBe('invoice'); expect(result.format).toBe('PDF digital · fatura de cartão');
  });
});
describe('receipts', () => {
  it('reads labelled values on the same or the next line and incoming transfers', () => {
    const paid = run([page([[[40, 'Comprovante de pagamento']], [[40, 'Data:'], [80, '03/01/2026']], [[40, 'Valor:'], [80, 'R$'], [100, '42,10']], [[40, 'Favorecido:'], [120, 'Loja Modelo']]])]);
    expect(rows(paid)).toEqual([['-42.10', '2026-01-03', 'Loja Modelo']]);
    expect(paid.rows[0]!.warnings).toContain('Comprovante de pagamento: lançado como saída.');
    const received = run([page([[[40, 'Comprovante Pix recebido']], [[40, 'Valor']], [[40, '10,00']], [[40, 'Recebedor']], [[40, 'Fulano Fictício']], [[40, 'Realizado em 04/01/2026']]])]);
    expect(rows(received)).toEqual([['10.00', '2026-01-04', 'Fulano Fictício']]);
    const undated = run([page([[[40, 'Recibo']], [[40, 'Serviço de limpeza']], [[300, '15,00']]])]);
    expect(rows(undated)).toEqual([['-15.00', null, 'Recibo']]);
    expect(undated.rows[0]!.warnings).toContain('Data do comprovante não encontrada; informe a data.');
  });
  it('fails when a receipt has no value', () => {
    expect(failure(() => run([page([[[40, 'Comprovante']], [[40, 'Sem valor']]])])).code).toBe('NO_ROWS');
  });
});
describe('limits and empty documents', () => {
  it('requires text, rows and at most the row limit', () => {
    expect(failure(() => interpretDocument({ type: 'pdf', pages: [{ ...page([]), method: 'none' }], ocrAvailable: false }, { target: 'account' })).message).toContain('OCR está desativado');
    expect(failure(() => interpretDocument({ type: 'png', pages: [{ ...page([]), method: 'none' }], ocrAvailable: true }, { target: 'account' })).message).toContain('Nenhum texto legível');
    expect(failure(() => run([page([[[40, 'Comunicado']]])])).code).toBe('NO_ROWS');
    const many = Array.from({ length: 61 }, (_, i): Cell[] => [[40, '05/01/2026'], [100, 'Linha ' + i], [300, '-1,00']]);
    expect(failure(() => run([page(many, { height: 2000 })])).code).toBe('ROW_LIMIT');
  });
  it('labels images, keeps descriptions bounded and reports missing descriptions', () => {
    const result = interpretDocument({ type: 'webp', pages: [page([[[40, 'Extrato 01/01/2026']], [[40, '05/01'], [300, '-1,00']]], {}, true)], ocrAvailable: true }, { target: 'account' });
    expect(result.format).toBe('Imagem WebP (OCR) · extrato');
    expect(result.rows[0]!.description).toBeNull(); expect(result.rows[0]!.warnings).toContain('Descrição ausente.');
  });
});
