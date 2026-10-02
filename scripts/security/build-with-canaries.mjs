import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { serverCredentials } from './policy.mjs';

const scope = process.argv[2];
if (!['web', 'mobile'].includes(scope)) throw new Error('Expected web or mobile');
const env = { ...process.env };
for (const name of [...serverCredentials, 'EXPO_PUBLIC_API_SECRET']) {
  // Synthetic canaries, never production credentials. Keep DATABASE_URL for disposable E2E DB.
  if (name !== 'DATABASE_URL') env[name] = `ecofinance_ci_${name}_${randomBytes(16).toString('hex')}`;
}
env.DATABASE_URL = process.env.CI ? process.env.DATABASE_URL : 'postgresql://postgres:postgres@127.0.0.1:5432/ecofinance_ci';
if (!env.DATABASE_URL) throw new Error('CI requires a disposable DATABASE_URL');
env.NEXT_TELEMETRY_DISABLED = '1';
env.EXPO_NO_TELEMETRY = '1';
env.EXPO_NO_DOTENV = '1';
// Inherit terminal output; values are never logged by these scripts.
const filter = scope === 'web' ? '@ecofinance/next' : '@ecofinance/expo';
const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const build = spawnSync(command, ['exec', 'turbo', 'build', `--filter=${filter}`, '--force'], { env, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const scan = spawnSync(process.execPath, ['scripts/security/check-bundle.mjs', scope], { env, stdio: 'inherit' });
if (scan.error) throw scan.error;
process.exit(scan.status ?? 1);
