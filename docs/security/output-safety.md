# Saídas e conteúdo não confiável

Revisão da #33 em 13/10/2026. Descrições, nomes, notas, arquivos e sugestões de
modelo continuam sendo dados, inclusive quando contêm sintaxe HTML ou fórmulas.
Não remover caracteres na persistência: isso corromperia descrições legítimas.
Aplicar proteção no contexto de saída, conforme o
[OWASP XSS Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

## Inventário de contextos

| Origem / destino | Tratamento e evidência |
| --- | --- |
| Contas, categorias, descrições e notas em lançamentos, planejamento, cartões, dashboard e relatórios web | JSX com strings e propriedades React; nenhum HTML de usuário. Nomes de categorias entram como texto inclusive em opções. Cores passam por schemas hexadecimais, sem CSS fornecido pelo usuário. |
| Nome de arquivo, descrição importada, erro e justificativa de sugestão em `imports/imports-client.tsx` e `import-review.tsx` | Texto JSX e `value` de inputs. O texto de um modelo não recebe confiança adicional; o teste injeta sugestão sintética persistida para verificar a leitura posterior. Arquivo original não é embutido em iframe nem servido como página. |
| Chat / Markdown | Chat desativado em `api/chat/route.ts` e `/ai`; não há renderizador Markdown nem conversão de texto de modelo em HTML. Reavaliar antes de habilitar chat, Markdown ou links extraídos de sugestões. |
| Telas nativas Expo | `Text`, `TextInput`, `FlatList` e componentes nativos, sem WebView/renderizador HTML. O gate nativo não substitui execução no iOS, ainda pendente na #13. |
| Preferências e bootstrap do tema | Única saída HTML bruta: constante estática `themeInitScript` em `app/layout.tsx`. `JSON.parse` e allowlist `light`/`dark`/`system`, sem interpolação de localStorage no código. Teste AST exige uma única inserção, somente dessa constante em `script`. |
| Links e navegação | Rotas internas escritas no código; identificadores UUID e competências validados. Não há transformação de notas/descrições em links. URL do backend passa por `backendOrigin`/validação nativa: HTTPS, sem credenciais, caminho, query ou fragmento; HTTP somente loopback/emulador. `access-policy.test.ts` testa rejeição de protocolos/destinos inválidos. |
| CSV de lançamentos e relatórios | `csvCell` em `packages/shared/src/metrics.ts` aplica quoting CSV e neutraliza início de fórmula, inclusive tab/CR e variantes Unicode. Números decimais exatos permanecem números (`-0.10`), sem conversão monetária para ponto flutuante. Regressões em `data-export.test.ts`, `metrics.test.ts` e `data.firebase.test.ts`. |
| Downloads CSV/JSON | `api/data/entries`, `api/reports/export`, `api/data/backup`: attachment, MIME correto, `nosniff`, nomes gerados por servidor com datas/enum validados. JSON serializado, sem inserção em script HTML. Original importado tem rota de exclusão, sem endpoint de visualização HTML. |

## Controles e procedimento

ESLint bloqueia `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML` e
`document.write` nos fontes web/nativos. O bootstrap estático tem exceção
limitada e testada. Não adicionar sanitizador para texto puro: o framework já
codifica esse contexto. Se um requisito futuro exigir HTML, documentar a
necessidade, adotar sanitizador mantido com allowlist explícita e acrescentar
testes do contexto, protocolos e atributos antes de alterar a restrição.

Antes de introduzir uma saída: identificar origem e contexto, escolher texto
por padrão, validar protocolos/destinos se houver link e executar os testes
com dados sintéticos. Novos exportadores de planilha devem compartilhar a
política de `csvCell`; quoting CSV sozinho não neutraliza fórmulas. A política
segue o [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection).
Uma planilha regravada por software externo pode remover proteções: qualquer
nova exportação pelo EcoFinance deve aplicar a política novamente.

## Validação reproduzível

`pnpm security:selftest`, `pnpm lint` e `pnpm typecheck` verificam restrições e
tipos. Após o build de produção, a CI executa `tests/e2e/output-safety.spec.ts`
com Firestore demo em Chromium, WebKit e viewport mobile. Os cenários usam
`img/onerror`, `svg/onload`, `javascript:` e fórmula `@SUM` em categorias,
descrições, notas, nome de arquivo, tema e sugestão persistida. Verificam texto
literal, ausência de execução/elementos ativos, cabeçalhos de download, fórmula
neutralizada e saldo exato de -0,30 após despesas de 0,10 e 0,20.

Os testes de parser já verificam que fórmulas/macros em planilhas não são
executadas. Testes nativos e análise estática complementam a matriz; não há
certificação de navegadores externos, aplicativo de planilha ou produção.
