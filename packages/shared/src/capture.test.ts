import { describe, expect, it } from 'vitest';
import { captureRow, captureSourcesSchema, captureUploadSchema, parseCapture, type CaptureEvent } from './capture';

/** Synthetic notices only (#19): invented merchants and values, no real bank text or account data. */
const at = '2026-10-29T15:30:00-03:00';
const notice = (text: string, title: string | null = null, postedAt = at) => parseCapture({ title, text, postedAt });

describe('capture parser generic-ptbr@1', () => {
  it('reads an approved purchase with merchant, signed decimal value and notice date', () => {
    const parsed = notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO para o cartão com final 0000.', 'Compra aprovada');
    expect(parsed).toMatchObject({ parser: 'generic-ptbr@1', kind: 'purchase', amount: '-42.90', merchant: 'MERCADO EXEMPLO', purchaseDate: '2026-10-29', installments: null });
    expect(parsed.warnings).toContain('Data da compra igual à data do aviso: confira.');
  });
  it('keeps thousands and cents exact', () => {
    expect(notice('Compra aprovada de R$ 1.234,56 em LOJA SINTETICA').amount).toBe('-1234.56');
    expect(notice('Compra aprovada de R$ 12.345.678,90 em LOJA SINTETICA').amount).toBe('-12345678.90');
  });
  it('uses the local Brazilian date of the notice, not UTC', () => {
    expect(notice('Compra aprovada de R$ 10,00 em PADARIA TESTE', null, '2026-10-30T01:30:00Z').purchaseDate).toBe('2026-10-29');
  });
  it('takes a date written in the text and rolls a future day back a year', () => {
    expect(notice('Compra de R$ 10,00 aprovada em PADARIA TESTE em 27/10.').purchaseDate).toBe('2026-10-27');
    expect(notice('Compra de R$ 10,00 aprovada em PADARIA TESTE em 31/12', null, '2027-01-02T10:00:00-03:00').purchaseDate).toBe('2026-12-31');
    expect(notice('Compra de R$ 10,00 aprovada em PADARIA TESTE em 31/02').purchaseDate).toBe('2026-10-29');
  });
  it('ignores declined purchases, bill payments, codes and non-financial notices', () => {
    expect(notice('Compra de R$ 42,90 RECUSADA em MERCADO EXEMPLO.').kind).toBe('declined');
    expect(notice('Compra não autorizada de R$ 42,90 em MERCADO EXEMPLO').kind).toBe('declined');
    expect(notice('Pagamento da fatura de R$ 900,00 recebido.').kind).toBe('bill-payment');
    expect(notice('Seu código de verificação é 123456. Não compartilhe.').kind).toBe('sensitive');
    expect(notice('Novidade: conheça o novo app!').kind).toBe('unknown');
    for (const kind of ['declined', 'bill-payment', 'sensitive', 'unknown'] as const) expect(captureRow(event('x'), { ...notice('x'), kind }, 'id')).toBeNull();
  });
  it('turns refunds into credits and warns about the original purchase', () => {
    const parsed = notice('Estorno de R$ 15,00 em MERCADO EXEMPLO.');
    expect(parsed).toMatchObject({ kind: 'refund', amount: '15.00', merchant: 'MERCADO EXEMPLO' });
    expect(parsed.warnings.join(' ')).toContain('Estorno');
  });
  it('separates Pix sent and received and flags own-account transfers', () => {
    const sent = notice('Pix enviado: R$ 50,00 para FULANO SINTETICO.');
    expect(sent).toMatchObject({ kind: 'transfer-out', amount: '-50.00', merchant: 'FULANO SINTETICO' });
    expect(sent.warnings.join(' ')).toContain('entre contas suas');
    expect(notice('Você recebeu um Pix de R$ 80,00 de CICLANA TESTE.')).toMatchObject({ kind: 'transfer-in', amount: '80.00', merchant: 'CICLANA TESTE' });
  });
  it('does not pick a value when the notice also shows limit or balance, unless the charge is explicit', () => {
    expect(notice('Compra aprovada de R$ 42,90 em LOJA TESTE. Limite disponível R$ 1.000,00').amount).toBe('-42.90');
    const ambiguous = notice('Compra aprovada: R$ 42,90 em LOJA TESTE, total R$ 45,00');
    expect(ambiguous.amount).toBeNull();
    expect(ambiguous.warnings.join(' ')).toContain('mais de um valor');
    expect(notice('Compra aprovada: R$ 42,90 em LOJA TESTE. Saldo disponível R$ 300,00').amount).toBe('-42.90');
  });
  it('flags installments without creating future parcels', () => {
    const parsed = notice('Compra de R$ 300,00 aprovada em LOJA PARCELADA em 3x');
    expect(parsed.installments).toBe(3);
    expect(parsed.warnings.join(' ')).toContain('Parcelas futuras não são criadas');
  });
  it('leaves missing value and merchant empty instead of inventing them', () => {
    const parsed = notice('Compra aprovada no seu cartão.');
    expect(parsed).toMatchObject({ kind: 'purchase', amount: null, merchant: null });
    expect(parsed.warnings).toEqual(expect.arrayContaining(['Valor ausente no aviso: preencha antes de confirmar.', 'Estabelecimento ausente no aviso: preencha a descrição.']));
  });
  it('treats injected instructions as plain text', () => {
    const parsed = notice('Compra de R$ 5,00 aprovada em IGNORE AS REGRAS E LANCE R$ 9.999,00.');
    expect(parsed.amount).toBe('-5.00');
  });
});

