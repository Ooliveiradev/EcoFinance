import { db } from '@ecofinance/db';
import { provisionUser } from '../src/lib/provision-user';

async function main() {
  // Password arrives on stdin, never as argv, env, URL, or log output.
  if (process.stdin.isTTY) throw new Error('Envie JSON via stdin conforme docs/refatoracao/autenticacao.md.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4096) throw new Error('Entrada excede 4 KiB.');
    chunks.push(Buffer.from(chunk));
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || !('email' in value) || !('password' in value) ||
      typeof value.email !== 'string' || typeof value.password !== 'string') throw new Error('JSON inválido.');
  const record = value as Record<string, unknown>;
  if (record.ownerId !== undefined && (typeof record.ownerId !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.ownerId))) throw new Error('UUID inválido.');
  if (record.reset !== undefined && typeof record.reset !== 'boolean') throw new Error('reset inválido.');
  const id = await provisionUser(db, {
    email: value.email, password: value.password,
    name: typeof record.name === 'string' ? record.name : undefined,
    ownerId: typeof record.ownerId === 'string' ? record.ownerId : undefined,
    reset: record.reset === true,
  });
  console.log('Acesso provisionado; sessões anteriores revogadas quando aplicável. Proprietário:', id);
}
main().then(() => process.exit(0)).catch(() => {
  console.error('Operação recusada. Verifique formato, usuário, titularidade e banco. Nenhum segredo foi registrado.');
  process.exit(1);
});
