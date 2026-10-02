import { describe, expect, it } from 'vitest';
import { createSession, matchesCredential, validSession, SESSION_SECONDS } from './session';

const secret = 'synthetic'.repeat(8);
const now = Date.UTC(2026, 9, 2);
describe('web session privacy', () => {
  it('accepts the exact configured credential and fails closed for absent or short configuration', () => {
    expect(matchesCredential(secret, secret)).toBe(true);
    for (const value of [null, '', 'wrong', 'a'.repeat(257), 'é'.repeat(72)]) expect(matchesCredential(value, secret)).toBe(false);
    expect(matchesCredential(secret, undefined)).toBe(false);
    expect(matchesCredential('short', 'short')).toBe(false);
    expect(() => createSession('short', now)).toThrow();
  });
  it('signs a session without exposing the server credential', () => {
    const token = createSession(secret, now);
    expect(token).not.toContain(secret);
    expect(validSession(token, secret, now)).toBe(true);
    expect(validSession(token, 'different'.repeat(8), now)).toBe(false);
  });
  it('rejects tampering, expiry, malformed and far-future sessions', () => {
    const token = createSession(secret, now);
    expect(validSession(token, secret, now + SESSION_SECONDS * 1000)).toBe(false);
    expect(validSession(token, secret, now - 1000)).toBe(false);
    expect(validSession(token.replace(/.$/, '!'), secret, now)).toBe(false);
    expect(validSession(token, undefined, now)).toBe(false);
    expect(validSession(undefined, secret, now)).toBe(false);
    expect(validSession('invalid', secret, now)).toBe(false);
  });
});
