import { clearSession, loadBackendConfig, signOut } from '../services/backend-config';
import { clearOtherUsers, clearUserData } from './local-store';
import { listOutbox } from './outbox';

export async function activeUserId(): Promise<string | null> {
  return (await loadBackendConfig())?.userId ?? null;
}
/** After login: data of any previous account on this device is removed before the new one is shown. */
export async function prepareUser(userId: string) {
  await clearOtherUsers(userId);
}
export async function unsyncedCount(userId: string) {
  return (await listOutbox(userId)).length;
}
/**
 * Revokes the server session first. Only then cache and drafts are erased, so a
 * failed revocation (offline) can be retried without losing unsynced work.
 */
export async function logout(all: boolean) {
  const config = await loadBackendConfig();
  await signOut(all);
  if (config) await clearUserData(config.userId);
}
/**
 * Offline exit: erases this device's credential, cache and drafts without
 * contacting the server. The server session stays valid until it expires or is
 * revoked from another device.
 */
export async function forgetDevice() {
  const config = await loadBackendConfig();
  if (config) await clearUserData(config.userId);
  await clearSession();
}
