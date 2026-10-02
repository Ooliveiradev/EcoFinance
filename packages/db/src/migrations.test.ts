import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pendingMigrations, readMigrations } from './migrations';

describe('migration history', () => {
  const first = { name: '0001_init.sql', checksum: 'first', content: 'SELECT 1;' };
  const second = { name: '0002_next.sql', checksum: 'second', content: 'SELECT 2;' };

  it('only applies the unapplied suffix', () => {
    expect(pendingMigrations([first, second], [first])).toEqual([second]);
    expect(pendingMigrations([first, second], [first, second])).toEqual([]);
  });

  it('rejects changed, missing and reordered applied migrations', () => {
    expect(() => pendingMigrations([first], [{ ...first, checksum: 'changed' }])).toThrow('history mismatch');
    expect(() => pendingMigrations([second], [first])).toThrow('history mismatch');
    expect(() => pendingMigrations([first, second], [second])).toThrow('history mismatch');
    expect(() => pendingMigrations([], [first])).toThrow('history mismatch');
  });

  it('normalizes checkout line endings and rejects duplicate versions', async () => {
    const taskTempRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(taskTempRoot, 'ecofinance-migrations-'));
    if (dirname(resolve(directory)) !== taskTempRoot) throw new Error('Temporary directory outside the intended root.');
    try {
      const path = join(directory, first.name);
      await writeFile(path, 'SELECT 1;\n');
      const lf = await readMigrations(directory);
      await writeFile(path, 'SELECT 1;\r\n');
      expect((await readMigrations(directory))[0]?.checksum).toBe(lf[0]?.checksum);
      await writeFile(join(directory, '0001_duplicate.sql'), 'SELECT 2;');
      await expect(readMigrations(directory)).rejects.toThrow('Duplicate migration version');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
