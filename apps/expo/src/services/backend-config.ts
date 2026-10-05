import * as SecureStore from 'expo-secure-store';

const CONFIG_KEY = 'ecofinance.session.v2';
const LEGACY_KEY = 'ecofinance.backend';
export type BackendConfig = { url: string; credential: string; userId: string };
export class SessionExpired extends Error {}
const listeners = new Set<() => void>();
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
export async function loadBackendConfig(): Promise<BackendConfig | null> {
  // Never reuse the pre-ownership global credential after this upgrade.
  await SecureStore.deleteItemAsync(LEGACY_KEY);
  const value = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!value) return null;
  try { return validateBackendConfig(JSON.parse(value)); }
  catch { await SecureStore.deleteItemAsync(CONFIG_KEY); return null; }
}
export async function saveBackendConfig(config: BackendConfig): Promise<void> {
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(validateBackendConfig(config)), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
export async function clearSession() {
  await SecureStore.deleteItemAsync(CONFIG_KEY);
  for (const listener of listeners) listener();
}
export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = await loadBackendConfig();
  if (!config) {
    for (const listener of listeners) listener();
    throw new SessionExpired('Entre novamente para continuar.');
  }
  if (!path.startsWith('/api/') || path.startsWith('//') || path.includes('..') || /[\\?#]/.test(path)) throw new Error('Endpoint inválido.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${config.credential}`);
  const response = await fetch(`${config.url}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(15000), credentials: 'omit', headers, redirect: 'error' });
  if (response.status === 401) {
    // An old request completing after a new login must not erase that session.
    const current = await loadBackendConfig();
    if (current?.credential === config.credential) await clearSession();
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
  if (all) {
    const result = await backendFetch('/api/auth/revoke-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!result.ok) throw new Error('Não foi possível revogar sessões. Tente novamente.');
  }
  try {
    const response = await backendFetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw new Error('Não foi possível sair no servidor. Tente novamente.');
    await clearSession();
  } catch (error) {
    if (!(error instanceof SessionExpired)) throw error;
  }
}
