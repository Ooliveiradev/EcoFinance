import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleFindings, sourceFindings, sarifFindings } from './policy.mjs';

test('blocks public mobile secrets, private server env in client/shared modules, allows public endpoints', () => {
  assert.deepEqual(sourceFindings('apps/expo/src/api.ts', 'process.env.EXPO_PUBLIC_API_SECRET'), ['public credential EXPO_PUBLIC_API_SECRET', 'retired credential EXPO_PUBLIC_API_SECRET']);
  assert.equal(sourceFindings('apps/next/src/client.tsx', "'use client';\nprocess.env['GEMINI_API_KEY']").length, 1);
  assert.deepEqual(sourceFindings('packages/shared/src/api.ts', 'process.env.API_SECRET_KEY'), ['retired credential API_SECRET_KEY']);
  assert.deepEqual(sourceFindings('apps/expo/src/api.ts', 'process.env.EXPO_PUBLIC_API_URL'), []);
  assert.deepEqual(sourceFindings('apps/next/src/app/api/route.ts', 'process.env.GEMINI_API_KEY'), []);
});
test('retired integration credentials are blocked even in server routes', () => {
  assert.deepEqual(sourceFindings('apps/next/src/app/api/pluggy/route.ts', "process.env['PLUGGY_CLIENT_SECRET']"), ['retired credential PLUGGY_CLIENT_SECRET']);
  assert.deepEqual(sourceFindings('apps/next/src/app/api/route.ts', 'process.env.PLUGGY_CLIENT_ID'), ['retired credential PLUGGY_CLIENT_ID']);
  assert.deepEqual(sourceFindings('apps/next/src/app/api/route.ts', 'process.env.API_SECRET_KEY_ROTATED'), []);
});
test('detects direct and encoded canaries without disclosing their values', () => {
  const canary = 'synthetic-value-with-32-characters';
  for (const value of [canary, encodeURIComponent(canary), Buffer.from(canary).toString('base64')]) {
    assert.deepEqual(bundleFindings(value, { GEMINI_API_KEY: canary }), ['value of GEMINI_API_KEY']);
  }
  assert.deepEqual(bundleFindings('safe content', { GEMINI_API_KEY: canary }), []);
});
test('distinguishes anonymous JWTs from service role JWTs', () => {
  const jwt = role => `eyJheader.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.deepEqual(bundleFindings(jwt('anon'), {}), []);
  assert.deepEqual(bundleFindings(jwt('service_role'), {}), ['Supabase service role JWT']);
});
test('SARIF is blocking even with a successful analyzer exit code; malformed/missing scan fails closed', () => {
  const report = results => ({ runs: [{ tool: { driver: { name: 'CodeQL' } }, results }] });
  assert.deepEqual(sarifFindings(report([])), []);
  assert.equal(sarifFindings(report([{ ruleId: 'js/sql-injection', level: 'error' }])).length, 1);
  assert.equal(sarifFindings(report([{ ruleId: 'warning', level: 'warning', suppressions: [{ status: 'accepted' }] }])).length, 1);
  assert.throws(() => sarifFindings({ runs: [] }));
  assert.throws(() => sarifFindings({ runs: [{}] }));
  assert.throws(() => sarifFindings({ runs: [{ ...report([]).runs[0], invocations: [{ executionSuccessful: false }] }] }));
});
