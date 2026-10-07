import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { reviewImportItem } from '@/lib/import-store';
import { importIdSchema } from '@ecofinance/shared';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await context.params;
  return financeWrite(request, (owner, key, input, expected) => reviewImportItem(db, owner, key, importIdSchema.parse(id), importIdSchema.parse(itemId), expected, input));
}
