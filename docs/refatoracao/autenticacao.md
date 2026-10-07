# Autenticação, senhas e isolamento — EF-03 / SEG-02 / SEG-11

Decisão em 05/10/2026; persistência atualizada para Firebase em 06/10/2026. Nenhum dado real foi migrado. Este documento cobre #3, #29 e #36; não certifica produção nem encerra as demais issues de segurança.

## ADR: biblioteca e operação

Escolha: Better Auth 1.7.7, adaptador Firestore baseado na fábrica oficial e plugin Bearer com assinatura obrigatória. MIT, self-hostable, sem provedor pago. A biblioteca realiza login, validação das credenciais, cookies, sessões persistidas, troca de senha e revogação. O gateway restringe os endpoints publicados e os corpos de requisição.

Alternativas consideradas:

| Opção | Adequação à entrega |
| --- | --- |
| Better Auth | Adaptador Drizzle, UUIDs existentes, sessões revogáveis e Bearer para Expo no mesmo servidor |
| Auth.js | Integração web madura; o fluxo de senha e a sessão nativa exigiriam mais código específico nesta base |
| Keycloak/OIDC | Adequado para identidade centralizada/MFA, mas acrescenta um serviço operacional para a instalação pessoal |

Não usar implementação própria de hash/sessão nem chave compartilhada de instalação. O antigo API_SECRET_KEY deixou de autenticar qualquer endpoint. Cadastro público está desativado. Operador provisiona um usuário novo ou associa explicitamente um UUID legado após comprovar titularidade.

