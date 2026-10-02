import { describe, expect, it } from 'vitest';
import {
  createTransactionSchema, notificationTransactionSchema, nearbySearchParamsSchema,
  importOfxSchema, pluggySyncRequestSchema, uberWebhookPayloadSchema,
} from './validators';

const id = '00000000-0000-4000-8000-000000000001';
describe('legacy API validation boundaries', () => {
  it('preserves decimal strings and applies explicit defaults', () => {
    const transaction = { accountId: id, description: 'Sintético', amount: '-0.10', date: '2026-10-02T12:00:00Z' };
    expect(createTransactionSchema.parse(transaction)).toMatchObject({ amount: '-0.10', category: 'desconhecido', source: 'manual' });
    for (const changes of [{ accountId: 'invalid' }, { description: '' }, { description: 'x'.repeat(501) }, { amount: 1 }, { amount: '0.001' }, { date: 'invalid' }, { latitude: 91 }, { longitude: -181 }, { externalId: 'x'.repeat(256) }]) {
      expect(createTransactionSchema.safeParse({ ...transaction, ...changes }).success).toBe(false);
    }
  });
  it('rejects invalid notification amount, location and date', () => {
    const payload = { description: 'Sintético', amount: 1, bankName: 'Banco sintético', latitude: null, longitude: null, timestamp: '2026-10-02T12:00:00Z' };
    expect(notificationTransactionSchema.safeParse(payload).success).toBe(true);
    for (const changes of [{ amount: 0 }, { amount: -1 }, { amount: '1' }, { bankName: '' }, { description: '' }, { timestamp: 'invalid' }, { latitude: 91 }, { longitude: -181 }]) {
      expect(notificationTransactionSchema.safeParse({ ...payload, ...changes }).success).toBe(false);
    }
  });
  it('limits spatial requests to valid coordinates and a 50km radius', () => {
    expect(nearbySearchParamsSchema.parse({ latitude: -90, longitude: 180 }).radiusMeters).toBe(1000);
    for (const payload of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: 0, longitude: 0, radiusMeters: 0 }, { latitude: 0, longitude: 0, radiusMeters: 50001 }]) {
      expect(nearbySearchParamsSchema.safeParse(payload).success).toBe(false);
    }
  });
  it('requires import ownership reference and a nonempty provider item', () => {
    expect(importOfxSchema.safeParse({ accountId: id, fileContent: '<OFX></OFX>' }).success).toBe(true);
    expect(importOfxSchema.safeParse({ accountId: id, fileContent: '' }).success).toBe(false);
    expect(pluggySyncRequestSchema.safeParse({ itemId: 'synthetic' }).success).toBe(true);
    expect(pluggySyncRequestSchema.safeParse({ itemId: '' }).success).toBe(false);
  });
  it('requires positive ride amounts and rejects fractional durations', () => {
    const payload = { valor: 42.9, data_hora: '2026-10-02T12:00:00Z', endereco_partida: 'Origem sintética', endereco_destino: 'Destino sintético' };
    expect(uberWebhookPayloadSchema.safeParse(payload).success).toBe(true);
    for (const changes of [{ valor: -1 }, { data_hora: 'invalid' }, { endereco_partida: '' }, { endereco_destino: '' }, { duracao_segundos: 1.5 }, { duracao_segundos: 0 }]) {
      expect(uberWebhookPayloadSchema.safeParse({ ...payload, ...changes }).success).toBe(false);
    }
  });
});
