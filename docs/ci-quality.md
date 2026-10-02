# Qualidade e segurança de cada PR

A rotina toma os workflows do Quantia como referência e acrescenta o escopo do EcoFinance: monorepo pnpm, Next.js, Expo Android/iOS, contratos financeiros e PostgreSQL/PostGIS. Executa em **todo PR, inclusive draft e qualquer branch de destino**, push em main, merge queue, execução manual e segunda-feira às 06h de São Paulo. Não há filtro de caminhos, job opcional nem `continue-on-error`.

## Barreiras

| Check | Critério bloqueante |
| --- | --- |
| Types and zero-warning lint | Tipos das quatro workspaces e ferramentas de teste; ESLint na raiz sem erros nem avisos. |
| Unit tests and coverage | Vitest e testes dos scanners. Por arquivo: 90% de linhas/statements/funções e 85% de branches nos módulos compartilhados executáveis e parser OFX. Arquivos sem teste entram no denominador. |
| PostgreSQL migration and recovery | Suíte real em banco descartável, incluindo histórico/checksum, concorrência, rollback, compatibilidade legado; cobertura do runner de migração e repetição idempotente. pg_dump/pg_restore com assertivas sobre dados sintéticos. |
| Production web, bundle privacy and E2E | Build Next de produção com credenciais sintéticas, auditoria dos arquivos públicos, Playwright Chromium/WebKit e viewport mobile. Páginas, navegação, leitura efetiva das fixtures, autenticação das três rotas legadas protegidas, rejeição de payload inválido e seed desabilitado em produção. |
| Expo compatibility and Android/iOS bundle privacy | Compatibilidade das dependências com Expo e export das duas plataformas; scanner de todos os arquivos distribuídos. |
| Dependency vulnerability audit | `pnpm audit --audit-level=high`, incluindo dependências de desenvolvimento. Falha de rede/registro também bloqueia. |
| Git history, working tree and source privacy | Gitleaks no histórico alcançável e árvore, saída redigida. Política para arquivos de ambiente, material criptográfico, dumps/extratos e credenciais públicas/leituras privadas em módulos cliente. |
| Blocking CodeQL security and quality | JavaScript/TypeScript com security-extended e security-and-quality. Leitura local do SARIF: qualquer achado, inclusive suprimido, ou relatório incompleto bloqueia. O sucesso do analyzer não significa ausência de achados. |
| React Doctor | Varredura completa de cada app, bloqueando erros e avisos. Também exige zero achados fora de PR, pois a Action upstream é consultiva nesses eventos. |
| GitHub Actions validation | actionlint com validação de estrutura, expressões e ShellCheck no runner Linux. |
| **PR quality gate** | Só passa se **todos os dez grupos** acima forem `success`. Falha, cancelamento e job pulado bloqueiam. |

## Segurança da própria CI

