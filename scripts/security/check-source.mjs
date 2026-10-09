import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { sourceFindings } from './policy.mjs';

const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const path of paths) {
  if (/(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.example')) findings.push(`${path}: environment file must not be committed`);
  if (/\.(?:pem|key|p12|pfx|keystore|jks|dump|backup|ofx|qfx)$/i.test(path)) findings.push(`${path}: sensitive artifact must not be committed (use synthetic inline fixtures)`);
  if (!/^(?:apps|packages)\//.test(path) || !/\.(?:[cm]?js|jsx|ts|tsx)$/.test(path) || /\.(?:test|spec)\./.test(path)) continue;
  const content = await readFile(path, 'utf8');
  for (const finding of sourceFindings(path, content)) findings.push(`${path}: ${finding}`);
}
// Never print source excerpts or credential values.
for (const finding of findings) console.error(finding);
if (findings.length) process.exitCode = 1;
else console.log(`Source privacy policy passed (${paths.length} tracked files).`);
