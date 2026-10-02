import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'ecofinance_session';
export const SESSION_SECONDS = 6 * 60 * 60;

export function matchesCredential(received: string | null, secret: string | undefined): boolean {
  if (!received || !secret || secret.length < 32 || received.length > 256) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createSession(secret: string, now = Date.now()): string {
  if (secret.length < 32) throw new Error('API credential must have at least 32 characters');
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const signature = createHmac('sha256', secret).update(`ecofinance-session-v1:${expires}`).digest('base64url');
  return `${expires}.${signature}`;
}

export function validSession(token: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || secret.length < 32 || !token || !/^\d{10}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expires, signature] = token.split('.');
  const seconds = Math.floor(now / 1000);
  if (Number(expires) <= seconds || Number(expires) > seconds + SESSION_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`ecofinance-session-v1:${expires}`).digest('base64url');
  return timingSafeEqual(Buffer.from(signature!), Buffer.from(expected));
}
