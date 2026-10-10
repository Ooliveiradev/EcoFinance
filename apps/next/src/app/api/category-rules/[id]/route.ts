import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { deleteRule } from '@/lib/category-rules';
import { fail } from '@/lib/finance-operation';
export const dynamic = 'force-dynamic';
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return financeWrite(request, (owner, key) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) fail('NOT_FOUND', 404, 'Regra não encontrada.');
    return deleteRule(db, owner, key, id);
  });
}
