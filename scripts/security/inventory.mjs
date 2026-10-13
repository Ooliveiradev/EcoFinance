import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
const publicIdentity = value => String(value).replace(/https?:\/\/[^\s)'"\]]+/g, match => {
  const url = new URL(match); return url.origin + url.pathname;
});

/** Lockfile identity, rather than a recursive installed tree, handles peer cycles. */
export function dependencyInventory(lock, workflows, dockerfile) {
  if (String(lock?.lockfileVersion) !== '9.0' || !lock.packages || !lock.importers) throw new Error('Unsupported lockfile; review the inventory generator.');
  const packages = Object.entries(lock.packages).map(([id, record]) => ({
    id: publicIdentity(id), integrity: record.resolution?.integrity ?? null,
    source: record.resolution?.tarball ? 'tarball' : 'registry',
  })).sort((a, b) => a.id.localeCompare(b.id));
  const workspaces = Object.entries(lock.importers).map(([path, importer]) => ({ path,
    direct: ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap(scope => Object.entries(importer[scope] ?? {}).map(([name, record]) => ({ name, scope, resolved: publicIdentity(record.version) }))),
  }));
  const actions = workflows.flatMap(({ path, content }) => [...content.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(match => ({ path, ref: match[1].replace(/^['"]|['"]$/g, '') })));
  const images = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map(match => match[1]);
  return { format: 'ecofinance-dependencies-v1', workspaces, packages, actions, images };
}

export function inventoryOf(root) {
  const raw = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const workflows = readdirSync(join(root, '.github/workflows')).filter(name => /\.ya?ml$/.test(name)).sort().map(name => ({ path: '.github/workflows/' + name, content: readFileSync(join(root, '.github/workflows', name), 'utf8') }));
  const result = dependencyInventory(parse(raw), workflows, readFileSync(join(root, 'Dockerfile'), 'utf8'));
  const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'];
  // Only lifecycle names are published, never local paths, script bodies or env.
  result.installScripts = [];
  for (const { id } of result.packages) {
    const split = id.lastIndexOf('@'), name = id.slice(0, split), version = id.slice(split + 1);
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) continue;
    for (const workspace of result.workspaces) {
      const file = join(root, workspace.path, 'node_modules', name, 'package.json');
      if (!existsSync(file)) continue;
      const metadata = JSON.parse(readFileSync(file, 'utf8'));
      if (metadata.version !== version) continue;
      const scripts = lifecycle.filter(key => Object.hasOwn(metadata.scripts ?? {}, key));
      if (scripts.length) result.installScripts.push({ id, scripts });
      break;
    }
  }
  return { ...result, lockSha256: createHash('sha256').update(raw.replace(/\r\n/g, '\n')).digest('hex') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(inventoryOf(process.cwd()), null, 2));
