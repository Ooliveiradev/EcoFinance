import * as SecureStore from 'expo-secure-store';

const CONFIG_KEY = 'ecofinance.backend';
export type BackendConfig = { url: string; credential: string };

export function validateBackendConfig(config: BackendConfig): BackendConfig {
  const url = new URL(config.url);
  const local = ['localhost', '127.0.0.1', '10.0.2.2', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('Use HTTPS para a API ou HTTP apenas no emulador local.');
  }
  if (config.credential.length < 32) throw new Error('A credencial deve ter pelo menos 32 caracteres.');
  return { url: url.origin, credential: config.credential };
}

export async function loadBackendConfig(): Promise<BackendConfig | null> {
  const value = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!value) return null;
  return validateBackendConfig(JSON.parse(value));
}

export async function saveBackendConfig(config: BackendConfig): Promise<void> {
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(validateBackendConfig(config)), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function backendFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = await loadBackendConfig();
  if (!config) throw new Error('Configure a conexão segura em Opções antes de conectar seu banco.');
  if (!path.startsWith('/api/') || path.startsWith('//')) throw new Error('Endpoint inválido');
  const headers = new Headers(init.headers);
  headers.set('x-api-secret-key', config.credential);
  return fetch(`${config.url}${path}`, { ...init, headers, redirect: 'error' });
}
