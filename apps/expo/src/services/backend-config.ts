import * as SecureStore from 'expo-secure-store';

const CONFIG_KEY = 'ecofinance.session.v2';
const LEGACY_KEY = 'ecofinance.backend';
export type BackendConfig = { url: string; credential: string; userId: string };
export class SessionExpired extends Error {}
const listeners = new Set<() => void>();
let storageQueue: Promise<void> = Promise.resolve();
// SecureStore has no compare-and-delete operation. Serialize access so expiry
// and logout cannot erase a login saved between a comparison and deletion.
function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.then(() => {}, () => {});
  return result;
}
export function onSessionExpired(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function validateBackendConfig(config: BackendConfig): BackendConfig {
  const url = new URL(config.url);
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use HTTPS ou HTTP no emulador local.');
  if (typeof config.credential !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9+/=_%~-]+$/.test(config.credential) ||
      !/^[0-9a-f-]{36}$/i.test(config.userId)) throw new Error('Sessão inválida.');
  return { url: url.origin, credential: config.credential, userId: config.userId };
}
async function readConfig(): Promise<BackendConfig | null> {
  // Never reuse the pre-ownership global credential after this upgrade.
  await SecureStore.deleteItemAsync(LEGACY_KEY);
  const value = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!value) return null;
  try { return validateBackendConfig(JSON.parse(value)); }
  catch { await SecureStore.deleteItemAsync(CONFIG_KEY); return null; }
}
export function loadBackendConfig() { return withStorage(readConfig); }
export async function saveBackendConfig(config: BackendConfig): Promise<void> {
  await withStorage(() => SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(validateBackendConfig(config)), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }));
}
export async function clearSession() {
  await withStorage(async () => {
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    for (const listener of listeners) listener();
  });
}
async function clearMatchingSession(expected: BackendConfig | null) {
  await withStorage(async () => {
    const current = await readConfig();
    if (current?.credential !== expected?.credential || current?.url !== expected?.url || current?.userId !== expected?.userId) return;
    await SecureStore.deleteItemAsync(CONFIG_KEY);
    for (const listener of listeners) listener();
  });
}
export type BackendQuery = Record<string, string>;
/**
 * `expectedUserId` binds a replayed request to the account that created it: an
 * offline draft of one user is never sent with another user's credential.
 */
export async function backendFetch(path: string, init: RequestInit = {}, query?: BackendQuery, expectedUserId?: string): Promise<Response> {
  const config = await loadBackendConfig();
  if (!config) {
    await clearMatchingSession(null);
    throw new SessionExpired('Entre novamente para continuar.');
  }
  if (expectedUserId !== undefined && config.userId !== expectedUserId) throw new SessionExpired('Esta alteração pertence a outra conta.');
  return fetchForSession(config, path, init, query);
}
async function fetchForSession(config: BackendConfig, path: string, init: RequestInit, query?: BackendQuery): Promise<Response> {
  if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('..') || /[\\?#]/.test(path)) throw new Error('Endpoint inválido.');
  // Query values are encoded here, so a path can never smuggle its own query or fragment.
  const search = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : '';
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${config.credential}`);
  const response = await fetch(`${config.url}${path}${search}`, { ...init, signal: init.signal ?? AbortSignal.timeout(15000), credentials: 'omit', headers, redirect: 'error' });
  if (response.status === 401) {
    // An old request completing after a new login must not erase that session.
    await clearMatchingSession(config);
    throw new SessionExpired('Sessão expirada. Entre novamente; nada foi reenviado.');
  }
  return response;
}
export async function signIn(urlValue: string, email: string, password: string) {
  const url = new URL(urlValue);
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) throw new Error('Use HTTPS ou HTTP no emulador local.');
  const response = await fetch(`${url.origin}/api/auth/sign-in/email`, {
    method: 'POST', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? 'Muitas tentativas. Aguarde um minuto.' : 'Não foi possível entrar. Verifique email, senha e conexão.');
  const data = await response.json();
  const credential = response.headers.get('set-auth-token');
  if (!credential) throw new Error('Servidor não retornou uma sessão.');
  await saveBackendConfig({ url: url.origin, credential, userId: data.user.id });
}
export async function signOut(all = false) {
  try {
    const config = await loadBackendConfig();
    if (!config) { await clearMatchingSession(null); return; }
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    if (all) {
      const result = await fetchForSession(config, '/api/auth/revoke-sessions', init);
      if (!result.ok) throw new Error('Não foi possível revogar sessões. Tente novamente.');
    }
    const response = await fetchForSession(config, '/api/auth/sign-out', init);
    if (!response.ok) throw new Error('Não foi possível sair no servidor. Tente novamente.');
    await clearMatchingSession(config);
  } catch (error) {
    if (!(error instanceof SessionExpired)) throw error;
  }
}
