import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
test('runtime SQL dependencies require an explicit policy change while offline tools retain SQL access', async () => {
  const lint = new ESLint();
  const source = "import postgres from 'postgres'; console.log(postgres);";
  for (const filePath of ['apps/next/src/lib/future-query.ts', 'packages/shared/src/future-query.ts']) {
    const [result] = await lint.lintText(source, { filePath });
    assert.ok(result.messages.some(message => message.ruleId === 'no-restricted-imports'));
  }
  const [offline] = await lint.lintText(source, { filePath: 'packages/db/scripts/future-query.ts' });
  assert.ok(!offline.messages.some(message => message.ruleId === 'no-restricted-imports'));
});
