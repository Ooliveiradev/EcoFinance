# Rollback e recuperação de incidentes (#35, #44)

Responsável pela decisão, contenção e retomada: mantenedor da instalação. Na sua
ausência, um operador previamente autorizado com acesso ao runbook, à revisão
conhecida e ao armazenamento de backup. O plano é versionado no repositório;
mantenha uma cópia local/offline e uma cópia protegida fora do servidor afetado.
Não coloque senhas, tokens ou conteúdo financeiro no plano ou no relato público.

## Metas e gatilhos

Para instalação pessoal: **RPO máximo de 24 horas** e **RTO de 60 minutos** a partir
da detecção. São metas operacionais, não SLA ou garantia da hospedagem. O operador
precisa produzir backup pelo menos diariamente, verificar a idade do último
backup e ensaiar restauração antes de publicar a instalação. Sem backup recente,
registre a perda potencial e trate a meta como descumprida; não invente dados.
Antes de deploy/migração, faça um backup adicional e registre revisão, configuração
não secreta, versão dos secrets, data UTC e hash do artefato. Guarde backups em
armazenamento protegido fora da instância, com controle de acesso; a proteção
criptográfica e gestão das chaves seguem também #40.

| Cenário | Gatilho | Contenção e prioridade |
| --- | --- | --- |
| Deploy/configuração inválida | Login, leitura autenticada, isolamento ou smoke test falha | Não promover candidate; manter/repor revisão conhecida. `/api/health` isoladamente não comprova autenticação ou acesso ao banco |
| Indisponibilidade de app/provedor | Erros sustentados ou conexão recusada | Suspender deploys/escritas e diagnosticar app/configuração/rede/IAM; não restaurar dados só por falha de rede |
| Corrupção/migração incompatível | Totais, vínculos, revisão ou checksum divergem | Congelar escrita, preservar cópia do estado afetado e restaurar em destino novo ou aplicar forward fix auditado |
| Credencial comprometida | Token, senha ou identidade de serviço exposta | Bloquear acesso público quando necessário, revogar sessões e credenciais, rotacionar segredo/identidade, depois recuperar; não voltar segredo comprometido |

## 1. Conter e preservar evidência

1. Identifique instalação, horário UTC, último estado conhecido, revisão/imagem
   e versão de configuração/secret. Registre sintomas, sem copiar linhas privadas.
