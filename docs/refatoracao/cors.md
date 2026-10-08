# Política CORS e fronteiras de origem — SEG-13 (#38)

Decisão em 07/10/2026. Este documento cobre a #38. Ele registra a política implementada e as evidências com dados sintéticos. Não certifica produção nem audita o ingress de uma instalação real.

## Decisão

**Nenhuma origem de terceiros pode ler ou chamar a API pelo navegador.** A allowlist CORS tem uma única origem: a URL canônica `AUTH_URL`, onde a própria web é servida. As outras origens são recusadas com `403 ORIGIN_NOT_ALLOWED` antes de qualquer consulta de sessão.

| Item | Allowlist explícita | Fonte |
| --- | --- | --- |
| Origens | somente `AUTH_URL` normalizada (HTTPS; HTTP apenas em localhost/emulador) | `appOrigin()` em [auth.ts](../../apps/next/src/lib/auth.ts) |
| Métodos | `GET, HEAD, POST, PUT, PATCH, DELETE` | `CORS_METHODS` em [cors.ts](../../apps/next/src/lib/cors.ts) |
| Headers de requisição | `content-type, idempotency-key, if-match` | `CORS_REQUEST_HEADERS`, os mesmos enviados por [finance-client.ts](../../apps/next/src/lib/finance-client.ts) |
| Headers expostos | nenhum | o gateway de auth remove `Access-Control-*` do Better Auth |
| Credenciais | `Access-Control-Allow-Credentials: true` só com a origem exata da allowlist | `evaluateCors` |
| Cache do preflight | `Access-Control-Max-Age: 600` | `CORS_MAX_AGE` |

Regras invariantes, cobertas por testes:

- `*`, `null`, padrões (`https://*.dominio`), caminhos, query e credenciais na URL não entram na allowlist: `corsPolicy` lança erro.
- A origem só é devolvida em `Access-Control-Allow-Origin` depois de uma comparação exata de string com a allowlist. Não há reflexão do header recebido, comparação por sufixo nem normalização de maiúsculas. `https://app.exemplo.hostil` e `HTTPS://APP...` são recusadas.
- Origem negada não recebe nenhum header `Access-Control-*`. A resposta leva `Vary: Origin` e `Cache-Control: private, no-store`.
- `Authorization` não está na allowlist de headers. O navegador autentica apenas com o cookie HttpOnly `SameSite=Strict`. Bearer é exclusivo do cliente nativo.
- Páginas HTML não são recursos CORS. Um preflight para uma página é recusado, e respostas de página não recebem headers CORS. Uma origem estranha em uma página, por exemplo um POST de formulário hostil, também recebe 403.

Na prática, a web chama a API na mesma origem. Por isso o navegador não precisa de CORS nem envia preflight. Mesmo assim, a allowlist é explícita e testada: se `AUTH_URL` divergir da origem real, o erro aparece de imediato e a instalação falha fechada.

### Alternativas descartadas

| Opção | Motivo |
| --- | --- |
| Headers estáticos em `next.config` | São aplicados por caminho, sem validar a origem. Levam facilmente a `*` ou a uma origem fixa sem `Vary` |
| Variável de ambiente com origens extras | Nenhum consumidor atual precisa dela. Abriria uma fronteira configurável sem revisão. Ver “Condição para reavaliar” |
| Não implementar nada e depender da ausência de headers | Já bloqueava leitura cross-origin, mas não recusava explicitamente nem testava preflight. Além disso, o Better Auth emitia `Access-Control-Expose-Headers: set-auth-token` |

## Camadas independentes

CORS só controla se o **navegador** entrega a resposta a outra origem. Não é autenticação nem proteção CSRF: clientes nativos, `curl` e servidores ignoram CORS. As camadas rodam em sequência no [proxy.ts](../../apps/next/src/proxy.ts), e cada uma falha fechada de forma independente:

