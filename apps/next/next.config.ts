import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Admin and pipeline expressions must share one SDK instance. Bundling only
  // one side breaks the SDK's instanceof checks in production.
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore'],
  transpilePackages: ['@ecofinance/db', '@ecofinance/shared'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
