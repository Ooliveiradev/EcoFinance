import { db } from '@ecofinance/db';
import { DATA_LIMITS } from '@ecofinance/shared';
import { financeWrite } from '@/lib/finance-http';
import { previewRestore } from '@/lib/data-backup';
export const dynamic='force-dynamic';
/** Validates the backup against the current data in a rolled-back transaction. */
export async function POST(request:Request) {
  return financeWrite(request,(owner,_key,input)=>previewRestore(db,owner,input),200,DATA_LIMITS.backupBytes+4096);
}
