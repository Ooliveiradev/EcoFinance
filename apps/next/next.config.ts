import type { NextConfig } from 'next';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The document extraction worker (workers/document-worker.mjs) runs in its own
 * thread and is not imported by the bundle, so file tracing cannot see it. It is
 * added to the standalone output together with every package it loads at runtime
 * (pdfjs, the canvas binding, Tesseract and the Portuguese model), resolved here.
 */
// `next build` and `next dev` run from apps/next; the config is transpiled to CommonJS.
const project = process.cwd();
function packageFolders(roots: string[]) {
  const seen = new Set<string>(), queue = roots.map(name => ({ name, from: project }));
  while (queue.length) {
    const { name, from } = queue.shift()!;
    let manifest: string;
    try { manifest = createRequire(path.join(from, 'noop.js')).resolve(name + '/package.json'); } catch { continue; }
    const folder = path.dirname(manifest); if (seen.has(folder)) continue; seen.add(folder);
    const json = JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
    for (const dependency of Object.keys({ ...json.dependencies, ...json.optionalDependencies })) queue.push({ name: dependency, from: folder });
  }
  return [...seen].map(folder => path.relative(project, folder).replaceAll('\\', '/') + '/**/*');
}
const documentReader = ['./workers/**/*', ...packageFolders(['pdfjs-dist', '@napi-rs/canvas', 'tesseract.js', '@tesseract.js-data/por'])];

const nextConfig: NextConfig = {
  output: 'standalone',
  // Admin and pipeline expressions must share one SDK instance. Bundling only
  // one side breaks the SDK's instanceof checks in production.
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore'],
  transpilePackages: ['@ecofinance/db', '@ecofinance/shared'],
  outputFileTracingIncludes: { '/api/imports/**': documentReader },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
