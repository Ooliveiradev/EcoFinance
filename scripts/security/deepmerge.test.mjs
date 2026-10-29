import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const deepmerge = require('deepmerge');

test('deepmerge keeps Object.prototype when the target has an own __proto__ key (GHSA-gcqx-w48m-w2h4)', () => {
  const poisoned = JSON.parse('{"__proto__":{"polluted":true},"kept":{"a":1}}');
  for (const result of [deepmerge(poisoned, { kept: { b: 2 } }), deepmerge.all([{}, poisoned]), deepmerge(poisoned, {}, { clone: false })]) {
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.polluted, undefined);
  }
  assert.equal({}.polluted, undefined);
});

test('deepmerge still merges ordinary configuration', () => {
  assert.deepEqual(deepmerge({ a: { b: 1 }, list: [1] }, { a: { c: 2 }, list: [2] }), { a: { b: 1, c: 2 }, list: [1, 2] });
  assert.deepEqual(deepmerge({}, JSON.parse('{"__proto__":{"x":1},"y":2}')), { y: 2 });
});