Actions fixadas em SHA completo, checkout sem persistir credenciais, token apenas com `contents: read`, runners hospedados e timeouts, seguindo a [referência de segurança do GitHub](https://docs.github.com/en/actions/reference/security/secure-use). PRs de forks rodam sem chaves externas nem permissões de escrita. Não se usa `pull_request_target`. Instalação frozen-lockfile; canários aleatórios substituem chaves de servidor durante builds, e o scanner procura valores diretos, codificados, padrões de chaves privadas e JWT service_role. O export Expo limpa o cache Metro para recompilar os valores atuais; o build de segurança desativa dotenv do Expo. A Action React Doctor e sua CLI têm versões fixas; o gate adicional cobre o comportamento consultivo em push documentado pelo [React Doctor](https://www.react.doctor/docs/ci-and-prs/github-actions-setup). Gitleaks tem versão e SHA256 fixos; actionlint tem versão fixa verificada pelo Go checksum database.

Artefatos publicados são cobertura, relatório Playwright de testes sintéticos e SARIF, com retenção de sete dias. Dumps do banco e bundles não são publicados. Os scripts não carregam `.env` nem imprimem valores encontrados. Não usar dados financeiros reais nos testes.

Dependabot propõe atualizações semanais para dependências npm e Actions; atualizações continuam sujeitas às mesmas barreiras. Não existe merge automático.

## Tornar obrigatório no GitHub

O arquivo de workflow cria checks; **isso não impede merge sozinho**. Após publicar esta alteração e o primeiro run registrar o check, configurar um ruleset ativo em main:

1. Exigir PR e pelo menos uma aprovação humana.
2. Exigir o check **PR quality gate**, com a integração GitHub Actions como origem.
3. Exigir branch atualizada antes de merge, ou usar merge queue (evento `merge_group` já coberto).
4. Exigir resolução de conversas e descartar aprovações após novos commits.
5. Bloquear force-push/deleção e evitar bypass inclusive administrativo.
6. Exigir revisão de alterações em `.github/`, scanners, configs de testes/lint e lockfile. Definir CODEOWNERS com revisores reais quando o time estiver estabelecido.

Não alterar nem remover o próprio gate para contornar uma falha. Correções devem tratar a causa. Supressões, quando realmente justificadas, precisam ser específicas e revisadas; não há baseline de segredos nem exclusão ampla neste trabalho.

## Validação da branch isolada em 02/10/2026

O PR de CI parte da main publicada. A refatoração de ownership/modelo financeiro, correções de interfaces e ajustes de dependências presentes no checkout original ficaram fora desta branch. Não altera migrations SQL existentes nem migra banco real. Acrescenta runner transacional/checksum para executar o SQL existente nos testes, fixtures legadas e os checks.

- Instalação frozen-lockfile passou em Node 24.16.0/Windows; CI usa Node 22/Ubuntu 24.04.
- 19 testes unitários passaram: helpers, validação, OFX e histórico de migrações. Cobertura unitária de linhas/statements: 98,90%; funções: 100%; branches: 89,41%. Não é cobertura de toda a interface/API.
- Cinco testes de políticas/CLI de segurança passaram; incluem controles negativos, rejeição de artefatos ausentes e SARIF bloqueante.
- Workflow passou no actionlint Windows. ShellCheck será executado no runner Linux.
- A main apresenta três erros de tipagem em Badge outline, 17 erros e 15 avisos de lint. Os checks detectam essas falhas sem escondê-las.
- Os testes de PostgreSQL executados em bancos descartáveis encontraram a falta do schema extensions na migration inicial publicada. Correções de migrations que existem no checkout original ficaram fora do PR. Os testes de adoção/validação de legado também exigem tratar seus achados antes da aprovação.
- A checagem Expo, auditoria de dependências, Gitleaks, CodeQL, React Doctor, builds e E2E completos serão julgados pelo run remoto da branch; resultados da preparação no checkout com refatoração não são apresentados como aprovação desta branch.
- Na preparação inicial, a auditoria confirmou que EXPO_PUBLIC_API_SECRET era incorporada em ambos os bundles Hermes. O cache Metro é limpo para impedir que artefatos antigos escondam os canários atuais. A política de fonte detecta a mesma exposição na main.
- O Gitleaks marcou exemplos no histórico; seus valores não são publicados. Exigir triagem e supressões estritamente específicas quando forem comprovadamente exemplos públicos, sem excluir .env.example inteiro ou liberar credenciais.
- O debug.keystore versionado é rejeitado pela política conservadora. Confirmar se é apenas a chave padrão pública de desenvolvimento antes de tratar como vazamento de produção.
- A CI não comprova isolamento multiusuário nem execução nativa. Revisão humana e testes dessas propriedades continuam necessários antes de release.

Publicação em PR e configuração do check obrigatório são registradas na conversa de entrega. Um PR vermelho não será mesclado para contornar as barreiras.
## Comandos

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:coverage
pnpm security:selftest
pnpm security:source
pnpm audit --audit-level=high
pnpm mobile:check
node scripts/security/build-with-canaries.mjs web
node scripts/security/build-with-canaries.mjs mobile

# Apenas banco de testes descartável com PostGIS e permissão de criar bancos:
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/ecofinance_ci pnpm test:integration --coverage
# E2E exige DATABASE_URL de testes, migração e recovery.sql previamente carregadas:
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

Não há garantia de código perfeito. Cobertura não prova correção, SAST/segredos podem ter falsos negativos e a exportação Expo não compila APK/IPA nem testa dispositivo. Completar testes nativos, acessibilidade, isolamento de dados, jornadas novas, segurança de runtime e revisão humana conforme o produto evoluir.
