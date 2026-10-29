import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { setExternalAssist } from '@/lib/category-rules';
export const dynamic = 'force-dynamic';
/** `{ enabled }`: the user's opt-in to the external assistant (#11); the key never leaves the server. */
export async function PUT(request: Request) { return financeWrite(request, (owner, key, input) => setExternalAssist(db, owner, key, input)); }
