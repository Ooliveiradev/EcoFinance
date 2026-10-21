import { ExternalAccountClient } from 'google-auth-library';

/**
 * Keyless Firestore access from Vercel Functions. Vercel has no Google metadata
 * server, so the deployment's OIDC token is exchanged through Workload Identity
 * Federation for a short-lived token of the runtime service account
 * (docs/deploy/vercel.md). No service account JSON key exists anywhere.
 */
const PROVIDER = /^projects\/\d+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/;
const SERVICE_ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;

// Vercel sends the token per request in x-vercel-oidc-token, exposed through the request
// context that @vercel/functions also reads; builds and `vercel dev` get VERCEL_OIDC_TOKEN.
export function vercelOidcToken(): string {
  const context = (globalThis as { [key: symbol]: { get?: () => { headers?: Record<string, string | undefined> } } | undefined })[Symbol.for('@vercel/request-context')];
  const token = context?.get?.()?.headers?.['x-vercel-oidc-token'] ?? process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error('Vercel OIDC token unavailable outside a Vercel request.');
  return token;
}

export function vercelFederatedAuth(env: NodeJS.ProcessEnv = process.env) {
  const provider = env.GCP_WORKLOAD_IDENTITY_PROVIDER, account = env.GCP_SERVICE_ACCOUNT_EMAIL;
  if (!provider && !account) return undefined;
  if (!provider || !PROVIDER.test(provider) || !account || !SERVICE_ACCOUNT.test(account))
    throw new Error('GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_SERVICE_ACCOUNT_EMAIL must both be valid.');
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/${provider}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${account}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: async () => vercelOidcToken() },
  });
  if (!client) throw new Error('Invalid external account configuration.');
  return client;
}
