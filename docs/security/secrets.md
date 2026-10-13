# Segredos: inventário, rotação e revogação

Revisão da #37 em 13/10/2026. Responsável: mantenedor do repositório/operador da
instalação. Não guardar valores neste documento, issues ou logs. A aplicação
usa configuração protegida do servidor; bundles recebem somente configurações
públicas. O roteiro Cloud Run ainda depende de provisionamento, sem alegação
de que IAM ou Secret Manager tenham sido exercitados em produção.

## Inventário

| Credencial | Local / acesso necessário | Ciclo e revogação |
| --- | --- | --- |
| `AUTH_SECRET` | Somente servidor, mínimo 32 caracteres; erro de inicialização informa somente o nome/requisito. Cloud Run usa Secret Manager e versão explícita; runtime tem acesso apenas a esse secret. Desenvolvimento usa `.env` ignorado, nunca versão real no Git. | Gerar 32 bytes aleatórios; trocar versão e retirar revisões antigas; revogar sessões; desabilitar versão antiga após conferência. |
| Identidade Firestore/ADC | Runtime usa identidade de serviço/metadata; ferramentas locais usam ADC do operador. Caminho `GOOGLE_APPLICATION_CREDENTIALS` não é segredo público nem justificativa para versionar o arquivo. | Preferir credenciais curtas/WIF. Se houver chave histórica, desabilitar/apagar no IAM e remover concessões comprometidas, depois validar identidade substituta. |
| GitHub → GCP | OIDC/WIF limitado ao repositório, main, workflow e environment production; conta de deploy separada da de runtime. Sem chave JSON duradoura no GitHub. | Revogar binding/provider ou concessão da conta em incidente; reaprovar implantação. Nomes/IDs e `AUTH_SECRET_VERSION` são configuração, sem valor do segredo. |
| Senhas de usuário | Hash Argon2id no banco; entrada no login HTTPS ou JSON por stdin na CLI, sem argumento/URL. Não persistir senha no app. | Reset pelo operador revoga todas as sessões na mesma transação; usuário prova identidade antes. `auth:user` em autenticacao.md. |
| Cookie/token de sessão | Cookie HttpOnly/Strict/Secure remoto; token nativo assinado no SecureStore, por aparelho. Nunca AsyncStorage, query string, log ou bundle. | Seis horas absolutas; logout/revogação por sessão ou usuário; troca de senha/recuperação revoga. |
| SQL histórico (`DATABASE_URL`) | Apenas ferramenta offline de migração/recuperação e banco descartável de testes; sem driver SQL no runtime. | Conta operacional com escopo temporário; trocar credencial e encerrar conexões ao terminar ensaio/migração. Nunca publicar URL com senha. |
| Tokens do operador GitHub / provedores | Fora da aplicação, geridos pelo cliente/gerenciador autorizado. CI de PR não recebe segredos de produção. | Revogar no provedor e emitir credencial mínima. Não copiar token do cliente para .env do produto. |
| Credenciais legadas | Pluggy, `API_SECRET_KEY`, `EXPO_PUBLIC_API_SECRET` não são lidas; integrações retiradas. Gemini não é usado no runtime; assistência usa Ollama local sem chave. | Revogar qualquer chave legada que ainda exista no provedor; nova integração exige inventário, escopo e rotação próprios. |

Projetos demo de testes, desenvolvimento e produção não compartilham chaves.
O build injeta canários públicos aleatórios, sem ler segredos reais. Nunca usar
dados de produção no emulador nem conceder IAM de produção aos jobs de PR.

## Procedimento de rotação

1. Registrar somente identificadores de versão/revisão, responsável e motivo.
   Em suspeita de exposição, conter acesso e tirar tráfego das revisões antigas.
2. Gerar o novo valor diretamente no gerenciador protegido, sem argumento,
   histórico, saída de terminal ou arquivo versionado. Para Cloud Run, seguir
   a geração via pipe em [cloud-run.md](../deploy/cloud-run.md#5-secret-auth_secret).
3. Publicar revisão com versão explícita e conferir login/sessão na origem
   canônica. Retirar todas as revisões que ainda usam a chave antiga; trocar
   somente a chave não impede uma revisão antiga de aceitar suas assinaturas.
4. Revogar sessões persistidas e recuperar senhas comprometidas pelo operador.
   Para credenciais ADC/IAM, retirar concessões/chaves antigas no provedor.
5. Confirmar que token/cookie antigos falham e um novo login funciona. Conferir
   reconciliação financeira e replay idempotente. Desabilitar a versão antiga
   no Secret Manager após a validação, sem reutilizá-la num rollback.
6. Registrar resultado e tempo sem valores de credenciais. Seguir
   [recuperação](recovery.md) para incidente/restore; backups operacionais contêm
   hashes sensíveis e precisam de acesso restrito e proteção (#40).

Não imprimir `env`, payloads de login, cookies, headers Authorization ou URLs
de conexão. Logs do Better Auth ficam desativados; handlers retornam erros
estáveis. A trilha estruturada e retenção são tratadas separadamente na #39.

## Evidência automatizada

- `check-source.mjs` recusa .env/artefatos sensíveis versionados e acessos de
  cliente a credenciais do servidor; `policy.test.mjs` testa recusas.
- Gitleaks em histórico e árvore antes da instalação, com saída redigida.
  CodeQL e canários nos bundles web/Android/iOS complementam a detecção.
  Scanners mostram nomes de achados, nunca trechos/valores de credenciais.
- `secret-rotation.firebase.test.ts` retém o registro de sessão para provar
  isoladamente que trocar a chave recusa cookie/Bearer anteriores; chave nova
  permite novo login. Depois, reset revoga todas as sessões, senha anterior
  falha e finanças ficam idênticas. Ausência/segredo curto têm erro sem valor.
- O ensaio HTTP na imagem em `recovery-rehearsal.firebase.test.ts` exercita
  recuperação, nova senha/chave e replay único depois de restaurar o banco.

Executar com Firestore local e projeto demo: `pnpm test:firebase`,
`pnpm security:selftest`, `pnpm security:source`; o gate completo inclui
histórico e scans de todos os bundles. As credenciais do ensaio são sintéticas.
Rotação real de IAM/Secret Manager permanece um procedimento a executar na
instalação quando ela existir, sem simular uma comprovação em nuvem.
