import { readFile } from 'node:fs/promises';
import { migrate, readMigrations } from '../../packages/db/src/migrations';
import { hashPassword } from '../../apps/next/src/lib/password';
import { e2eDatabase } from './database';
import { TEST_PASSWORD, OWNER_A, OWNER_B } from './credentials';
export default async function setup() {
  const connection = e2eDatabase();
  try {
    await migrate(connection, await readMigrations('packages/db/migrations'));
    const [row] = await connection`SELECT count(*)::int AS count FROM users`;
    if (row!.count === 0) await connection.unsafe(await readFile('packages/db/tests/fixtures/recovery.sql', 'utf8'));
    const password = await hashPassword(TEST_PASSWORD);
    await connection.begin(async tx => {
      for (const [email, ownerId] of [['a@example.test', OWNER_A], ['b@example.test', OWNER_B]] as const) {
        const users = await tx`UPDATE users SET email=${email},email_verified=true WHERE id=${ownerId} RETURNING id`;
        if (users.length !== 1) throw new Error('Required synthetic owner is missing.');
        await tx`INSERT INTO auth_accounts(user_id,account_id,provider_id,password) VALUES(${ownerId},${ownerId},'credential',${password})
          ON CONFLICT(provider_id,account_id) DO UPDATE SET password=excluded.password`;
      }
      await tx`DELETE FROM auth_rate_limits`;
      await tx`DELETE FROM auth_sessions`;
    });
  } finally { await connection.end(); }
}
