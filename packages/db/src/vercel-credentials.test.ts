import { afterEach, describe, expect, it, vi } from 'vitest';
import { vercelFederatedAuth, vercelOidcToken } from './vercel-credentials';

const provider = 'projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/ecofinance';
const account = 'ecofinance-runtime@ecofinance-912de.iam.gserviceaccount.com';
const context = Symbol.for('@vercel/request-context');

describe('Vercel workload identity federation', () => {
  afterEach(() => { delete (globalThis as Record<symbol, unknown>)[context]; vi.unstubAllEnvs(); });

  it('stays off without configuration so Cloud Run and local ADC keep working', () => {
    expect(vercelFederatedAuth({})).toBeUndefined();
  });

  it('refuses partial or malformed configuration instead of falling back to other credentials', () => {
    expect(() => vercelFederatedAuth({ GCP_WORKLOAD_IDENTITY_PROVIDER: provider })).toThrow();
    expect(() => vercelFederatedAuth({ GCP_SERVICE_ACCOUNT_EMAIL: account })).toThrow();
    expect(() => vercelFederatedAuth({ GCP_WORKLOAD_IDENTITY_PROVIDER: 'projects/x/../providers/y', GCP_SERVICE_ACCOUNT_EMAIL: account })).toThrow();
    expect(() => vercelFederatedAuth({ GCP_WORKLOAD_IDENTITY_PROVIDER: provider, GCP_SERVICE_ACCOUNT_EMAIL: 'evil@example.com' })).toThrow();
  });

  it('exchanges through STS and impersonates only the configured runtime account', () => {
    const client = vercelFederatedAuth({ GCP_WORKLOAD_IDENTITY_PROVIDER: provider, GCP_SERVICE_ACCOUNT_EMAIL: account })!;
    expect((client as unknown as { audience: string }).audience).toBe('//iam.googleapis.com/' + provider);
    expect(client.getServiceAccountEmail()).toBe(account);
  });

  it('prefers the per-request token and fails closed without one', () => {
    vi.stubEnv('VERCEL_OIDC_TOKEN', '');
    expect(() => vercelOidcToken()).toThrow();
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'build-token');
    expect(vercelOidcToken()).toBe('build-token');
    (globalThis as Record<symbol, unknown>)[context] = { get: () => ({ headers: { 'x-vercel-oidc-token': 'request-token' } }) };
    expect(vercelOidcToken()).toBe('request-token');
  });
});
