import { describe, expect, it } from 'vitest';
import { IMPORT_LIMITS } from '@ecofinance/shared';
import { ImportParseError } from './import-errors';
import { documentLines, documentTotal, interpretDocument, type DocumentPage, type DocumentWord } from './import-document-layout';

/** Words laid out on a 600×800 page: each row is [x, text] pairs, optionally with OCR confidence. */
type Spec = [x: number, text: string, confidence?: number][];
function page(rows: Spec[], patch: Partial<DocumentPage> = {}): DocumentPage {
  const words: DocumentWord[] = rows.flatMap((row, index) => row.map(([x, text, confidence]) => ({ text, x, y: 40 + index * 20, width: text.length * 6, height: 10, confidence: confidence ?? (patch.method === 'ocr' ? 96 : null) })));
  return { page: 1, width: 600, height: 800, method: 'text', rotation: 0, confidence: null, words, ...patch };
}
const read = (...pages: DocumentPage[]) => interpretDocument({ format: 'pdf', pages: pages.map((p, i) => ({ ...p, page: i + 1 })), warnings: [] });
const values = (result: ReturnType<typeof read>) => result.rows.map(row => [row.amount, row.purchaseDate, row.description]);
const warnings = (result: ReturnType<typeof read>) => [...result.warnings, ...result.rows.flatMap(row => row.warnings)].join(' | ').replace(/\s/g, ' ');
function failure(run: () => unknown) {
  try { run(); } catch (cause) { if (cause instanceof ImportParseError) return cause; throw cause; }
  throw new Error('expected an import diagnostic');
}
const extrato: Spec = [[10, 'EXTRATO'], [80, 'Emitido'], [140, 'em'], [170, '31/10/2026']];

