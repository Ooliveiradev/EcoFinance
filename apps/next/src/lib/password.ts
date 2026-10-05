import { hash, verify } from '@node-rs/argon2';

// Explicit Argon2id parameters. Hash encodes version/cost/salt for upgrades;
// each call obtains a random salt from the maintained library.
export function hashPassword(password: string) {
  return hash(password, {
    algorithm: 2, version: 1, // Argon2id, v=19; numeric API enums support isolatedModules.
    memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32,
  });
}
export async function verifyPassword({ password, hash }: { password: string; hash: string }) {
  try { return await verify(hash, password); }
  catch { return false; }
}
