import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { bearer } from 'better-auth/plugins';
import { db, authSchema, type Database } from '@ecofinance/db';
import { backendOrigin } from './access-policy';
import { hashPassword, verifyPassword } from './password';

export function createAuth(database: Database, origin: string, secret: string) {
  if (secret.length < 32) throw new Error('AUTH_SECRET requires at least 32 characters.');
  return betterAuth({
    appName: 'EcoFinance', baseURL: backendOrigin(origin), secret,
    database: drizzleAdapter(database, { provider: 'pg', schema: authSchema }),
    user: { fields: { name: 'displayName' }, deleteUser: { enabled: false }, changeEmail: { enabled: false } },
    emailAndPassword: {
      enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      expiresIn: 6 * 60 * 60, disableSessionRefresh: true,
      cookieCache: { enabled: false }, storeSessionInDatabase: true,
    },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 30,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: origin.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'strict', path: '/' },
      // Keep addresses out of the session records and don't trust forwarded
      // headers. The auth gateway below supplies its own rate-limit bucket.
      ipAddress: { disableIpTracking: true },
    },
    trustedOrigins: [backendOrigin(origin)],
    plugins: [bearer({ requireSignature: true })],
    logger: { disabled: true },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return instance ??= createAuth(db, process.env.AUTH_URL ?? 'http://localhost:3000', process.env.AUTH_SECRET ?? '');
}
