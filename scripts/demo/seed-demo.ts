// Mês sintético para capturas do README (#17). Só roda contra o emulador do Firestore
// e grava pela API HTTP da web local, as mesmas rotas usadas pelo navegador.
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-ecofinance \
//   FIRESTORE_DATABASE_ID=ecofinance pnpm exec tsx scripts/demo/seed-demo.ts
import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { DocumentStore } from '../../packages/db/src';
import { assertTestStore } from '../../packages/db/tests/firestore-fixture';
import { provisionUser } from '../../apps/next/src/lib/provision-user';

// Deliberately public demo values. Never use for a deployed installation.
export const DEMO_EMAIL = 'demo@example.test';
export const DEMO_PASSWORD = 'demo-synthetic-password';
const base = process.env.DEMO_BASE_URL ?? 'http://127.0.0.1:3000';
const month = process.env.DEMO_MONTH ?? '2026-10';
const day = (d: number) => `${month}-${String(d).padStart(2, '0')}`;

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Somente com FIRESTORE_EMULATOR_HOST (emulador).');
const db = new DocumentStore(new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID, databaseId: process.env.FIRESTORE_DATABASE_ID }));
assertTestStore(db);

let cookie = '';
async function call<T = Record<string, unknown>>(method: string, path: string, data?: unknown, ifMatch?: string): Promise<T> {
  const headers: Record<string, string> = { origin: base, 'content-type': 'application/json', 'idempotency-key': randomUUID(), cookie };
  if (ifMatch) headers['if-match'] = ifMatch;
  const response = await fetch(base + path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  const setCookie = response.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie.map(value => value.split(';')[0]).join('; ');
  return response.json() as Promise<T>;
}

async function main() {
  await provisionUser(db, { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: 'Pessoa Demo' });
  await db.firestore.terminate();
  await call('POST', '/api/auth/sign-in/email', { email: DEMO_EMAIL, password: DEMO_PASSWORD });

  const account = (await call<{ id: string }>('POST', '/api/accounts', { name: 'Conta corrente', type: 'banco', openingBalance: '2350.00', openingDate: day(1) })).id;
  await call('POST', '/api/accounts', { name: 'Carteira', type: 'carteira', openingBalance: '120.00', openingDate: day(1) });
  const category: Record<string, string> = {};
  for (const [name, color] of [['Salário', '#2e7d32'], ['Moradia', '#5c6bc0'], ['Mercado', '#ef6c00'], ['Transporte', '#00838f'], ['Lazer', '#ad1457'], ['Saúde', '#6d4c41']] as const)
    category[name] = (await call<{ id: string }>('POST', '/api/categories', { name, color })).id;

  const entry = (description: string, amount: string, categoryName: string, d: number, kind = 'expense') =>
    call('POST', '/api/entries', { accountId: account, categoryId: category[categoryName], description, amount, kind, status: 'settled', purchaseDate: day(d), competenceMonth: day(1), dueDate: null, paidDate: day(d) });
  await entry('Salário', '6500.00', 'Salário', 5, 'income');
  await entry('Supermercado Exemplo', '412.37', 'Mercado', 6);
  await entry('Feira do bairro', '86.50', 'Mercado', 12);
  await entry('Transporte por app', '38.90', 'Transporte', 9);
  await entry('Combustível', '210.00', 'Transporte', 14);
  await entry('Cinema', '64.00', 'Lazer', 11);
  await entry('Farmácia', '57.80', 'Saúde', 16);
  await entry('Padaria', '23.40', 'Mercado', 18);

  for (const [description, amount, dueDay, categoryName] of [['Aluguel', '1800.00', 5, 'Moradia'], ['Internet', '119.90', 10, 'Moradia'], ['Energia', '180.00', 20, 'Moradia'], ['Academia', '99.00', 28, 'Saúde']] as const)
    await call('POST', '/api/recurrences', { fromMonth: month, schedule: { accountId: account, categoryId: category[categoryName], description, amount, startDate: day(1), endDate: null, dueDay, estimated: description === 'Energia', reminderDays: 2, paused: false } });
  await call('POST', `/api/planning/${month}/generate`, {});
  const planning = await call<{ occurrences: { id: string; revision: string; description: string; amount: string }[] }>('GET', `/api/planning/${month}`);
  for (const [description, paid] of [['Aluguel', 5], ['Internet', 10]] as const) {
    const occurrence = planning.occurrences.find(row => row.description === description)!;
    await call('POST', `/api/occurrences/${occurrence.id}/pay`, { amount: occurrence.amount, paidDate: day(paid) }, occurrence.revision);
  }
  await call('PUT', `/api/planning/${month}`, { limit: '4200.00', expectedIncome: '6500.00', reserve: '800.00', categories: [
    { categoryId: category['Moradia']!, limit: '2200.00' }, { categoryId: category['Mercado']!, limit: '900.00' },
    { categoryId: category['Transporte']!, limit: '400.00' }, { categoryId: category['Lazer']!, limit: '300.00' }, { categoryId: category['Saúde']!, limit: '250.00' }] }, 'new');

  const card = (await call<{ id: string }>('POST', '/api/cards', { name: 'Cartão Exemplo', paymentAccountId: account, closingDay: 25, dueDay: 5 })).id;
  await call('POST', `/api/cards/${card}/purchases`, { description: 'Notebook (3x)', categoryId: category['Lazer'], totalAmount: '2700.00', count: 3, purchaseDate: day(3), firstMonth: month, confirmed: true });
  await call('POST', `/api/cards/${card}/purchases`, { description: 'Restaurante', categoryId: category['Lazer'], totalAmount: '142.60', count: 1, purchaseDate: day(15), firstMonth: month, confirmed: true });
  console.log(`Demo pronta: ${base} — ${DEMO_EMAIL} (mês ${month}).`);
}
main().catch(error => { console.error(error); process.exit(1); });
