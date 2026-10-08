import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { TEST_PASSWORD } from './credentials';
import { e2eDatabase } from './database';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
const db = e2eDatabase(), origin = 'http://127.0.0.1:3000';
test.setTimeout(120000);
test.beforeEach(async () => { await clearTestCollections(db, ['authRateLimits']); });
test.afterAll(async () => { await db.firestore.terminate(); });
async function login(request: APIRequestContext, email = 'c@example.test') { expect((await request.post('/api/auth/sign-in/email', { headers: { origin }, data: { email, password: TEST_PASSWORD } })).status()).toBe(200); }
const headers = (extra: Record<string, string> = {}) => ({ origin, 'idempotency-key': randomUUID(), ...extra });
async function created(request: APIRequestContext, path: string, data: object) {
  const response = await request.post(path, { headers: headers(), data }); expect(response.status()).toBe(201); return response.json();
}
async function entries(request: APIRequestContext, description: string) {
  return (await (await request.get('/api/entries?limit=100&description=' + encodeURIComponent(description))).json()).entries as { id: string; description: string; amount: string }[];
}
test('exports CSV and backup from settings, then restores the backup after a change through the preview', async ({ page }, info) => {
  await login(page.request);
  const name = 'Backup ' + info.project.name + ' ' + Date.now();
  const account = (await created(page.request, '/api/accounts', { name, type: 'banco', openingBalance: '100.00', openingDate: '2032-01-01' })).id;
  const categoryId = (await created(page.request, '/api/categories', { name, color: '#225588' })).id;
  const entry = (patch: object) => ({ accountId: account, categoryId, description: name, amount: '10.25', kind: 'expense', status: 'settled', purchaseDate: '2032-01-02', competenceMonth: '2032-01-01', dueDate: null, paidDate: '2032-01-02', ...patch });
  await created(page.request, '/api/entries', entry({ description: '=HYPERLINK("https://evil.test") ' + name }));
  await created(page.request, '/api/entries', entry({ description: name + ' salário', kind: 'income', amount: '500.00' }));

  await page.goto('/settings');
  const data = page.getByRole('region', { name: 'Seus dados' });
  // The summary reads the whole owned graph after hydration; slower engines need more than the default 5 s.
  await expect(data.getByText(/lançamentos e \d+ registros/)).toBeVisible({ timeout: 30000 });
  const [csvDownload] = await Promise.all([page.waitForEvent('download'), data.getByRole('link', { name: 'Exportar lançamentos (CSV)' }).click()]);
  const csv = await readFile((await csvDownload.path())!, 'utf8');
  expect(csv).toContain(`"'=HYPERLINK(""https://evil.test"") ${name}"`); expect(csv).toContain(`;${name} salário;500.00;receita;pago;`);
  const [backupDownload] = await Promise.all([page.waitForEvent('download'), data.getByRole('link', { name: 'Baixar backup completo (JSON)' }).click()]);
  expect(backupDownload.suggestedFilename()).toMatch(/^ecofinance-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const file = (await backupDownload.path())!, backup = JSON.parse(await readFile(file, 'utf8'));
  expect(backup).toMatchObject({ format: 'ecofinance-user-backup', version: 1 });

  // Changes after the backup: one entry added, one archived.
  await created(page.request, '/api/entries', entry({ description: name + ' depois' }));
  const [salary] = await entries(page.request, name + ' salário');
  const full = (await (await page.request.get('/api/entries?id=' + salary!.id)).json()).entries[0];
  expect((await page.request.delete('/api/entries/' + salary!.id, { headers: headers({ 'if-match': '"' + full.revision + '"' }), data: { action: 'archive' } })).status()).toBe(200);
  expect(await entries(page.request, name + ' salário')).toHaveLength(0);

  await data.getByLabel('Arquivo de backup').setInputFiles(file);
  const preview = data.getByRole('region', { name: 'Prévia da restauração' });
  await expect(preview).toContainText(`${backup.summary.entries.entries} lançamentos`);
  await expect(preview.getByRole('row', { name: /Lançamentos/ })).toContainText(String(backup.summary.counts.transactions));
  const restore = preview.getByRole('button', { name: 'Restaurar backup' });
  await expect(restore).toBeDisabled();
  await preview.getByLabel('Entendo que os dados atuais serão substituídos por este backup.').check();
  await restore.click();
  await expect(data.getByRole('status')).toContainText('Backup restaurado');
  expect(await entries(page.request, name + ' depois')).toHaveLength(0);
  expect((await entries(page.request, name + ' salário'))[0]).toMatchObject({ amount: '500.00' });
  expect((await (await page.request.get('/api/data')).json()).counts).toEqual(backup.summary.counts);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('isolates owners, refuses tampered or foreign backups and deletes only after explicit confirmation', async ({ request, playwright }) => {
  for (const path of ['/api/data', '/api/data/backup', '/api/data/entries']) expect((await request.get(path)).status()).toBe(401);
  await login(request);
  const backup = await (await request.get('/api/data/backup')).json(), mine = await (await request.get('/api/data')).json();
  expect((await request.post('/api/data/restore/preview', { headers: headers({ origin: 'https://hostile.test' }), data: { backup } })).status()).toBe(403);
  const tampered = await request.post('/api/data/restore/preview', { headers: headers(), data: { backup: { ...backup, summary: { ...backup.summary, counts: { ...backup.summary.counts, transactions: 0 } } } } });
  expect(tampered.status()).toBe(422); expect((await tampered.json()).error).toBe('INVALID_BACKUP');
  expect((await request.post('/api/data/restore', { headers: headers({ 'if-match': '"stale"' }), data: { backup, confirm: 'RESTAURAR' } })).status()).toBe(409);

  const foreign = await playwright.request.newContext({ baseURL: origin });
  try {
    await login(foreign, 'b@example.test');
    const theirs = await (await foreign.get('/api/data')).json();
    expect(JSON.stringify(await (await foreign.get('/api/data/backup')).json())).not.toContain(backup.ownerId);
    const preview = await (await foreign.post('/api/data/restore/preview', { headers: headers(), data: { backup } })).json();
    expect(preview).toMatchObject({ foreignOwner: true, currentRevision: theirs.revision });
    const refused = await foreign.post('/api/data/restore', { headers: headers({ 'if-match': '"' + theirs.revision + '"' }), data: { backup, confirm: 'RESTAURAR' } });
    expect(refused.status()).toBe(409); expect((await refused.json()).error).toBe('FOREIGN_BACKUP');
    expect((await (await foreign.get('/api/data')).json()).revision).toBe(theirs.revision);
  } finally { await foreign.dispose(); }

  expect((await request.post('/api/data/delete', { headers: headers({ 'if-match': '"' + mine.revision + '"' }), data: { scope: 'data', confirm: 'sim' } })).status()).toBe(400);
  expect((await request.post('/api/data/delete', { headers: headers({ 'if-match': '"' + mine.revision + '"' }), data: { scope: 'data', confirm: 'EXCLUIR MEUS DADOS' } })).status()).toBe(200);
  const after = await (await request.get('/api/data')).json();
  expect(Object.values(after.counts).every(n => n === 0)).toBe(true);
  // The login survives a data-only deletion, and the previous backup restores everything.
  const restored = await request.post('/api/data/restore', { headers: headers({ 'if-match': '"' + after.revision + '"' }), data: { backup, confirm: 'RESTAURAR' } });
  expect(restored.status()).toBe(200); expect((await (await request.get('/api/data')).json()).counts).toEqual(backup.summary.counts);
});
