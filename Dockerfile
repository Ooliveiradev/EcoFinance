# EcoFinance web/API (apps/next) para Cloud Run. Runbook: docs/deploy/cloud-run.md
# As duas etapas usam a mesma imagem fixada por digest; o Dependabot (docker)
# propõe a atualização do digest por PR.

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
ENV CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
# pnpm na versão de packageManager (package.json), via Corepack.
RUN corepack enable
# Manifestos primeiro para reaproveitar a camada de dependências. Com
# node-linker=hoisted o pnpm instala o lockfile inteiro mesmo com --filter.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/next/package.json apps/next/
COPY apps/expo/package.json apps/expo/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
# Mesmo build da CI: canários sintéticos no ambiente e varredura do bundle do
# cliente. Nenhum segredo real entra na imagem; a configuração vem do Cloud Run.
RUN mkdir -p apps/next/public \
 && node scripts/security/build-with-canaries.mjs web

FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
WORKDIR /app
# O runtime só executa server.js: sem npm/npx/corepack na imagem final.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
# Só o standalone, com static e public. Arquivos ficam com dono root e somente
# leitura para o processo; o cache do Next é o único diretório gravável.
COPY --from=build /repo/apps/next/.next/standalone ./
COPY --from=build /repo/apps/next/.next/static ./apps/next/.next/static
COPY --from=build /repo/apps/next/public ./apps/next/public
RUN mkdir -p apps/next/.next/cache && chown node:node apps/next/.next/cache
USER node
EXPOSE 8080
# O Cloud Run ignora HEALTHCHECK (usa probes próprios); vale para docker run local e CI.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/next/server.js"]
