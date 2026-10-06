import '../src/env';
import { open, readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import postgres from 'postgres';
import { compareSnapshots, exportSnapshot, validateSnapshot } from '../src/portable-snapshot';

const [command, ...paths] = process.argv.slice(2);
const read = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
try {
  if (command === 'verify' && paths.length === 1) {
    validateSnapshot(await read(paths[0]!));
    console.log('PASS: schema, identities, exact totals, checksums and references.');
  } else if (command === 'compare' && paths.length === 2) {
    compareSnapshots(await read(paths[0]!), await read(paths[1]!));
    console.log('PASS: all records and migration history match.');
  } else if (command === 'export' && paths.length === 1) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required.');
    const path = resolve(paths[0]!);
    await mkdir(dirname(path), { recursive: true });
    const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      const snapshot = await exportSnapshot(sql);
      // Publish only a validated export; exclusive creation protects older files.
      const file = await open(path, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(snapshot)); await file.sync(); }
      finally { await file.close(); }
      console.log(`PASS: ${Object.keys(snapshot.tables).length} tables exported and verified locally.`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  } else {
    throw new Error('Usage: db:snapshot export <new-file> | verify <file> | compare <source> <target>');
  }
} catch {
  // Connection errors and row validation must never print credentials or data.
  console.error('Snapshot operation failed. Check command, source schema, access, output path and local artifact. Details were suppressed.');
  process.exitCode = 1;
}
