import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// npm does not account for pnpm patches. Accept only this exact patched artifact,
// after checking its bytes and exercising the public signature verifier.
const require = createRequire(import.meta.url);
const patchedRsa = require.resolve('node-forge/lib/rsa.js');
const digest = createHash('sha256').update(readFileSync(patchedRsa)).digest('hex');
if (require('node-forge/package.json').version !== '1.4.0' ||
    digest !== 'c65caaa8c6e6a4ddb46721b518c4df8ddf6358eec3446587c2e9e54f66921412') {
  throw new Error('Unexpected node-forge artifact: audit must be reviewed before changing the pinned patch.');
}
const visited = new Set();
function verifyCopies(moduleRoot) {
  if (!existsSync(moduleRoot)) return;
  const real = realpathSync(moduleRoot);
  if (visited.has(real)) return;
  visited.add(real);
  for (const entry of readdirSync(moduleRoot, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
    const path = join(moduleRoot, entry.name);
    if (entry.name.startsWith('@')) { verifyCopies(path); continue; }
    if (entry.name === 'node-forge') {
      const bytes = readFileSync(join(path, 'lib/rsa.js'));
      if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Unpatched nested node-forge copy');
    }
    verifyCopies(join(path, 'node_modules'));
  }
}
for (const root of ['.', 'apps/expo', 'apps/next', 'packages/db', 'packages/shared']) verifyCopies(join(root, 'node_modules'));
execFileSync(process.execPath, ['--test', 'scripts/security/forge.test.mjs'], { stdio: 'inherit' });
let raw;
try {
  raw = execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['audit', '--json'], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, shell: process.platform === 'win32',
  });
} catch (error) {
  // Registry failures/non-JSON errors fail closed; only a complete audit is parsed.
  raw = error.stdout;
}
const report = JSON.parse(raw);
if (report.error || !report.metadata?.vulnerabilities || !report.advisories) throw new Error('Incomplete dependency audit');
let blocked = 0;
for (const advisory of Object.values(report.advisories)) {
  if (advisory.github_advisory_id === 'GHSA-86w9-cpqp-85rv' && advisory.module_name === 'node-forge' &&
      advisory.findings.length && advisory.findings.every(finding => finding.version === '1.4.0')) {
    console.log('CVE-2026-85393: installed pnpm patch verified by SHA-256 and malformed-signature regression.');
    continue;
  }
  console.error(`${advisory.severity}: ${advisory.module_name} (${advisory.github_advisory_id})`);
  blocked++;
}
if (blocked) process.exitCode = 1;
else console.log('No unremediated dependency advisories (production and development).');