describe('document lines', () => {
  it('groups words by vertical overlap, orders them and splits PDF text runs', () => {
    const lines = documentLines({ ...page([]), words: [
      { text: 'B', x: 50, y: 41, width: 6, height: 10, confidence: null }, { text: 'A', x: 10, y: 40, width: 6, height: 10, confidence: null },
      { text: '01/10 PIX 10,00', x: 10, y: 80, width: 90, height: 10, confidence: null },
    ] });
    expect(lines.map(line => line.text)).toEqual(['A B', '01/10 PIX 10,00']);
    expect(lines[1]!.words.map(word => [word.text, word.x])).toEqual([['01/10', 10], ['PIX', 46], ['10,00', 70]]);
  });
});
describe('document interpretation', () => {
  it('keeps the sign of unsigned statement values pending instead of guessing', () => {
    const result = read(page([extrato, [[10, '05/10'], [80, 'DEPOSITO'], [400, '100,00']], [[10, '06/10'], [80, 'TARIFA'], [400, '9,90']]]));
    expect(values(result)).toEqual([[null, '2026-10-05', 'DEPOSITO'], [null, '2026-10-06', 'TARIFA']]);
    expect(warnings(result)).toContain('Sinal de 100,00 não identificado');
    expect(warnings(result)).toContain('Ano 2026 inferido pela data mais recente do documento 31/10/2026');
  });
  it('reads D/C suffixes, parentheses and explicit signs', () => {
    const result = read(page([extrato, [[10, '01/10'], [80, 'COMPRA'], [400, '100,00'], [440, 'D']], [[10, '02/10'], [80, 'TED'], [400, '50,00C']], [[10, '03/10'], [80, 'ESTORNO'], [400, '(5,00)']], [[10, '04/10'], [80, 'AJUSTE'], [390, '+'], [400, '1,00']], [[10, '05/10'], [80, 'TARIFA'], [400, '2,50-']]]));
    expect(values(result).map(v => v[0])).toEqual(['-100.00', '50.00', '-5.00', '1.00', '-2.50']);
    expect(documentTotal(result.rows)).toBe('-56.50');
  });
  it('treats unsigned values as credits only when the statement marks debits, and says so', () => {
    const result = read(page([extrato, [[10, '01/10'], [80, 'PIX'], [400, '-10,00']], [[10, '02/10'], [80, 'SALARIO'], [400, '1.000,00']]]));
    expect(values(result).map(v => v[0])).toEqual(['-10.00', '1000.00']);
    expect(warnings(result)).toContain('Valores sem sinal tratados como entradas');
  });
  it('chooses the value by header column, by debit/credit columns, and refuses lines with two unlabeled values', () => {
    const header: Spec = [[10, 'Data'], [80, 'Histórico'], [300, 'Débito'], [400, 'Crédito'], [500, 'Saldo']];
    const columns = read(page([extrato, header, [[10, '01/10'], [80, 'MERCADO'], [300, '20,00'], [500, '80,00']], [[10, '02/10'], [80, 'PIX'], [400, '30,00'], [500, '110,00']], [[10, '03/10'], [80, 'AJUSTE'], [500, '110,00']], [[10, '04/10'], [80, 'DUPLO'], [300, '1,00'], [400, '2,00']]]));
    expect(values(columns).map(v => v[0])).toEqual(['-20.00', '30.00', null, null]);
    expect(warnings(columns)).toContain('Só há valor na coluna de saldo');
    expect(warnings(columns)).toContain('Linha com mais de um valor nas colunas de movimentação (1,00; 2,00)');
    const bare = read(page([extrato, [[10, '01/10'], [80, 'MERCADO'], [300, '-20,00'], [500, '80,00']]]));
    expect(values(bare)[0]![0]).toBeNull(); expect(warnings(bare)).toContain('Linha com 2 valores (-20,00; 80,00) e sem cabeçalho');
  });
  it('flags uncertain OCR and leaves unreadable values empty', () => {
    const result = read(page([extrato, [[10, '01/10'], [80, 'MERCADO'], [400, '-12,30', 40]], [[10, '02/10', 60], [80, 'PADARIA', 62], [400, '-4,50', 65]], [[10, '03/10', 30], [80, 'POSTO'], [400, '-9,00']]], { method: 'ocr', confidence: 55 }));
    expect(values(result)).toEqual([[null, '2026-10-01', 'MERCADO'], ['-4.50', '2026-10-02', 'PADARIA'], ['-9.00', null, 'POSTO']]);
    const text = warnings(result);
    for (const expected of ['Valor ilegível na leitura óptica (confiança 40%)', 'Valor lido com confiança 65%', 'Descrição lido com confiança 62%', 'Data ilegível', 'Página 1 lida por OCR com baixa legibilidade (confiança 55%)', 'Lido por OCR'])
      expect(text).toContain(expected);
    expect(result.rows[0]!.provenance).toMatchObject({ page: 1, method: 'ocr', row: 2 });
  });
  it('refuses an unreadable scan and a document without transactions', () => {
    expect(failure(() => read(page([[[10, '~~'], [40, 'x1']]], { method: 'ocr', confidence: 20 }))).code).toBe('LOW_QUALITY');
    expect(failure(() => read(page([[[10, 'Contrato'], [90, 'de'], [120, 'abertura']]]))).code).toBe('NO_ROWS');
    expect(failure(() => read(page([], { method: 'ocr', confidence: null })))).toMatchObject({ code: 'NO_ROWS' });
  });
  it('compares invoice totals, reporting a difference instead of adjusting it', () => {
    const invoice = (total: string, extra: Spec[] = []) => read(page([[[10, 'FATURA'], [80, 'Vencimento'], [160, '10/01/2027']], [[10, '20/12'], [80, 'LOJA'], [400, '100,00']], [[10, '05/01'], [80, 'MERCADO'], [400, '50,00']], ...extra, [[80, 'Total'], [130, 'da'], [160, 'fatura'], [400, total]]]));
    const matching = invoice('150,00');
    expect(values(matching)).toEqual([['-100.00', '2026-12-20', 'LOJA'], ['-50.00', '2027-01-05', 'MERCADO']]);
    expect(warnings(matching)).toContain('Soma das linhas confere');
    expect(warnings(invoice('180,00'))).toContain('Total do documento R$ 180,00 difere da soma das linhas R$ 150,00 (diferença R$ 30,00)');
    expect(warnings(invoice('150,00', [[[10, '06/01'], [80, 'IOF'], [400, '0,01', 10]]]))).toContain('não conferido: há linhas sem valor');
    expect(warnings(read(page([[[10, 'FATURA'], [80, 'Vencimento'], [160, '10/01/2027']], [[10, '20/12'], [80, 'LOJA'], [400, '100,00']]])))).toContain('não traz total da fatura legível');
  });
  it('checks opening and closing statement balances', () => {
    const statement = (closing: string, rows: Spec[] = [[[10, '02/10'], [80, 'PIX'], [400, '-10,00']]]) => read(page([extrato, [[80, 'Saldo'], [130, 'anterior'], [400, '-5,00'], [440, 'D']], ...rows, [[80, 'Saldo'], [130, 'final'], [400, closing]]]));
    expect(warnings(statement('-15,00'))).toContain('confere com o saldo final');
    expect(warnings(statement('20,00'))).toContain('difere do saldo final R$ 20,00');
    expect(warnings(statement('20,00', [[[10, '02/10'], [80, 'PIX'], [400, '10,00']]]))).toContain('não conferidos: há linhas sem valor');
  });
  it('needs a reference to give a year to short dates and honours proven MM/DD order', () => {
    const noYear = read(page([[[10, 'Movimentos']], [[10, '05/10'], [80, 'PIX'], [400, '-1,00']]]));
    expect(values(noYear)[0]![1]).toBeNull(); expect(warnings(noYear)).toContain('sem ano e documento sem data de referência');
    const us = read(page([[[10, 'Statement'], [100, '10/31/2026']], [[10, '10/05/2026'], [80, 'COFFEE'], [400, '-3.50']], [[10, '12 SET'], [80, 'LIVRO'], [400, '-20.00']]]));
    expect(values(us)).toEqual([['-3.50', '2026-10-05', 'COFFEE'], ['-20.00', '2026-09-12', 'LIVRO']]);
    const ambiguous = read(page([[[10, 'Extrato'], [100, '01/11/2026']], [[10, '01/02/2026'], [80, 'PIX'], [400, '-1,00']]]));
    expect(values(ambiguous)[0]![1]).toBe('2026-02-01'); expect(warnings(ambiguous)).toContain('Datas lidas como DD/MM');
    const mixed = read(page([[[10, 'Extrato']], [[10, '25/10/2026'], [80, 'A'], [400, '-1,00']], [[10, '10/25/2026'], [80, 'B'], [400, '-1,00']]]));
    expect(warnings(mixed)).toContain('mistura datas DD/MM e MM/DD');
    const leap = read(page([[[10, 'FATURA'], [80, 'Vencimento'], [160, '10/01/2025']], [[10, '29/02'], [80, 'LOJA'], [400, '1,00']]]));
    expect(values(leap)[0]![1]).toBeNull(); expect(warnings(leap)).toContain('inválida');
  });
  it('skips balances, invoice payments and repeated headers, and joins wrapped descriptions', () => {
    const header: Spec = [[10, 'Data'], [80, 'Descrição'], [400, 'Valor']];
    const result = read(page([[[10, 'FATURA'], [80, 'Vencimento'], [160, '10/10/2026']], header, [[10, '01/09'], [80, 'SALDO'], [140, 'ANTERIOR'], [400, '10,00']], [[10, '02/09'], [80, 'PAGAMENTO'], [160, 'EFETUADO'], [400, '-10,00']], [[10, '03/09'], [80, 'COMPRA'], [400, '5,00']], [[80, 'LOJA'], [130, 'CENTRO']], [[10, 'Página'], [60, '1'], [80, 'de'], [100, '2']]]),
      page([header, [[10, '04/09'], [80, 'PARC'], [120, '02/03'], [400, '7,00']], [[10, 'Página'], [60, '2'], [80, 'de'], [100, '2']]]));
    expect(values(result)).toEqual([['-5.00', '2026-09-03', 'COMPRA LOJA CENTRO'], ['-7.00', '2026-09-04', 'PARC 02/03']]);
    const text = warnings(result);
    for (const expected of ['Cabeçalho da tabela repetido 2 vezes', '1 linha(s) de saldo', '1 pagamento(s) de fatura', 'Parcela 02/03 identificada']) expect(text).toContain(expected);
    expect(result.rows[0]!.provenance.excerpt).toBe('03/09 COMPRA 5,00 ⏎ LOJA CENTRO');
  });
  it('reports rotation, empty OCR pages, missing pages and suspicious descriptions', () => {
    const result = read(page([extrato, [[10, '01/10'], [80, '=SOMA(A1)'], [400, '-1,00']], [[10, '02/10'], [80, 'X'.repeat(510)], [4000, '-1,00']], [[10, 'pág.'], [40, '1/3']]], { rotation: 90 }), page([], { method: 'ocr', confidence: null }));
    const text = warnings(result);
    for (const expected of ['Página 1 lida girada 90°', 'Página 2 sem texto legível', 'indica 3 página(s), mas o arquivo tem 2', 'caractere de fórmula', 'reduzida a 500 caracteres']) expect(text).toContain(expected);
    expect(result.rows[1]!.description).toHaveLength(500);
  });
  it('limits the number of rows per document', () => {
    const rows: Spec[] = Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, i) => [[10, '01/10/2026'], [80, 'ITEM' + i], [400, '-1,00']]);
    expect(failure(() => read(page(rows))).code).toBe('ROW_LIMIT');
  });
  it('reads receipts as one signed entry with a suggested description', () => {
    const outgoing = read(page([[[10, 'COMPROVANTE'], [100, 'PIX']], [[10, 'Data:'], [60, '03/10/2026']], [[10, 'Para:'], [60, 'PADARIA'], [120, 'EXEMPLO']], [[10, 'Valor'], [60, 'pago:'], [120, 'R$'], [150, '27,50']]]));
    expect(outgoing.kind).toBe('receipt'); expect(values(outgoing)).toEqual([['-27.50', '2026-10-03', 'PADARIA EXEMPLO']]);
    const incoming = read(page([[[10, 'Pix'], [40, 'recebido']], [[10, 'LOJA'], [60, 'EXEMPLO']], [[10, 'Data'], [60, '04/10/2026']], [[10, 'Valor'], [60, 'total']], [[10, 'R$'], [40, '10,00']]]));
    expect(values(incoming)).toEqual([['10.00', '2026-10-04', 'LOJA EXEMPLO']]); expect(warnings(incoming)).toContain('recebimento tratado como entrada');
    const partial = read(page([[[10, 'RECIBO']], [[10, 'Total'], [60, '9,90', 30]]], { method: 'ocr', confidence: 80 }));
    expect(values(partial)).toEqual([[null, null, null]]);
    for (const expected of ['Data não encontrada', 'Valor ilegível', 'Descrição não encontrada']) expect(warnings(partial)).toContain(expected);
    const undated = read(page([[[10, 'CUPOM'], [60, 'FISCAL']], [[10, 'Data'], [60, '31/02/2026']]]));
    expect(values(undated)).toEqual([[null, null, null]]); expect(warnings(undated)).toContain('Valor total não encontrado');
  });
  it('labels each document family and extraction method', () => {
    const statement = page([extrato, [[10, '01/10'], [80, 'PIX'], [400, '-1,00']]]);
    expect(read(statement).format).toBe('PDF digital · extrato');
    expect(interpretDocument({ format: 'pdf', pages: [statement, { ...statement, page: 2, method: 'ocr', confidence: 90 }], warnings: [] }).format).toBe('PDF misto (texto e OCR) · extrato');
    expect(interpretDocument({ format: 'webp', pages: [{ ...statement, method: 'ocr', confidence: 90 }], warnings: ['x'] })).toMatchObject({ format: 'Imagem WebP (OCR) · extrato', warnings: ['x'] });
  });
});
