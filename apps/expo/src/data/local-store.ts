import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Every cached response and offline draft lives under a key namespaced by the
 * signed-in user. Nothing here holds credentials: those stay in SecureStore.
 */
const PREFIX = 'ecofinance.u.v1.';
const USER = /^[0-9a-f-]{36}$/i;

function userPrefix(userId: string) {
  if (!USER.test(userId)) throw new Error('Usuário local inválido.');
  return `${PREFIX}${userId.toLowerCase()}.`;
}
export function userKey(userId: string, name: string) {
  if (!/^[a-z0-9:._-]{1,120}$/i.test(name)) throw new Error('Chave local inválida.');
  return userPrefix(userId) + name;
}
export async function readLocal<T>(userId: string, name: string): Promise<T | null> {
  const key = userKey(userId, name);
  const value = await AsyncStorage.getItem(key);
  if (value === null) return null;
  try { return JSON.parse(value) as T; }
  catch { await AsyncStorage.removeItem(key); return null; }
}
export async function writeLocal(userId: string, name: string, value: unknown) {
  await AsyncStorage.setItem(userKey(userId, name), JSON.stringify(value));
}
export async function removeLocal(userId: string, name: string) {
  await AsyncStorage.removeItem(userKey(userId, name));
}
/** Logout: removes every cached response and draft of this user. */
export async function clearUserData(userId: string) {
  const prefix = userPrefix(userId);
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
/** A different person signing in on this device never sees the previous person's cache or drafts. */
export async function clearOtherUsers(userId: string) {
  const own = userPrefix(userId);
  const keys = (await AsyncStorage.getAllKeys()).filter(key => key.startsWith(PREFIX) && !key.startsWith(own));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
