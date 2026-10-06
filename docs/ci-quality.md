# Qualidade e privacidade em cada PR

O workflow roda em todos os PRs, inclusive rascunhos/forks, pushes na main, merge queue, execução manual e revisão semanal. Não recebe segredos de produção, não usa pull_request_target e tem permissões de leitura. Actions usam SHAs fixos.

| Grupo | Critério obrigatório |
| --- | --- |
| Tipos e lint | TypeScript nos workspaces e ferramentas; ESLint sem erros nem avisos. |
| Unitários | Por arquivo: 90% de linhas/statements/funções, 85% de branches. Validação, OFX, migrações, sessão e transporte mobile; controles negativos dos scanners. |
| Banco | PostgreSQL/PostGIS descartável: concorrência, legado, preservação financeira, repetição, rollback, checksum, deduplicação, dump/restore e objetos espaciais. |
| Web | Produção, canários e scan dos arquivos públicos; Playwright Chromium/WebKit/mobile com dados sintéticos. Sessão, acesso anônimo, CSRF, páginas, navegação, fixtures e APIs. |
| Mobile | Compatibilidade Expo, exportação Android/iOS com cache limpo e canários, compilação e lint nativos Android. Sem credenciais de produção ou assinatura release. |
| Dependências | Produção e desenvolvimento: todos os advisories sem correção bloqueiam, inclusive moderados/baixos. Registro indisponível/relatório incompleto também bloqueia. |
| Segredos | Gitleaks no histórico alcançável e árvore limpa antes de instalar dependências, saída redigida; arquivos sensíveis e fronteira cliente/servidor. |
| CodeQL | security-extended e security-and-quality; qualquer resultado SARIF, inclusive suprimido, ou relatório incompleto bloqueia. |
| React Doctor | Varredura completa dos dois apps, zero erros/avisos; resultado completo também fora de PR. |
| Workflows | actionlint e ShellCheck no Linux. |
| **PR quality gate** | Os dez grupos devem ser success. Falhas, cancelamentos e jobs pulados bloqueiam. |

Artifacts de cobertura, Playwright e SARIF duram sete dias. Bancos, dumps e bundles não são publicados. Dependabot propõe atualizações semanais, sem merge automático.

## Correções auditáveis

Em 06/10/2026, a auditoria do PR de preparação da migração Firebase detectou
duas vulnerabilidades altas já presentes no lockfile da main: source-map-js
1.2.1 via magicast/coverage e compression 1.8.1 via Expo CLI. Overrides limitados
às versões afetadas adotam as correções upstream source-map-js 1.2.2
([GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)) e
compression 1.8.2
([GHSA-vc2v-76pw-4v95](https://github.com/advisories/GHSA-vc2v-76pw-4v95)).
Não há exceção de auditoria para esses advisories; instalação reproduzível,
auditoria, cobertura e builds devem validar o lockfile corrigido.

Atualizações corrigem Next, Drizzle, Expo e dependências transitivas. Overrides ficam no package.json/lockfile. Expo passou de SDK 52 para SDK 57; arquivos Android foram adaptados em separado, preservando recursos nativos. Releases precisam de assinatura própria.

node-forge@1.4.0 não publicou correção para [CVE-2026-85393](https://github.com/digitalbazaar/forge/issues/1149). O patch versionado exige um ou dois elementos no DigestAlgorithm ASN.1, eliminando a folga usada pela assinatura malformada. O teste reproduz a aceitação na versão original, rejeita na versão corrigida e aceita uma assinatura normal. O CI verifica SHA-256 do arquivo instalado e das cópias resolvíveis, além do teste público RSA. Somente GHSA-86w9-cpqp-85rv nessa versão e com esses bytes comprovados é reconhecido como corrigido localmente. Qualquer outro advisory ou patch ausente bloqueia. Uma release upstream exige revisar/remover o patch e a reconciliação, mantendo a regressão.

.gitleaksignore contém quatro fingerprints históricos imutáveis: uma chave fictícia de CI e três exemplos de JWT com header e literal `...`, sem payload/assinatura. Exemplos atuais foram esvaziados. Nenhum arquivo inteiro, nova ocorrência ou credencial real foi liberado. O debug.keystore versionado foi removido; chaves de desenvolvimento são geradas localmente.

## Operação e compatibilidade

Use Node 22.13+ e pnpm 9.15. Configure AUTH_SECRET somente no servidor, com pelo menos 32 caracteres aleatórios, e AUTH_URL como origem canônica HTTPS. O navegador usa email/senha e recebe cookie de sessão de seis horas, HttpOnly/SameSite strict/Secure em HTTPS. Páginas financeiras e APIs exigem sessão e proprietário; mutações com cookie exigem Origin correto. A credencial global API_SECRET_KEY deixou de autenticar qualquer rota. [Política, provisionamento e recuperação](refatoracao/autenticacao.md).

No mobile, informe URL HTTPS/email/senha no login; SecureStore mantém apenas a sessão assinada e revogável por aparelho. Nunca coloque segredos em EXPO_PUBLIC_* ou no bundle. HTTP só é permitido em loopback/emulador; redirecionamentos com credenciais são rejeitados. Conectores/webhooks/ingestão antigos estão desativados; não provisionar credenciais globais para reativá-los. Atualizar de SDK 52 exige recompilar o app nativo.

A migration 0001 cria extensions, adota geom, configura search_path, preenche geolocalização legada e verifica a preservação dos dados financeiros. 0002_external_id cria a unicidade necessária para imports/upserts; duplicatas existentes causam rollback e exigem reconciliação manual, sem apagar dados. O runner recusa alteração de migrations já registradas por checksum. Não execute testes em produção: eles criam/removem exclusivamente bancos descartáveis.

## Proteção e validação

O [ruleset ativo da main](https://github.com/Ooliveiradev/EcoFinance/rules/24392292) exige PR quality gate do GitHub Actions, branch atualizada, PR e resolução das conversas; bloqueia force-push/deleção, sem bypass. Revisores adicionais podem ser configurados quando houver um time. Um workflow sozinho não protege a branch.

Local em 02/10/2026: tipos e lint passaram; 28 unitários, cobertura de linhas 98,17%, funções 100%, branches 89,74%; dez testes de migração/planner e seis controles de segurança passaram. React Doctor sem achados nos dois apps. Builds Next/Android/iOS e scans de bundles passaram. O run remoto do PR é a evidência final de Linux, CodeQL, E2E e Android nativo.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm security:selftest
pnpm security:audit
pnpm security:source
pnpm mobile:check
node scripts/security/build-with-canaries.mjs web
node scripts/security/build-with-canaries.mjs mobile
# Banco descartável PostGIS com CREATE DATABASE:
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ecofinance_ci pnpm test:integration --coverage
# E2E exige banco local descartável; global setup migra/provisiona a fixture:
pnpm exec playwright install chromium webkit
TEST_E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ecofinance_ci pnpm test:e2e
```

Checks não garantem código perfeito. A autenticação individual e o isolamento seguem os critérios/evidências da EF-03; iOS nativo, aparelhos, integrações reais e novas jornadas precisam de validação específica antes de release. As demais issues de segurança exigem seus próprios critérios completos: scanners/auditoria não substituem MFA, rotação, ensaio operacional, monitoramento ou política de incidentes. A refatoração não commitada do checkout original foi preservada em separado.
