import { db } from '@ecofinance/db';
import { financeError } from '@/lib/finance-http';
import { authorize } from '@/lib/session';
import { PRIVATE_CACHE } from '@/lib/access-policy';
import { exportBackup } from '@/lib/data-backup';
export const dynamic='force-dynamic';
/** Versioned backup of the authenticated owner only; never cached. */
export async function GET(request:Request) {
  try {
    const access=await authorize(request);if(access.response)return access.response;
    const backup=await exportBackup(db,access.userId);
    return new Response(JSON.stringify(backup),{headers:{
      'Content-Type':'application/json; charset=utf-8','Cache-Control':PRIVATE_CACHE,'X-Content-Type-Options':'nosniff',
      'Content-Disposition':`attachment; filename="ecofinance-backup-${backup.createdAt.slice(0,10)}.json"`,
    }});
  } catch(error) {return financeError(error);}
}