1. **CORS** (`evaluateCors`): uma origem presente e fora da allowlist recebe 403 `ORIGIN_NOT_ALLOWED`. O preflight é respondido aqui, sem sessão, porque o navegador não envia credenciais no preflight.
2. **Autenticação** (`requestSession`): sem sessão válida, a API responde 401 `SESSION_EXPIRED` e a página redireciona para `/login`. Com `Authorization`, o cookie é descartado (`authHeaders`).
3. **CSRF** (`trustedMutation`): escrita com cookie exige `Origin` exatamente igual a `AUTH_URL` e `Sec-Fetch-Site` diferente de `cross-site`. Sem Origin, responde 403 `INVALID_ORIGIN`. Bearer assinado dispensa Origin.
4. **Autorização por proprietário**: cada handler filtra por `ownerId` da sessão (#3).

O gateway [`/api/auth/[...all]`](../../apps/next/src/app/api/auth/[...all]/route.ts) mantém sua própria checagem de origem/`Sec-Fetch-Site`. Agora ele também remove headers `Access-Control-*` gerados pelo Better Auth, de modo que só a política do proxy decide CORS.

## Inventário de rotas e consumidores

Consumidores reais:

- **Web Next (navegador)**: páginas SSR e componentes cliente chamam `/api/...` com URL relativa, portanto na mesma origem (`fetch` em `finance-client.ts`, `card-client-utils.ts`, `planning/*`, `login/page.tsx`, `session-controls.tsx`, `settings-client.tsx`, `ai-client.tsx`).
- **Expo nativo (Android/iOS)**: não é navegador. Não há `react-native-web` nem alvo web no [app.json](../../apps/expo/app.json). Usa `Authorization: Bearer <token assinado>`, `credentials: 'omit'` e `redirect: 'error'` ([backend-config.ts](../../apps/expo/src/services/backend-config.ts)). Não envia Origin e não depende de CORS.
- **Máquina a máquina**: o Apps Script [`gas/uber-parser.js`](../../gas/uber-parser.js) chamava `/api/transactions/uber-webhook` com a chave global. A chave foi removida na #3 e o endpoint está desativado (410). Não há webhooks ativos.

| Rota | Métodos | Web (mesma origem) | Expo (Bearer) | Cross-origin |
| --- | --- | --- | --- | --- |
| `/api/auth/{sign-in/email, sign-out, revoke-sessions, revoke-other-sessions, change-password}` | POST | sim | sim | negado |
| `/api/auth/get-session` | GET | sim | sim | negado |
| `/api/health` | GET | sim (Configurações) | não usado hoje; público e sem dados | negado |
| `/api/accounts`, `/api/accounts/[id]` | GET, POST, PATCH | sim | não usado hoje | negado |
| `/api/categories`, `/api/categories/[id]` | GET, POST, PATCH | sim | não | negado |
| `/api/entries`, `/api/entries/[id]` | GET, POST, PATCH, DELETE | sim | não | negado |
| `/api/months/[month]/summary` | GET | sim | não | negado |
| `/api/cards`, `/api/cards/[id]`, `/api/cards/[id]/purchases`, `/api/cards/[id]/invoices/[month]` | GET, POST, PUT, PATCH | sim | não | negado |
| `/api/invoices/[id]/[action]` | GET, POST | sim | não | negado |
| `/api/recurrences`, `/api/recurrences/[id]` | POST, PATCH | sim | não | negado |
| `/api/occurrences/[id]/[action]`, `/api/occurrences/[id]/candidates` | GET, POST | sim | não | negado |
| `/api/planning/[month]`, `/api/planning/[month]/[action]`, `/api/planning/copy-preview` | GET, PUT, POST | sim | não | negado |
| `/api/sessions` | GET, DELETE | sim | aceita Bearer (coberto no e2e); sem tela hoje | negado |
| `/api/chat` | POST | sim (503 após autorização) | sim (503 após autorização) | negado |
| `/api/session`, `/api/seed`, `/api/pluggy/{token,sync,webhook}`, `/api/transactions/{notification,import-ofx,uber-webhook,nearby}` | conforme rota | desativadas: 401 sem sessão, 410 com sessão | Expo ainda chama `pluggy/token` e `pluggy/sync` e recebe 410 | negado |
| Páginas (`/`, `/accounts`, `/cards`, `/planning`, `/imports`, `/settings`, ...) | GET (+ POST de server action, se houver) | sim | não | negado; nunca recurso CORS |

Rotas de importação que a #8 vier a criar sob `/api/` herdam a mesma política sem alteração. Se um novo header de requisição for necessário (por exemplo, em upload), ele precisa entrar explicitamente em `CORS_REQUEST_HEADERS`, com teste.

## Procedimento

1. Defina `AUTH_URL` com a origem canônica exata servida ao navegador, por exemplo `https://financas.exemplo`. Ela é ao mesmo tempo a allowlist CORS, a origem confiável de CSRF e a `baseURL` do Better Auth. Um valor inválido derruba a requisição com 503. No Cloud Run, use a URL determinística `https://ecofinance-<PROJECT_NUMBER>.southamerica-east1.run.app` ou o domínio próprio. As outras URLs do serviço (legada e de tag) continuam fora da allowlist ([deploy/cloud-run.md](../deploy/cloud-run.md#auth_url-cors-e-as-urls-do-cloud-run)).
2. Com um proxy reverso ou ingress, mantenha o host público igual a `AUTH_URL` e **não** acrescente headers `Access-Control-*` no ingress, porque eles se sobreporiam à política da aplicação.
3. Para validar uma instalação, use apenas dados sintéticos:

```powershell
$base = 'https://financas.exemplo'
# Preflight de origem negada: 403 e nenhum Access-Control-*
curl.exe -s -i -X OPTIONS "$base/api/entries" -H 'Origin: https://hostil.exemplo' -H 'Access-Control-Request-Method: POST'
# Preflight da origem canônica: 204 com Allow-Origin exato e sem '*'
curl.exe -s -i -X OPTIONS "$base/api/entries" -H "Origin: $base" -H 'Access-Control-Request-Method: PATCH' -H 'Access-Control-Request-Headers: content-type'
# Header fora da allowlist: 403
curl.exe -s -i -X OPTIONS "$base/api/entries" -H "Origin: $base" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization'
```

### Condição para reavaliar

Abra uma nova decisão antes de adicionar origens se surgir um consumidor de navegador em outra origem, como Expo Web, um front-end em outro domínio ou uma extensão. Faça o mesmo se um provedor de webhook passar a ser reativado. A mudança deve:

- acrescentar origens exatas ao `corsPolicy([...])` no proxy, nunca padrões;
- revisar métodos e headers;
- manter o cookie `SameSite=Strict` ou justificar a mudança;
- incluir testes unitários e e2e para a nova origem.

Webhooks reativados continuam máquina a máquina: autenticam por assinatura própria do provedor, nunca por CORS.

## Validação

Testes unitários (vitest, sem rede):

- [cors.test.ts](../../apps/next/src/lib/cors.test.ts) cobre:
  - allowlist exata e congelada, com rejeição de `*`, `null`, padrões, HTTP remoto, caminho, query e credenciais;
  - listas explícitas de métodos e headers, sem `Authorization`;
  - preflight permitido com origem exata, credenciais, métodos, headers e `Max-Age`;
  - preflight negado para origens estranhas, opacas, parecidas ou com maiúsculas, e para método ou header fora da lista;
  - qualquer método de origem negada recusado;
  - requisição sem Origin entregue à autenticação, sem headers CORS;
  - varredura combinatória provando que `*` nunca aparece e que credenciais só acompanham a origem exata.
- [proxy.test.ts](../../apps/next/src/proxy.test.ts) cobre:
  - origem negada recusada antes de `requestSession`, inclusive em `/api/health`, `/api/auth/*`, `/login` e páginas;
  - preflight respondido sem sessão;
  - origem permitida que ainda exige sessão (401) e CSRF (`INVALID_ORIGIN`, `Sec-Fetch-Site: cross-site`);
  - Bearer sem Origin, que não recebe headers CORS nem dispensa a autenticação;
  - falha da sessão, que responde 503.
- `cors.ts` entrou no conjunto com limiar de cobertura por arquivo em `vitest.config.ts`.

E2E com o emulador Firestore e usuários sintéticos ([cors.spec.ts](../../tests/e2e/cors.spec.ts), em Chromium, WebKit e mobile):

- preflight permitido e preflight negado em `/api/entries`, `/api/auth/sign-in/email`, `/api/health` e `/accounts`;
- origem hostil com cookie válido não lê nem grava (403, nenhum header CORS, conta “Hostil” não criada);
- a origem canônica recebe `Access-Control-Allow-Origin` exato e `Vary: Origin`, enquanto a falta de Origin continua barrada pelo CSRF;
- o login não expõe `Access-Control-Expose-Headers` nem `set-auth-token` ao navegador;
- uma página real em `http://hostile.test` não consegue ler `/api/entries` nem `/api/health` com `credentials: 'include'`.

O teste existente de CSRF em `smoke.spec.ts` continua passando. A origem hostil agora é barrada já na camada CORS, e a origem ausente continua barrada pelo CSRF.

Comandos e resultados finais ficam no PR.
