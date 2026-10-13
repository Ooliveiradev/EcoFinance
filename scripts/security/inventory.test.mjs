import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyInventory } from './inventory.mjs';
test('inventory includes direct/transitive dependencies, pinned actions and container images without private paths or source credentials', () => {
  const lock = { lockfileVersion: '9.0', importers: { '.': { devDependencies: { sample: { specifier: '^1', version: '1.0.0' } } } }, packages: { 'sample@1.0.0': { resolution: { integrity: 'sha512-synthetic', tarball: 'https://secret:private@example.test/file' } }, 'transitive@2.0.0': { resolution: { integrity: 'sha512-other' } } } };
  const inventory = dependencyInventory(lock, [{ path: '.github/workflows/ci.yml', content: '    - uses: owner/action@012345 # pinned\n' }], 'FROM node:22@sha256:synthetic AS build');
  assert.equal(inventory.packages.length, 2);
  assert.deepEqual(inventory.workspaces[0].direct, [{ name: 'sample', scope: 'devDependencies', resolved: '1.0.0' }]);
  assert.deepEqual(inventory.actions, [{ path: '.github/workflows/ci.yml', ref: 'owner/action@012345' }]);
  assert.deepEqual(inventory.images, ['node:22@sha256:synthetic']);
  assert.ok(!JSON.stringify(inventory).includes('secret:private'));
  lock.packages['remote@https://secret:private@example.test/package.tgz?token=synthetic'] = { resolution: { tarball: 'https://example.test/package.tgz' } };
  lock.importers['.'].devDependencies.sample.version = 'https://secret:private@example.test/package.tgz?token=synthetic';
  const redacted = JSON.stringify(dependencyInventory(lock, [], ''));
  assert.ok(!redacted.includes('secret:private')); assert.ok(!redacted.includes('token=synthetic'));
  assert.throws(() => dependencyInventory({ ...lock, lockfileVersion: '10.0' }, [], ''), /Unsupported lockfile/);
});
