# EcoFinance

Gerenciador financeiro pessoal em evolução, com web Next.js, Expo e PostgreSQL/PostGIS. O [plano de refatoração](docs/refatoracao/plano.md) acompanha os critérios de cada entrega.

## Estado da implementação

- Modelo financeiro por proprietário, dinheiro exato, datas civis e migration aditiva com backfill auditado.
- Autenticação local por email/senha, sessões revogáveis por dispositivo e isolamento de dashboard/contas/lançamentos.
- Login web com cookie protegido; Expo com sessão no SecureStore; recuperação de acesso pelo operador sem serviço pago obrigatório.
- CI com tipos, lint, domínio, migrações/backup, E2E, builds, bundles e verificações de segurança.

Cadastro manual completo, planejamento, cartões, staging de importação multiformato e métricas finais seguem as próximas issues. As telas antigas ainda não comprovam esses fluxos. Os números atuais de saldo são snapshots legados; não equivalem ao novo saldo derivado de movimentos. O Expo conserva telas demonstrativas até a paridade financeira.

A ingestão imediata antiga (notificações, Uber, Pluggy, seed e OFX) está desativada. O chat externo está desativado até haver opt-in explícito e contratos autorizados. Nenhuma chave de Open Finance, IA externa ou conta paga é necessária para login, migrações e testes.

## Executar a instalação pessoal

Node >=22.13, pnpm 9.15, PostgreSQL com PostGIS. Consulte [.env.example](.env.example); mantenha os segredos somente no servidor.

```sh
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm dev
```

Configure AUTH_URL como a URL canônica da instalação e AUTH_SECRET aleatório de pelo menos 32 caracteres. Use HTTPS fora de localhost/emulador. O acesso público não permite cadastro automático. Provisione o primeiro login e eventual proprietário legado pelo [procedimento de autenticação](docs/refatoracao/autenticacao.md).

Não use db:push como release. Antes de migrar dados reais, faça backup e restauração isolada; forneça titularidade e fuso explícitos no backfill. [Migração do modelo](docs/refatoracao/modelo-financeiro.md).

No Expo, informe servidor/email/senha no login. A URL do servidor pode vir de EXPO_PUBLIC_API_URL; essa variável não contém senha nem token. Captura automática está desativada nesta transição. Bundles JS não comprovam execução nativa ou testes em aparelhos.

## Validação

```sh
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm security:selftest
pnpm security:source
pnpm security:audit
pnpm mobile:check
```

PostgreSQL descartável: TEST_DATABASE_URL para pnpm test:integration. E2E: TEST_E2E_DATABASE_URL para um banco local ecofinance_ci ou ecofinance_e2e_*; execute build web antes de pnpm test:e2e. Os testes usam fixtures sintéticas.

[CI e gates](docs/ci-quality.md), [baseline](docs/refatoracao/baseline.md), [autenticação/recuperação](docs/refatoracao/autenticacao.md).

## Organização

| Pasta | Responsabilidade |
| --- | --- |
| apps/next | Web, API, autorização e serviços de aplicação |
| apps/expo | Interface nativa e sessão segura |
| packages/shared | Contratos, dinheiro/calendário e regras puras |
| packages/db | Schema, constraints e migrations versionadas |

Issues concluídas são vinculadas no PR com Closes #N. Uma entrega parcial mantém a issue aberta. O checklist e a evidência, incluindo limites de validação, determinam o encerramento.

MIT. Nenhuma promessa de compatibilidade universal de arquivos ou captura automática antes dos respectivos testes.
