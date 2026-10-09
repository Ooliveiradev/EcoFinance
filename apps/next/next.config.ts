import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Admin and pipeline expressions must share one SDK instance. Bundling only
  // one side breaks the SDK's instanceof checks in production.
  serverExternalPackages: ['firebase-admin', '@google-cloud/firestore'],
  transpilePackages: ['@ecofinance/db', '@ecofinance/shared'],
  // The document worker (workers/document-extract.mjs) is a plain Node module loaded
  // by path at runtime, so its files and dependencies are traced explicitly into the
  // standalone output. Of the OCR language data, only Portuguese ships.
  outputFileTracingIncludes: {
    // Route keys are globs: "[id]" would be a character class, so match by prefix.
    '/api/imports/**': [
      './workers/document-extract.mjs',
      '../../node_modules/pdfjs-dist/package.json',
      '../../node_modules/pdfjs-dist/legacy/build/{pdf,pdf.worker}.mjs',
      '../../node_modules/pdfjs-dist/{standard_fonts,cmaps,wasm,iccs}/**/*',
      // Only the native canvas build installed for this platform exists on disk.
      '../../node_modules/@napi-rs/canvas*/**/*',
      '../../node_modules/tesseract.js/**/*',
      '../../node_modules/tesseract.js-core/**/*',
      '../../node_modules/@tesseract.js-data/por/{package.json,4.0.0_best_int/**/*}',
      '../../node_modules/{bmp-js,idb-keyval,is-url,whatwg-url,tr46,webidl-conversions,regenerator-runtime,wasm-feature-detect,zlibjs}/**/*',
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
