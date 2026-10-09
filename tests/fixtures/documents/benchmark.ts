// Time and memory of the document worker on the synthetic corpus (EF-10 ADR).
// Each fixture runs in a fresh Node process, exactly one job per worker as in
// production; RSS is sampled every 25 ms and includes the OCR WebAssembly heap.
// Usage: pnpm exec tsx tests/fixtures/documents/benchmark.ts
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { IMPORT_DOCUMENT_LIMITS } from '../../../packages/shared/src/imports';
import { buildDocumentCorpus, DOCUMENT_PASSWORD } from './build';

const worker = resolve('apps/next/workers/document-extract.mjs').replaceAll('\\', '/');
const probe = `
const { Worker } = require('node:worker_threads');
const bytes = require('node:fs').readFileSync(process.argv[1]);
const baseline = process.memoryUsage().rss; let peak = baseline;
const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
const started = performance.now();
const w = new Worker(${JSON.stringify(worker)}, { workerData: { bytes, type: process.argv[2], password: process.argv[3] || null, ocr: true, limits: ${JSON.stringify(IMPORT_DOCUMENT_LIMITS)} }, stdout: true, stderr: true });
w.stdout.resume(); w.stderr.resume();
w.on('message', m => { if (m.type === 'progress') return; clearInterval(timer); peak = Math.max(peak, process.memoryUsage().rss);
  console.log(JSON.stringify({ ms: Math.round(performance.now() - started), baseline: Math.round(baseline / 1048576), peak: Math.round(peak / 1048576), outcome: m.type === 'result' ? m.extraction.pages.map(p => p.method).join('+') : m.code }));
  void w.terminate(); });
`;
const types: Record<string, string> = { pdf: 'pdf', png: 'png', jpeg: 'jpeg', webp: 'webp' };
async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'ef10-bench-'));
  try {
  console.log(`Node ${process.version} · ${cpus()[0]?.model} · ${cpus().length} threads`);
  console.log('| Fixture | KiB | Resultado | Tempo (ms) | RSS pico (MiB) |\n| --- | --- | --- | --- | --- |');
  for (const [name, bytes] of await buildDocumentCorpus()) {
    const type = types[name.split('.').pop()!];
    if (!type || name === 'bomba-de-pixels.png') continue;
    const path = join(dir, name); writeFileSync(path, bytes);
    const output = await new Promise<string>(done => {
      const child = spawn(process.execPath, ['-e', probe, path, type, name.includes('protegido') ? DOCUMENT_PASSWORD : ''], { stdio: ['ignore', 'pipe', 'ignore'] });
      let text = ''; child.stdout.on('data', chunk => { text += chunk; }); child.on('close', () => done(text));
    });
    const result = JSON.parse(output.trim().split('\n').at(-1)!);
    console.log(`| \`${name}\` | ${Math.round(bytes.length / 1024)} | ${result.outcome} | ${result.ms} | ${result.peak} |`);
  }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
void main();
