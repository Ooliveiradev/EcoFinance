import { describe, it, expect } from 'vitest';
import { entriesCsv, csvCell, deleteDataSchema, restoreRequestSchema, entriesExportSchema, BACKUP_COLLECTIONS, BACKUP_COLLECTION_LABELS, DELETE_DATA_CONFIRMATION, DELETE_ACCOUNT_CONFIRMATION, type CsvEntry } from './index';

const row = (patch: Partial<CsvEntry> = {}): CsvEntry => ({ id: '00000000-0000-4000-8000-000000000001', purchaseDate: '2028-03-02', competenceMonth: '2028-03-01', description: 'Mercado', amount: '-12.34', kind: 'expense', status: 'settled', account: 'Banco', category: 'Comida', dueDate: null, paidDate: '2028-03-02', notes: null, source: 'manual', archived: false, transferId: null, ...patch });
describe('entry CSV export', () => {
  it('writes a BOM, a header and one exact line per entry with readable labels', () => {
    const csv = entriesCsv([row(), row({ kind: 'transfer', status: 'planned', archived: true, transferId: 'abc', paidDate: null, amount: '300.00' }), row({ kind: 'custom', status: 'other' })]);
    const lines = csv.slice(1).split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true); expect(lines.at(-1)).toBe('');
    expect(lines[0]).toBe('data;competência;descrição;valor;tipo;status;conta;categoria;vencimento;pagamento;observações;origem;arquivado;id;transferência');
    expect(lines[1]).toBe('2028-03-02;2028-03;Mercado;-12.34;despesa;pago;Banco;Comida;;2028-03-02;;manual;não;00000000-0000-4000-8000-000000000001;');
    expect(lines[2]).toContain(';300.00;transferência;previsto;'); expect(lines[2]).toContain(';sim;');
    expect(lines[3]).toContain(';custom;other;');
  });
  it('neutralizes formulas in every user-controlled cell, including leading spaces and full-width signs', () => {
    const csv = entriesCsv([row({ description: '=HYPERLINK("https://evil.test")', account: '+cmd', category: '@SUM(A1)', notes: ' -2+3', source: '\tx' }), row({ description: '＝1+1' })]);
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.test"")"`); expect(csv).toContain(`'+cmd;'@SUM(A1)`); expect(csv).toContain(`' -2+3;'\tx`); expect(csv).toContain(`'＝1+1`);
    expect(csv).toContain(';-12.34;');
  });
  it('quotes separators and line breaks', () => {
    expect(csvCell('a;b')).toBe('"a;b"'); expect(csvCell('linha\nnova')).toBe('"linha\nnova"'); expect(csvCell(-5)).toBe('-5'); expect(csvCell('-1.50')).toBe('-1.50');
  });
});
describe('data-control inputs', () => {
  it('requires the exact typed confirmation for each deletion scope', () => {
    expect(deleteDataSchema.parse({ scope: 'data', confirm: DELETE_DATA_CONFIRMATION })).toEqual({ scope: 'data', confirm: DELETE_DATA_CONFIRMATION });
    expect(deleteDataSchema.safeParse({ scope: 'account', confirm: DELETE_DATA_CONFIRMATION }).success).toBe(false);
    expect(deleteDataSchema.safeParse({ scope: 'account', confirm: DELETE_ACCOUNT_CONFIRMATION }).success).toBe(true);
    expect(deleteDataSchema.safeParse({ scope: 'data', confirm: DELETE_DATA_CONFIRMATION, ownerId: 'x' }).success).toBe(false);
  });
  it('accepts only the documented restore fields and defaults to the same owner', () => {
    expect(restoreRequestSchema.parse({ backup: {} })).toEqual({ backup: {}, ownerMode: 'same' });
    expect(restoreRequestSchema.safeParse({ backup: {}, confirm: 'sim' }).success).toBe(false);
    expect(restoreRequestSchema.safeParse({ backup: [], ownerMode: 'adopt' }).success).toBe(false);
    expect(restoreRequestSchema.safeParse({ backup: {}, ownerId: 'x' }).success).toBe(false);
  });
  it('validates export periods and labels every backup collection', () => {
    expect(entriesExportSchema.safeParse({ from: '2028-01-01', to: '2028-02-01' }).success).toBe(true);
    expect(entriesExportSchema.safeParse({ from: '2028-03-01', to: '2028-02-01' }).success).toBe(false);
    expect(entriesExportSchema.safeParse({ from: '2028-02-30' }).success).toBe(false);
    expect(BACKUP_COLLECTIONS.every(c => BACKUP_COLLECTION_LABELS[c].length > 0)).toBe(true);
  });
});
