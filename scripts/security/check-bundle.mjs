import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { bundleFindings } from './policy.mjs';

const scope = process.argv[2];
const roots = scope === 'web' ? ['apps/next/.next/static', 'apps/next/public']
  : scope === 'mobile' ? ['apps/expo/dist'] : [];
if (!roots.length) throw new Error('Usage: pnpm security:bundle web|mobile');
async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
}
let count = 0;
let failed = false;
for (const root of roots) {
  if (root.endsWith('/public')) {
    try { await stat(root); } catch (error) {
      if (error.code === 'ENOENT') continue; // Next public/ is optional.
      throw error;
    }
  }
  const files = await filesIn(root); // Missing artifacts are a failure, never a silent pass.
  if (!files.length && !root.endsWith('/public')) throw new Error(`Empty artifact directory: ${root}`);
  for (const file of files) {
    const content = (await readFile(file)).toString('utf8');
    count++;
    for (const finding of bundleFindings(content, process.env)) {
      console.error(`${file}: ${finding}`);
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
else console.log(`Client bundle privacy policy passed (${count} files).`);
