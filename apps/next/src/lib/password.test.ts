import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';
describe('Argon2id password storage', () => {
  it('uses an individual salt and explicit adaptive parameters without reversible storage', async () => {
    const password = 'only-synthetic-data';
    const one = await hashPassword(password); const two = await hashPassword(password);
    expect(one).not.toBe(two); expect(one).not.toContain(password);
    expect(one).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword({password,hash:one})).toBe(true);
    expect(await verifyPassword({password:'incorrect',hash:one})).toBe(false);
    expect(await verifyPassword({password,hash:'invalid'})).toBe(false);
  });
});
