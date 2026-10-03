import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// npm does not account for pnpm patches. Accept only this exact patched artifact,
// after checking its bytes and exercising the public signature verifier.
const require = createRequire(import.meta.url);
// GHSA-vfj7-8cjw-p6xm has no published fixed version. Only these exact
// locally patched parser/walker artifacts may satisfy its audit finding.
const bracesHashes = {
  'compile.js': 'e722511d1aaa84a90adb218cdb88b6e19335e9108952fad3e7d871a43e80ba8f',
  'depth.js': 'd7d4378d940759628bb2af00bbc73c938c35a6108a3f23d5786d8b857279e93c',
  'expand.js': '7dd6bd80db9f5a8fc818973b47d6907268a204a378e9a5ba860532364996da6c',
  'parse.js': '54aec3fff0507cda73e2680aacde8d254472bea16da66514c49a25de630ff11c',
  'stringify.js': '061cbfc15ef7a65abd5130519ed394a1be0530f7f834e63a18ce897e36d20579',
};
function verifyBraces(path) {
  if (JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version !== '3.0.3') {
    throw new Error('Unexpected braces version: review the pinned security patch.');
  }
  for (const [file, expected] of Object.entries(bracesHashes)) {
    const bytes = readFileSync(join(path, 'lib', file));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error(`Unpatched braces artifact: ${file}`);
    }
  }
}
verifyBraces(join(require.resolve('braces/package.json'), '..'));
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
    if (entry.name === 'braces') verifyBraces(path);
    verifyCopies(join(path, 'node_modules'));
  }
}
for (const root of ['.', 'apps/expo', 'apps/next', 'packages/db', 'packages/shared']) verifyCopies(join(root, 'node_modules'));
execFileSync(process.execPath, ['--test', 'scripts/security/forge.test.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--test', 'scripts/security/braces.test.mjs'], { stdio: 'inherit' });
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
  if (advisory.github_advisory_id === 'GHSA-vfj7-8cjw-p6xm' && advisory.module_name === 'braces' &&
      advisory.findings.length && advisory.findings.every(finding => finding.version === '3.0.3')) {
    console.log('GHSA-vfj7-8cjw-p6xm: installed pnpm patch verified by SHA-256 and nesting regressions.');
    continue;
  }
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
