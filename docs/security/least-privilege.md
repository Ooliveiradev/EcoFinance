# Princípio do Menor Privilégio (#42)

PMP foi confirmado pelo mantenedor em 13/10/2026. A matriz cobre a arquitetura
atual Firestore/Better Auth, sem papel SQL no runtime. Responsável por revisar
concessões e aprovar exceções: mantenedor/operador da instalação. Reavaliar em
cada nova integração, dependência nativa, workflow ou identidade de serviço.

| Identidade / recurso | Permissão necessária | Negação / evidência |
| --- | --- | --- |
| Navegador e Expo → Firestore direto | Nenhuma | `firestore.rules` deny-all; emulador testa get/list/create/update/delete em finanças, usuários, sessões e metadados com anônimo e claims owner/admin. Admin SDK é uma fronteira diferente. |
| Usuário → backend financeiro | Sessão própria; leitura/mutação de registros do mesmo proprietário | Proxy e serviços passam proprietário separado dos filtros; IDs cruzados são negados. Sessão não concede provisionar usuários, mudar IAM ou usar conectores retirados. Casos em auth/manual-finance/imports/data/planning/cards `.firebase.test.ts` e E2E. |
| Runtime Next → banco | Dados do banco `ecofinance`, sem administração de projeto/IAM | Roteiro Cloud Run separa conta runtime da de deploy, limita `roles/datastore.user` ao banco e Secret Manager ao AUTH_SECRET. Configuração real de IAM exige auditoria própria; regras de cliente não restringem Admin SDK. |
| Operador de migração/recuperação | Acesso temporário a origem/destino/backup e schema necessário | Ferramentas offline sem endpoint público. PostgreSQL/PostGIS somente legado/reversão; nenhum papel SQL de aplicação é provisionado. Runner privilegiado não é a credencial de runtime; encerrar concessões/conexões após operação. |
| CI de PR | `contents: read`, sem credencial persistida no checkout nem segredo de produção | `workflow-permissions.test.mjs` exige esse limite e proíbe overrides de jobs. PR/fork não recebe OIDC de deploy. Scans rodam sem escrita de repositório. |
| Deploy GitHub | `contents: read`, `id-token: write` apenas no job main/production | Conta de deploy por WIF; não é runtime. Em 13/10/2026 a API confirmou default token read-only e impossibilidade de aprovar PR; production corrigido para revisor Ooliveiradev, somente main e sem bypass administrativo. O único mantenedor pode aprovar seu próprio deploy, decisão explícita para instalação pessoal. |
| Runtime → secret | Somente versão explícita de AUTH_SECRET | Sem chave de service account no bundle/container. Procedimento em secrets.md; IAM de produção deve ser conferido antes da publicação. |
| Backup/arquivo original | Operador autorizado ou proprietário autenticado no backend | Download privado, sem hosting público; originais retidos/excluídos por proprietário. Backup operacional usa arquivo novo 0600 no POSIX; no Windows, aplicar ACL NTFS do operador, sem afirmar que mode 0600 substitui ACL. Criptografia segue #40. |
| Android release | Internet; estado de rede para a pilha nativa; permissão de receiver próprio com nível signature do AndroidX | Imports usam document picker do sistema, sem acesso geral ao armazenamento. Removidos READ/WRITE_EXTERNAL_STORAGE, VIBRATE, SYSTEM_ALERT_WINDOW e USE_BIOMETRIC/USE_FINGERPRINT (SecureStore não usa `requireAuthentication`); app.json bloqueia também mídia ampla, câmera, áudio e localização. Guard verifica manifesto release já mesclado, incluindo dependências; só aceita exportados a MainActivity, componentes protegidos por `android.permission.DUMP` (ProfileInstallReceiver do AndroidX, acionável apenas por adb/Play) e o `CaptureListenerService` da captura opcional (#19), protegido por `BIND_NOTIFICATION_LISTENER_SERVICE`: só o sistema o vincula, depois que a pessoa concede acesso às notificações nas configurações do Android. Nenhuma `uses-permission` nova. |
| Android debug | Overlay do tooling e HTTP local quando necessário | Exceções em src/debug; não entram no manifesto release. Não publicar APK debug. |
| iOS | Seletor de documentos e armazenamento privado da aplicação | Sem módulo de câmera, microfone, GPS ou captura automática ativo. Export de JS não comprova entitlements/binário iOS; verificar no Mac antes de publicar (#13). |

## Verificação e limites

`pnpm security:selftest` verifica privilégios de workflows e negativos do guard
Android. A CI compila/linta o app debug, processa `:app:processReleaseMainManifest`
e executa `check-android-permissions.mjs`: o teste cobre o resultado do merger,
não apenas app.json. Nova permissão ou componente exportado exige justificativa
e alteração revisada da allowlist. Seleção de documentos é uma concessão do
sistema ao arquivo escolhido, sem varrer o armazenamento do aparelho.

`rules.firebase.test.ts` cobre seis famílias de coleções, três identidades e
cinco operações, sem permitir autoatribuição de papel. O
[relatório JSON](firestore-rules-audit.json) segue a skill
`firebase:firebase-security-rules-auditor` instalada nesta sessão:
escopo exclusivo da fronteira cliente. A negação total é compatível com o app,
porque só o backend autorizado acessa o banco. Limites/tipos/referências são
validados no servidor. A pontuação não certifica IAM ou produção.

Antes do primeiro deploy, comparar IAM efetivo do projeto/banco/contas/secrets
com esta matriz; conferir condições e testar acesso permitido ao banco alvo e
negado a outro banco/IAM/secrets. Não copiar políticas ou chaves reais para
issues públicas. Papéis automáticos de service agents do Firebase devem ser
distinguidos da identidade usada pela aplicação antes de remover concessões.
O provisionamento Cloud Run permanece pendente; não inferir IAM ativo a partir
dos comandos do runbook. A #42 só pode encerrar após fechar as lacunas efetivas
de permissões e registrar as evidências correspondentes.

Conferência de nuvem em 13/10/2026, somente leitura: getIamPolicy do projeto
foi permitido e mostrou papéis de service agents Firebase/Firestore, SDK/Admin
Auth/TokenCreator e um Owner humano. A tentativa de listar contas de serviço
retornou 403; não foi possível identificar/revisar integralmente as identidades
e seus usos. Nenhum binding ou dado financeiro foi alterado. Essa evidência
parcial não autoriza remover papéis automáticos nem encerrar a #42. É necessário
acesso de leitura IAM apropriado ou execução da conferência pelo operador antes
de definir a redução efetiva em nuvem.
