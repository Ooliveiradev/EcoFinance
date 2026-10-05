import { db, authSessions, eq, and, desc } from '@ecofinance/db';
import { authorize } from '@/lib/session';
import { readJson } from '@/lib/request-body';
import { PRIVATE_CACHE } from '@/lib/access-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const access=await authorize(request);
  if(access.response) return access.response;
  const sessions=await db.select({id:authSessions.id,createdAt:authSessions.createdAt,expiresAt:authSessions.expiresAt,userAgent:authSessions.userAgent})
    .from(authSessions).where(eq(authSessions.userId,access.userId)).orderBy(desc(authSessions.createdAt));
  return Response.json({sessions},{headers:{'Cache-Control':PRIVATE_CACHE}});
}
export async function DELETE(request: Request) {
  const access=await authorize(request);
  if(access.response) return access.response;
  const value=await readJson(request,1024);
  if(value instanceof Response) return value;
  if(!value || typeof value!=='object' || !('id' in value) || typeof value.id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) return Response.json({error:'INVALID_INPUT'},{status:400});
  const deleted=await db.delete(authSessions).where(and(eq(authSessions.id,value.id),eq(authSessions.userId,access.userId))).returning({id:authSessions.id});
  return Response.json({revoked:deleted.length===1},{status:deleted.length===1?200:404,headers:{'Cache-Control':PRIVATE_CACHE}});
}
