import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scanner = fileURLToPath(new URL('./check-bundle.mjs', import.meta.url));
test('bundle CLI rejects missing artifacts and leaks but accepts a clean Next bundle without public/', async () => {
  const taskTempRoot = resolve(tmpdir());
  const directory = await mkdtemp(join(taskTempRoot, 'ecofinance-bundle-test-'));
  assert.equal(dirname(resolve(directory)), taskTempRoot);
  const canary = 'ecofinance-only-synthetic-negative-control';
  const run = () => spawnSync(process.execPath, [scanner, 'web'], { cwd: directory, env: { ...process.env, GEMINI_API_KEY: canary }, encoding: 'utf8' });
  try {
    assert.notEqual(run().status, 0);
    const bundles = join(directory, 'apps/next/.next/static');
    await mkdir(bundles, { recursive: true });
    await writeFile(join(bundles, 'app.js'), 'console.log("safe");');
    assert.equal(run().status, 0);
    await writeFile(join(bundles, 'app.js.map'), JSON.stringify({ sourcesContent: [canary] }));
    const leaked = run();
    assert.notEqual(leaked.status, 0);
    assert.match(leaked.stderr, /GEMINI_API_KEY/);
    assert.ok(!leaked.stderr.includes(canary));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
