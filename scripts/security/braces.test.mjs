import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const braces = require('braces');
const methods = ['parse', 'stringify', 'compile', 'expand'];

test('braces rejects deeply nested patterns before recursive stack exhaustion', () => {
  const patterns = [
    '{'.repeat(4000) + 'a,b' + '}'.repeat(4000),
    '('.repeat(4000) + 'a' + ')'.repeat(4000),
    '{('.repeat(2000) + 'a,b' + ')}'.repeat(2000),
    '{'.repeat(4000) + 'a',
  ];
  for (const method of methods) {
    for (const pattern of patterns) {
      assert.throws(() => braces[method](pattern), {
        name: 'SyntaxError', message: /maximum nesting depth/,
      });
    }
  }
});

test('braces guards caller-supplied ASTs and cyclic node graphs', () => {
  let ast = { type: 'text', value: 'a' };
  for (let i = 0; i < 5000; i++) ast = { type: 'root', nodes: [ast] };
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const method of ['stringify', 'compile', 'expand']) {
    for (const input of [ast, cycle]) {
      assert.throws(() => braces[method](input), {
        name: 'SyntaxError', message: /maximum nesting depth/,
      });
    }
  }
});

test('braces retains normal glob, range, quote and escape behavior', () => {
  assert.deepEqual(braces.expand('src/{app,lib}/{a,b}.ts'), [
    'src/app/a.ts', 'src/app/b.ts', 'src/lib/a.ts', 'src/lib/b.ts',
  ]);
  assert.deepEqual(braces.expand('file-{01..03}.txt'), ['file-01.txt', 'file-02.txt', 'file-03.txt']);
  assert.equal(braces.compile('src/{app,lib}/*.ts'), 'src/(app|lib)/*.ts');
  assert.equal(braces.stringify('"{quoted}"'), '{quoted}');
  const literal = '\\{'.repeat(200) + 'a' + '\\}'.repeat(200);
  assert.equal(braces.stringify(literal), '{'.repeat(200) + 'a' + '}'.repeat(200));
  const boundary = '{'.repeat(127) + 'a' + '}'.repeat(127);
  assert.equal(braces.stringify(boundary), boundary);
  assert.equal(braces.compile(boundary), boundary);
  assert.deepEqual(braces.expand(boundary), [boundary]);
});