2. Suspenda promoções e escritas. No Cloud Run, o corte de acesso e o controle de
   tráfego estão em [cloud-run.md](../deploy/cloud-run.md#rollback); na instalação
   pessoal, pare o processo/container e mantenha backup da configuração protegida.
3. Capture backup consistente e logs mínimos do estado afetado. Não sobrescreva
   o último backup válido. O CLI nativo usa arquivo novo com permissão 0600 e
   destino novo/vazio; limites são 400 documentos e 8 MiB por transação. Bases
   maiores exigem exportação gerenciada, não divisão silenciosa da recuperação.
4. Verifique acesso ao backup e à revisão conhecida antes de interromper o
   serviço saudável. Não remover volumes, apagar banco ou alterar migrations
   publicadas como estratégia de rollback.

## 2. Voltar código e configuração

1. Compare o schema de dados com o esperado pela revisão conhecida. Se forem
   compatíveis, volte somente imagem/revisão e configuração aprovada; conserve
   dados atuais e recibos de idempotência. Registre digest/SHA e a decisão.
2. Se houver expansão/transformação, prefira forward fix compatível. Revert de
   Git ou troca de tráfego não desfaz migração. Migrations publicadas mantêm seus
   checksums; erro de compatibilidade bloqueia o runner.
3. Em Cloud Run, liste revisões e promova somente uma revisão verificada, conforme
   o runbook. Se precisar manter um secret recém-rotacionado, publique a imagem
   conhecida com essa versão nova em vez de voltar uma revisão que contém o
   segredo comprometido. A aprovação do environment permanece obrigatória.
4. Na instalação própria, inicie a imagem conhecida com configuração protegida
   correta e destino restaurado, teste sem tráfego público e só então repare o
   endpoint/proxy. Não colocar segredos em argumentos do operador ou em logs.
5. Teste login real, sessão, consulta financeira autenticada, outro proprietário,
   schema e totais. Liveness sem esses testes não autoriza retomar a instalação.

## 3. Recuperar dados e credenciais

1. Escolha backup íntegro e registre data/idade/perda potencial. Valide formato,
   hash, limites e referências; backup alterado é recusado. Não sobrepor o estado
   afetado: restaure em banco novo/vazio e conserve o original para investigação.
2. Use o backup nativo atual e código compatível. `pnpm db:firebase restore
   <backup.json>` reconcilia todos os registros restaurados. Sessões, verificações
   de acesso e claims de unicidade correspondentes são removidas; um token
   revogado não volta a funcionar porque estava no backup. Contas de login e
   recibos de operações financeiras são conservados.
3. Faça contagem por entidade/proprietário e concilie valores exatos, datas,
   vínculos, faturas, importações e revisões contra o backup. Dados restaurados
   não podem perder campos novos em uma conversão para o SQL histórico. A
   exportação SQL do schema manual v2 é recusada; não contorne essa proteção.
4. Em comprometimento, redefina a senha pelo operador e revogue as sessões do
   usuário (`auth:user`, procedimento em [autenticacao.md](../refatoracao/autenticacao.md)).
   Rotacione AUTH_SECRET, reinicie todas as instâncias com a mesma versão e
   desative/revogue o segredo/identidade anterior. ADC/OIDC não usa chave estática
   no cliente; revogar uma identidade comprometida é procedimento de IAM.
5. Exija novo login. Verifique que Bearer/cookie antigos e tokens de recuperação
   do backup não funcionam. Não publicar valores de senha, secret ou tokens na
   evidência do incidente.

## 4. Retomar sem duplicar

1. Faça primeiro leitura autenticada e confronte contagens/totais; um usuário não
   pode acessar dados de outro após restaurar.
2. Reenvie operações pendentes com os mesmos IDs de idempotência e revisões.
   Recibos restaurados retornam o resultado anterior; chave com payload diferente
   é recusada. Um lote confirmado não gera um segundo gasto.
3. Lotes em análise/revisão continuam sujeitos à revisão explícita; não confirmar
   automaticamente arquivos nem avançar fila só para limpar pendências.
4. Não há filas de Pluggy/Uber/email/notificações ativas nesta arquitetura. Sua
   futura introdução (#19) exige checkpoint, DLQ, idempotência e novo ensaio.
5. Reabra escritas e tráfego gradualmente após os testes. Acompanhe erros e
   restauração pelo controle de monitoramento da #43. Registre duração real,
   RPO observado, perdas, causa, responsável e melhorias; produza novo backup.

## Ensaio automatizado

O teste `packages/db/tests/recovery-rehearsal.firebase.test.ts` recusa destinos
fora de `demo-ecofinance`/loopback. Cria dois proprietários, login web/mobile,
lançamento manual, importação revisada/confirmada, recibo de idempotência e token
de recuperação, sempre sintéticos. Injeta configuração inválida e corrupção de
valor, recusa backup adulterado/destino ocupado, restaura em destino vazio,
concilia registros/centavos, invalida Bearer/cookie/tokens restaurados, troca senha
e AUTH_SECRET e reenvia a confirmação concorrentemente sem duplicar a operação.

Localmente, o ensaio usa a fábrica real de autenticação e os serviços de aplicação:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8085'
pnpm exec vitest run --config vitest.firebase.config.ts packages/db/tests/recovery-rehearsal.firebase.test.ts
```

Na CI Linux, o job de imagem executa o mesmo ensaio com `RECOVERY_IMAGE` apontando
para a imagem standalone produzida pelo Dockerfile: inicia containers Next.js
reais em loopback, recusa login do candidate mal configurado, preserva o serviço
conhecido, reinicia a imagem conhecida no mesmo endereço com o banco recuperado
e a configuração rotacionada, e verifica sessão, leitura financeira e confirmação
por HTTP. Os containers usam somente credenciais sintéticas e o emulador.

O artifact `recovery-evidence` registra modo, SHA da CI, duração, idade observada
do backup e ausência de operações duplicadas; não contém registros financeiros,
cookies, tokens ou senhas. O gate exige RPO/RTO dentro das metas. Repita o ensaio
em cada mudança de autenticação, schema, backup, importação ou deploy.

Limites: esse teste não certifica IAM, indisponibilidade regional, performance de
uma base maior que o limite atômico, restauração gerenciada em produção nem
publicação nas lojas. O Cloud Run desta instalação ainda depende do provisionamento
e da aprovação descritos no runbook. Antes de produção, ensaie também o destino
real com dados sintéticos, verifique backup periódico, monitoramento, operadores
e o armazenamento protegido. Mantenha #40/#43 e a validação mobile com seus
próprios critérios; não substitua essas entregas por este teste.