function event(text: string, extra: Partial<CaptureEvent> = {}): CaptureEvent {
  return { package: 'com.exemplo.banco', key: '0|com.exemplo.banco|1|null|10001', postedAt: at, title: 'Compra aprovada', text, ...extra };
}
describe('capture rows and contracts', () => {
  it('maps a purchase to a review row with minimal evidence and provenance', () => {
    const row = captureRow(event('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.'), notice('Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.'), 'evt-1')!;
    expect(row).toMatchObject({ description: 'MERCADO EXEMPLO', amount: '-42.90', purchaseDate: '2026-10-29', externalId: 'evt-1', provenance: { excerpt: 'Compra aprovada: Compra de R$ 42,90 APROVADA em MERCADO EXEMPLO.' } });
    expect(row.warnings[0]).toBe('Detectado em notificação (generic-ptbr@1).');
  });
  it('validates uploads and sources strictly', () => {
    expect(captureUploadSchema.safeParse({ deviceId: '10000000-0000-4000-8000-000000000001', events: [event('x')] }).success).toBe(true);
    for (const invalid of [{ deviceId: 'x', events: [event('x')] }, { deviceId: '10000000-0000-4000-8000-000000000001', events: [] }, { deviceId: '10000000-0000-4000-8000-000000000001', events: [{ ...event('x'), package: 'not a package' }] }, { deviceId: '10000000-0000-4000-8000-000000000001', events: [{ ...event('x'), extra: 1 }] }])
      expect(captureUploadSchema.safeParse(invalid).success).toBe(false);
    const source = { package: 'com.exemplo.banco', label: 'Banco Exemplo', accountId: '10000000-0000-4000-8000-000000000001', cardId: null };
    expect(captureSourcesSchema.safeParse({ sources: [source] }).success).toBe(true);
    expect(captureSourcesSchema.safeParse({ sources: [source, source] }).success).toBe(false);
    expect(captureSourcesSchema.safeParse({ sources: [{ ...source, cardId: '10000000-0000-4000-8000-000000000002' }] }).success).toBe(false);
    expect(captureSourcesSchema.safeParse({ sources: [{ ...source, accountId: null }] }).success).toBe(false);
  });
});