Fontes: [Drizzle](https://better-auth.com/docs/adapters/drizzle), [Bearer](https://better-auth.com/docs/plugins/bearer), [sessões](https://better-auth.com/docs/concepts/session-management), [Next](https://better-auth.com/docs/integrations/next).

## Política de sessão

- Expiração absoluta: **seis horas a partir do login**, validada no Firestore em cada consulta.

- Renovação automática e cache de cookie desativados. A atividade não prolonga a sessão. Não há prazo adicional de inatividade nesta instalação pessoal; reavaliar no gate de segurança para ambientes compartilhados.

- Cada login cria uma sessão distinta. O logout invalida a sessão atual; a opção sair de todos os dispositivos revoga todas.

- GET /api/sessions lista IDs, datas e identificação do dispositivo, sem tokens. DELETE /api/sessions recebe um ID; a exclusão exige simultaneamente ID e proprietário autenticado. Um ID de outro usuário responde 404.

- Troca de senha força revokeOtherSessions no servidor, independentemente do valor enviado pelo cliente. Recuperação pelo operador revoga todas as sessões em uma transação.

- Web: cookie HttpOnly, SameSite=Strict, Secure com AUTH_URL HTTPS. Senhas/tokens de sessão não aparecem no JSON público. O navegador não recebe set-auth-token.

- Expo: token assinado individual, obtido após email/senha, no SecureStore WHEN_UNLOCKED_THIS_DEVICE_ONLY; nunca AsyncStorage ou variável pública. A configuração antiga é apagada no upgrade.

- O app não segue redirects com credenciais. Um 401 apaga apenas a sessão correspondente, volta ao login e não reenvia mutações. Uma resposta antiga não apaga um login mais recente: leituras, comparação/exclusão e gravação no SecureStore são serializadas; logout conserva a identidade capturada no início. Falha de rede no logout não anuncia revogação e permite retry.

- A exclusão de sessão ocorre imediatamente no banco; não existe janela de cookie cache aceitando token revogado. Respostas privadas usam Cache-Control: private, no-store.

## Fronteiras de autorização

Proxy Next valida a sessão antes de páginas/APIs. SSR de dashboard, contas e lançamentos também exige sessão e filtra owner_id. Leitores compartilhados recebem proprietário separado dos filtros: IDs, conta, descrição, datas ou parâmetros de IA não escolhem o usuário.

Authorization presente remove Cookie antes da validação. Credencial inválida não herda uma identidade válida de cookie. Escritas com cookie exigem Origin exatamente igual a AUTH_URL; Origem opaca/hostil ou ausente é recusada. Bearer assinado permite clientes nativos sem Origin. A política CORS (allowlist exata com AUTH_URL, preflight e origens negadas) é uma camada separada, documentada em [cors.md](cors.md).

Os endpoints antigos de seed, Pluggy, notificações, Uber, nearby, importação OFX e sessão global respondem 401 sem sessão e 410 após autenticação. Não leem uploads nem escrevem dados: limite de upload efetivo zero até o staging EF-08. O chat legado responde 503 após autorização e não envia mensagens/dados a terceiros; assistência opt-in pertence à EF-11.

Login aceita no máximo 16 KiB reais, contando UTF-8 e corpos chunked. Cinco tentativas por minuto compartilham um contador transacional no Firestore, inclusive entre processos/réplicas. Spoofing de X-Forwarded-For não altera o bucket. A instalação pessoal privilegia falhar fechado; o limite global pode reduzir disponibilidade para vários usuários. Ingress confiável pode acrescentar limites por IP. Não se registram corpo, endereço IP, senha, token ou informação financeira nos novos handlers. Eventos/auditoria de segurança completa seguem #39.

## Inventário de senha e parâmetros

Os fluxos de criação, associação de proprietário, recuperação e troca de senha usam a mesma função de backend em password.ts. O Expo e a web enviam a senha apenas ao servidor da instalação, via HTTPS remoto, e não a persistem. A CLI recebe JSON em stdin; não aceita senha em argumento, variável de ambiente, URL ou arquivo de configuração.

Hash: biblioteca mantida @node-rs/argon2, algoritmo Argon2id v=19, memória 19.456 KiB, duas iterações, paralelismo 1, saída 32 bytes, salt aleatório individual. Os parâmetros seguem o mínimo da [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) e ficam codificados no hash para upgrades. A verificação usa a biblioteca; hash inválido falha fechado. Não se normaliza nem trunca a senha. Limite: 12–128 caracteres.

[Implementação e API da biblioteca](https://github.com/napi-rs/node-rs/tree/main/packages/argon2). Hashes são dados sensíveis: backups completos incluem auth_accounts e precisam de proteção operacional. Backups de configuração não contêm senhas de usuários. Fixtures usam somente valores sintéticos declarados como públicos.

## Provisionamento e recuperação

1. Configure FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID e ADC no servidor; configure AUTH_URL (URL canônica HTTPS; localhost/emulador HTTP apenas para desenvolvimento) e AUTH_SECRET aleatório com pelo menos 32 caracteres, exclusivo do servidor.

2. Faça backup, restaure e confira uma cópia isolada antes de migrar dados reais. Inicialize/importa o destino vazio com pnpm db:firebase conforme o runbook da #47. Migrações SQL anteriores permanecem congeladas para recuperação.

3. Provisione com JSON em stdin. Exemplo PowerShell que solicita senha sem ecoá-la nem gravá-la no histórico:

```powershell
$acesso = Get-Credential
@{ email = $acesso.UserName; password = $acesso.GetNetworkCredential().Password; name = 'Nome' } |
  ConvertTo-Json -Compress | pnpm auth:user
```

Para reivindicar um proprietário legado, substitua name por ownerId com o UUID cuja titularidade foi verificada. Proprietário inexistente/já associado e email repetido bloqueiam a transação.

Para recuperar acesso após verificação de identidade pelo operador:

```powershell
$acesso = Get-Credential
@{ email = $acesso.UserName; password = $acesso.GetNetworkCredential().Password; reset = $true } |
  ConvertTo-Json -Compress | pnpm auth:user
```

Email não é enviado a serviço externo; é o identificador local de login. Não há reset público sem transporte de email configurado. O operador deve ter acesso autorizado ao banco. O resultado informa apenas o UUID; erros não imprimem o JSON. No app, informe servidor/email/senha no login. Use a URL HTTPS acessível pelo aparelho; HTTP fora de localhost/emulador é recusado.

## Migração, rollback e evidências

0004 acrescenta email/verificação/imagem/updated_at aos usuários e quatro tabelas de autenticação. Usuários históricos conservam IDs, nome e dados financeiros; email NULL continua sem login até associação explícita. FKs de credenciais/sessões têm cascade exclusivamente para dados de acesso; FKs financeiras continuam restritivas. Não existe endpoint de exclusão de usuário.

Rollback de código deve manter a autorização por proprietário. **Não retornar à sessão/ingestão global antiga.** Desative acesso externo enquanto corrige o app ou restaure snapshot em ambiente isolado; a migration aditiva pode permanecer. Restaurar backup de sessões pode reativar credenciais revogadas: apague auth_sessions antes de reabrir acesso. Segredo de assinatura fica fora do backup SQL e precisa de procedimento próprio de recuperação/rotação (#37).

Validação reprodutível:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:coverage
$env:TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/postgres'
pnpm test:integration --coverage
pnpm security:selftest
pnpm security:source
pnpm security:audit
node scripts/security/build-with-canaries.mjs web
pnpm mobile:check
node scripts/security/build-with-canaries.mjs mobile
npx firebase-tools@15.32.1 emulators:exec --only firestore --project demo-ecofinance "pnpm test:firebase && pnpm test:e2e"
```

A suíte PostgreSQL cria e remove bancos próprios para legado/reversão. Auth e E2E exigem o emulador Firestore local com projeto demo-ecofinance; o setup recusa projeto real e provisiona somente fixtures sintéticas.

Casos cobertos: dois proprietários e IDs/filtros cruzados; credenciais ausentes/globais; cookie/Bearer e prioridade; expiração/replay/revogação/recuperação; CSRF; signup bloqueado; contador concorrente e corpo excedido; salt/hash/senha incorreta; storage seguro e redirects; ausência de replay no app. Builds Expo verificam bundles Android/iOS; validação nativa/aparelhos permanece na EF-13/EF-16. Resultados finais e commit ficam no PR.

## Conferência integral dos critérios

| Issue / critério | Implementação e evidência |
| --- | --- |
| #3 — biblioteca, sessão e credenciais por dispositivo | auth.ts, auth-schema.ts e este ADR; integração cria dois logins distintos e verifica assinatura |
| #3 — todas as leituras/mutações e IDOR | proxy.ts, session.ts, owned-queries.ts e consultas SSR; testes cruzam usuários/IDs/contas/filtros. Uploads, conectores e chat legados negam acesso antes de ler o corpo; não há exportação/arquivo financeiro publicado |
| #3 — cookie, CSRF, storage e remoção da chave global | access-policy.ts, gateway e backend-config.ts; integração HTTPS/CSRF e testes SecureStore; canários nos bundles web/Android/iOS |
| #3 — limites, logout e logs | request-body.ts e contador Firestore concorrente; uploads desativados; revogação imediata. Novos handlers não registram payloads/credenciais/dados financeiros |
| #3 — expiração sem envio duplicado e recuperação gratuita | testes de expiração e backendFetch sem replay; procedimento de operador acima. Onboarding leva ao login sem exigir banco/permissões |
| #29 — revisão e inventário de todos os fluxos | criação, associação, recuperação e troca de senha descritas acima; antiga credencial global removida da autenticação |
| #29 — hash adaptativo, salt e parâmetros | password.ts e password.test.ts; teste Firestore verifica Argon2id armazenado, sem texto puro |
| #29 — ausência em respostas/logs/configuração e fixtures reais | logger desativado, CLI stdin sem eco de input, gateway remove tokens; testes verificam JSON sem senha/token. Fixtures são exclusivamente sintéticas; hashes no backup SQL têm proteção operacional documentada |
| #29 — decisão e validação | ADR, referências, procedimento de recuperação e suítes sintéticas neste documento e no PR |
| #36 — revisão, prazo, inatividade e renovação | política explícita de seis horas, sem renovação e sem prazo adicional de inatividade; teste compara prazo antes/depois de uma consulta |
| #36 — logout, senha, dispositivo e revogação | gateway força revogação na troca; recuperação transacional; DELETE por ID/proprietário. Integração/E2E verificam replay negado e isolamento de dispositivos |
| #36 — cookie, storage, expiração e retorno ao login | cookie HTTPS seguro, SecureStore por aparelho, evento de expiração; testes de rede/replay e resposta antiga após novo login |
| #36 — decisão, procedimento e evidência | política, recuperação e rollback acima; testes usam bancos descartáveis, sem certificação de produção |

Resultados da entrega original #3: 50 testes unitários, 31 testes PostgreSQL e 66 E2E aprovados. Após #47: 20 testes Firebase, 78 E2E e reversão PostgreSQL aprovados, conforme firebase-migration.md. A cobertura das políticas de acesso, limites de corpo e contratos de consulta é 100% de linhas e branches; a cobertura unitária global é 98,68% de linhas / 92,48% de branches. O fechamento depende também de todos os jobs obrigatórios da CI do PR aprovados.
