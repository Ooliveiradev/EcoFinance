import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sarifFindings } from './policy.mjs';
const root = process.argv[2];
if (!root) throw new Error('Expected SARIF directory');
const paths = (await readdir(root)).filter(path => path.endsWith('.sarif'));
if (!paths.length) throw new Error('No SARIF report produced');
let count = 0;
for (const path of paths) {
  const findings = sarifFindings(JSON.parse(await readFile(join(root, path), 'utf8')));
  count += findings.length;
  for (const finding of findings) console.error(`${path}: ${finding.ruleId ?? 'unknown rule'} (${finding.level ?? 'warning'})`);
}
console.log(`CodeQL: ${count} findings.`);
if (count) process.exitCode = 1;
