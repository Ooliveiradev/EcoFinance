import { authorize } from '@/lib/session';
import { PRIVATE_CACHE } from '@/lib/access-policy';
export async function POST(request: Request) {
  const access = await authorize(request);
  if (access.response) return access.response;
  // External assistance requires the explicit opt-in workflow of EF-11.
  // Do not read the body or forward financial data to a third party here.
  return Response.json({ text: 'Assistência desativada durante a migração. Consulte seus lançamentos na aplicação.' }, {
    status: 503, headers: { 'Cache-Control': PRIVATE_CACHE },
  });
}
