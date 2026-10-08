import { backendFetch, SessionExpired, type BackendQuery } from '../services/backend-config';

export type ApiErrorKind = 'offline' | 'expired' | 'conflict' | 'invalid' | 'not-found' | 'forbidden' | 'unavailable';
/** A classified failure. Screens show it as is; it never becomes an empty list or a zero total. */
export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status: number | null = null, public code: string | null = null) { super(message); }
}
const MESSAGES: Record<ApiErrorKind, string> = {
  offline: 'Sem conexão com o servidor.',
  expired: 'Sessão expirada. Entre novamente.',
  conflict: 'O registro foi alterado em outro dispositivo.',
  invalid: 'Confira os campos informados.',
  'not-found': 'Registro não encontrado.',
  forbidden: 'Acesso recusado pelo servidor.',
  unavailable: 'Servidor indisponível no momento.',
};
function kindFor(status: number): ApiErrorKind {
  if (status === 409 || status === 412) return 'conflict';
  if (status === 404) return 'not-found';
  if (status === 403) return 'forbidden';
  if (status === 429 || status >= 500) return 'unavailable';
  return 'invalid';
}
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof SessionExpired) return new ApiError('expired', error.message);
  // fetch rejects with TypeError for DNS/socket failures and with Abort/Timeout errors for the 15 s limit.
  const name = error instanceof Error ? error.name : '';
  if (error instanceof TypeError || name === 'AbortError' || name === 'TimeoutError') return new ApiError('offline', MESSAGES.offline);
  throw error;
}
export async function errorFromResponse(response: Response): Promise<ApiError> {
  const kind = kindFor(response.status);
  const body: unknown = await response.json().catch(() => null);
  const record = body && typeof body === 'object' ? body as { error?: unknown; message?: unknown } : {};
  const code = typeof record.error === 'string' ? record.error : null;
  const message = typeof record.message === 'string' && record.message ? record.message : MESSAGES[kind];
  return new ApiError(kind, message, response.status, code);
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: BackendQuery;
  body?: unknown;
  form?: FormData;
  /** Sent as `Idempotency-Key`; replays of one intent reuse the same key. */
  key?: string;
  /** Sent as `If-Match`; the server answers 409 when the record changed. */
  ifMatch?: string | null;
  /** Refuses to send when the signed-in account differs (offline replay). */
  userId?: string;
}
export async function apiRequest<T>(request: ApiRequest): Promise<T> {
  const headers: Record<string, string> = {};
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (request.key) headers['Idempotency-Key'] = request.key;
  if (request.ifMatch) headers['If-Match'] = `"${request.ifMatch}"`;
  let response: Response;
  try {
    response = await backendFetch(request.path, {
      method: request.method ?? 'GET', headers,
      body: request.form ?? (request.body === undefined ? undefined : JSON.stringify(request.body)),
    }, request.query, request.userId);
  } catch (error) { throw toApiError(error); }
  if (!response.ok) throw await errorFromResponse(response);
  try { return await response.json() as T; }
  catch { throw new ApiError('unavailable', 'Resposta inválida do servidor.', response.status); }
}
