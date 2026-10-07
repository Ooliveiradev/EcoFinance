import { db } from '@ecofinance/db';
import { financeRead } from '@/lib/finance-http';
import { loadImport } from '@/lib/import-store';
import { importIdSchema } from '@ecofinance/shared';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { const { id } = await context.params; return financeRead(request, owner => loadImport(db, owner, importIdSchema.parse(id))); }
