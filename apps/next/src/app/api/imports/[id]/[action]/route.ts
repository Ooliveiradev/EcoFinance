import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { cancelImport, mapImport, processImport,repeatImport } from '@/lib/import-store';
import { confirmImport, undoImport } from '@/lib/import-commit';
import { fail, operationId } from '@/lib/finance-operation';
import { importIdSchema } from '@ecofinance/shared';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await context.params;
  return financeWrite(request, (owner, key, input, expected) => {
    importIdSchema.parse(id);
    if (action === 'confirm') return confirmImport(db, owner, key, id, expected, input);
    if (action === 'undo') return undoImport(db, owner, key, id, expected, input);
    if (action === 'map') return mapImport(db, owner, key, id, expected, input);
    operationId(owner, key);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) fail('INVALID_INPUT', 400, 'Esta ação não aceita campos.');
    if (action === 'cancel') return cancelImport(db, owner, key, id, expected);
    if (action === 'repeat') return repeatImport(db, owner, key, id, expected);
    if (action === 'process') return processImport(db, owner, id, expected);
    return Promise.resolve(fail('NOT_FOUND', 404, 'Ação não encontrada.'));
  });
}
