import { db } from '@ecofinance/db';
import { DATA_LIMITS } from '@ecofinance/shared';
import { financeWrite } from '@/lib/finance-http';
import { restoreBackup } from '@/lib/data-backup';
export const dynamic='force-dynamic';
/** Atomic replacement: Idempotency-Key plus If-Match with the revision shown in the preview. */
export async function POST(request:Request) {
  return financeWrite(request,(owner,key,input,expected)=>restoreBackup(db,owner,key,input,expected),200,DATA_LIMITS.backupBytes+4096);
}
