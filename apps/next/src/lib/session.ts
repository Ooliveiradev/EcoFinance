import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth';
import { authHeaders, trustedMutation, PRIVATE_CACHE } from './access-policy';

export async function requestSession(request: Request) {
  return getAuth().api.getSession({ headers: authHeaders(request.headers), query: { disableCookieCache: true } });
}
export async function requirePageUser() {
  const session = await getAuth().api.getSession({ headers: authHeaders(await headers()), query: { disableCookieCache: true } });
  if (!session) redirect('/login');
  return session.user.id;
}
export async function authorize(request: Request) {
  if (!trustedMutation(request, new URL(getAuth().options.baseURL!).origin)) {
    return { response: Response.json({ error: 'INVALID_ORIGIN' }, { status: 403, headers: { 'Cache-Control': PRIVATE_CACHE } }) };
  }
  const session = await requestSession(request);
  if (!session) return { response: Response.json({ error: 'SESSION_EXPIRED' }, { status: 401, headers: { 'Cache-Control': PRIVATE_CACHE } }) };
  return { userId: session.user.id };
}
