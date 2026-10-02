# Primeiro incremento — base e migrações

Data: 02/10/2026. Base inicial: f0e085a. Escopo: #1 e preparação do caminho de migração da #2; funcionalidades financeiras novas continuam pendentes.

## Falhas anteriores às mudanças

- Instalação frozen-lockfile aprovada após permitir download dos pacotes ausentes do cache.
- Typecheck global falhava por três usos de Badge outline sem variante definida; não verificava o pacote db.
- Lint mobile falhava por ESLint ausente; web usava next lint depreciado.
- Build web falhava pelos tipos e, após sua correção, por cópias diferentes do React na renderização da página 404.
- Drizzle 0.39 no db e 0.44 no Next; dependências nativas e plugin expo-build-properties fora da matriz/composição do SDK 52.
- Banco não tinha runner versionado; db:push não instalava objetos geográficos; SQL original dependia de schema/search_path de extensões e convertia geography antes de definir SRID.

## Alterações

- Lint por ESLint flat config em todos os pacotes, regras de hooks e Next; typecheck também em db/scripts/testes.
- Drizzle alinhado; dependências Expo alinhadas ao bundledNativeModules do SDK 52; expo-font/build-properties declarados; bundles Android/iOS no comando build.
- React 19 no host web e resolução única do React 18 no Metro nativo. O app e o renderer web resolvem o mesmo caminho do React, removendo o erro de useRef no prerender.
- Runner de migrations com SHA-256, lock, transação e verificação de histórico; env explícito por workspace; SQL de bootstrap com adoção conservadora do db:push.
- Sete testes de helpers/histórico; seis cenários de integração PostgreSQL; CI com tipos/lint/testes/bundles/build e migração/restauração em PostGIS descartável.
- db:generate escreve drafts separados para não aplicar automaticamente o schema gerado sobre o legado.

## Evidências locais

Windows, Node 24.16.0, pnpm 9.15.0, Next 15.5.19, Expo 52.0.49, React Native 0.76.9.

| Verificação | Resultado |
| --- | --- |
| pnpm install --frozen-lockfile | Aprovado no baseline; lock atualizado junto às dependências e rechecado ao finalizar |
| pnpm typecheck | Aprovado nos quatro pacotes, incluindo scripts/testes db |
| pnpm lint | Aprovado sem erros; 13 avisos any preexistentes, a tratar com a substituição dos fluxos legados |
| pnpm test | 7 testes aprovados |
| pnpm mobile:check | Aprovado usando matriz local do Expo; endpoint remoto indisponível nesta execução |
| pnpm build | Next de produção e bundles Android/iOS aprovados com DATABASE_URL sintética; sem chaves externas |
| Smoke HTTP do build local | /api/health respondeu 200/ok e rota inexistente respondeu 404, sem falha de hooks; servidor temporário encerrado |
| Integração PostgreSQL e restauração | Executadas durante EF-02 em PostgreSQL 16 + PostGIS portátil; banco vazio/legado, concorrência, rollback, drift e pg_dump/pg_restore aprovados |
| Compilação/execução nativa e E2E | Pendentes; export de bundle não equivale a APK, build iOS ou jornada em aparelho |

O sandbox bloqueia subprocessos do esbuild/build com EPERM; testes/builds foram executados fora dessa restrição com autorização da revisão automática. Isso não foi contornado desativando verificações. Nenhum banco real foi acessado/migrado. CI remota não foi executada porque as mudanças ainda não foram publicadas.

## Pendências antes de concluir #1

- Job PostgreSQL validado localmente; confirmar sua execução no runner Linux remoto.
- Comprovar instalação/CI em checkout limpo no ambiente Linux configurado (Node 22); validação atual foi local Windows.
- Modelo com ownership/categorias e dinheiro/datas exatos implementado em EF-02; próxima etapa é sessão/autorização. Consulte modelo-financeiro.md para as evidências e o estado de entrega.

As fontes oficiais consultadas para a coexistência dos runtimes são [Next 15 e React](https://nextjs.org/blog/next-15) e [monorepos Expo](https://docs.expo.dev/guides/monorepos/). A correção efetiva foi verificada nos builds; validação nativa continua pendente.
