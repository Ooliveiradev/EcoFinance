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
// Only fixed, secret-free reasons are printed: never the input, stack or driver message.
const REASONS: Record<string, string> = {
  'Email inválido.': 'email inválido', 'Senha deve ter de 12 a 128 caracteres.': 'a senha deve ter de 12 a 128 caracteres',
  'Nome deve ter de 1 a 120 caracteres.': 'o nome deve ter de 1 a 120 caracteres', 'Usuário não encontrado.': 'nenhum usuário com esse email (use sem --reset)',
  'Conta de senha não encontrada.': 'o usuário não tem login por senha', 'Proprietário inexistente ou já associado.': 'proprietário inexistente ou já associado',
  'Duplicate unique value.': 'já existe um usuário com esse email (use --reset para trocar a senha)', 'JSON inválido.': 'entrada inválida',
  'FIREBASE_PROJECT_ID and FIRESTORE_DATABASE_ID are required.': 'FIREBASE_PROJECT_ID e FIRESTORE_DATABASE_ID não definidos',
};
const GRPC: Record<number, string> = { 7: 'sem permissão no Firestore para esta conta', 16: 'credencial do Google ausente ou expirada (gcloud auth application-default login)', 5: 'banco Firestore não encontrado', 14: 'Firestore indisponível; tente de novo' };
main().then(() => process.exit(0)).catch((error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  const reason = error instanceof Error && REASONS[error.message] ? REASONS[error.message] : typeof code === 'number' && GRPC[code] ? GRPC[code] : 'erro inesperado';
  console.error(`Operação recusada: ${reason}. Nenhum segredo foi registrado.`);
  process.exit(1);
});
