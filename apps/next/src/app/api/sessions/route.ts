import { db } from '@ecofinance/db';
import { authorize } from '@/lib/session';
import { readJson } from '@/lib/request-body';
import { PRIVATE_CACHE } from '@/lib/access-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access=await authorize(request);
  if(access.response) return access.response;
  const sessions=(await db.query('authSessions',{where:[{field:'userId',value:access.userId}],order:[{field:'createdAt',direction:'desc'}]})).map(({id,createdAt,expiresAt,userAgent})=>({id,createdAt,expiresAt,userAgent}));
  return Response.json({sessions},{headers:{'Cache-Control':PRIVATE_CACHE}});
}
export async function DELETE(request: Request) {
  const access=await authorize(request);
  if(access.response) return access.response;
  const value=await readJson(request,1024);
  if(value instanceof Response) return value;
  if(!value || typeof value!=='object' || !('id' in value) || typeof value.id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) return Response.json({error:'INVALID_INPUT'},{status:400});
  const id=value.id;
  const revoked=await db.transaction(async tx=> {
    const session=await tx.get('authSessions',id);
    if (!session || session.userId!==access.userId) return false;
    await tx.remove('authSessions',session.id);
    return true;
  });
  return Response.json({revoked:revoked},{status:revoked?200:404,headers:{'Cache-Control':PRIVATE_CACHE}});
}
