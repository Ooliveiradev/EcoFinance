# Dependências e cadeia de fornecimento (#41)

Responsável: mantenedor do repositório. Escopo: código, lockfile, imagens e Actions
deste repositório. A política não certifica infraestrutura externa ou instalações
de terceiros.

## Inventário reproduzível

`pnpm install --frozen-lockfile` instala as versões e integridades aprovadas.
`node scripts/security/inventory.mjs` produz JSON com hash SHA-256 do lockfile,
dependências diretas por workspace, todos os pacotes transitivos do lockfile,
Actions e imagens. O inventário inclui nomes de hooks de instalação das cópias
resolvidas; não publica comandos, variáveis, caminhos locais ou credenciais de URL.
Dependências opcionais de outra plataforma podem não ter cópia instalada: seus
pacotes continuam no inventário do lockfile, mas seus hooks precisam ser revisados
no tarball antes de habilitar essa plataforma. A CI publica o inventário por sete
dias. O lockfile versionado permite reproduzi-lo depois desse prazo.

Em 13/10/2026: 1.037 identidades de pacote, cinco workspaces, 38 referências a
Actions e duas etapas de imagem. Os números são uma fotografia; o JSON gerado no
head de cada PR é a evidência corrente.

Fontes: registro npm com integridade fixada, tarball SheetJS em `cdn.sheetjs.com`
com integridade no lockfile, pacotes locais `workspace:*`, Actions por SHA e imagens
por digest. Mudança de fonte, hook, mantenedor, permissões ou dependência direta
exige revisão do diff. Não executar `pnpm update --latest` ou alterar overrides
para silenciar um advisory. Patches locais ficam versionados e são verificados por
hash e testes de regressão; toda cópia resolvível deve corresponder ao patch.

## Triagem e correção

Desde a descoberta, os prazos máximos para corrigir ou conter são: crítica 24 h,
alta sete dias, moderada 30 dias e baixa 90 dias. Exploração ativa ou exposição de
segredo exige contenção imediata, independentemente da severidade. O mantenedor
registra advisory, caminho de dependência, versão, alcance, data de descoberta,
responsável e prazo no relato privado/PR; falhas exploráveis usam o canal de
[SECURITY.md](../../SECURITY.md). Esses prazos não liberam releases vulneráveis:
qualquer advisory não remediado bloqueia a CI, inclusive baixo/moderado.

Dependabot abre atualizações semanalmente para npm, Actions e Docker, sem merge
automático. A CI também roda semanalmente e em PR/push, falha com registro
indisponível ou relatório incompleto e inclui dependências de desenvolvimento.
O catálogo Expo decide as versões compatíveis do SDK; patches são permitidos,
minor/major do SDK e troca de Node LTS são decisões explícitas.

## Exceções limitadas a correções locais comprovadas

Não há dispensa para advisory sem mitigação. A reconciliação de npm audit aceita
somente os patches de `node-forge@1.4.0` e `braces@3.0.3` já verificados por bytes
e regressões, conforme [ci-quality.md](../ci-quality.md). O registro
[dependency-policy.json](../../scripts/security/dependency-policy.json) exige
justificativa, versão, responsável, data e expiração em até 30 dias. A aprovação
inicial expira em 12/11/2026 às 00:00 UTC; a auditoria bloqueia nesse instante.
Não existe renovação automática. O mantenedor verifica upstream, caminho de
exploração, bytes e regressões; remove o patch ao adotar uma versão corrigida ou
registra nova revisão justificada. Versão diferente, cópia sem patch, novo
advisory ou registro expirado nunca herda a aprovação anterior.

## Instalação e privilégios

Hooks são código de terceiros: executar instalação apenas em checkout confiável,
ambiente descartável e sem credenciais de produção. A CI usa token somente leitura,
sem credenciais persistidas pelo checkout, Actions por SHA e secrets sintéticos
nos builds. O deploy constrói a imagem antes de obter identidade temporária via
OIDC; só o job de deploy recebe `id-token: write`. Usuários não controlam comandos
ou argumentos dos scripts de instalação/auditoria. As limitações do sandbox
local não justificam adicionar credenciais a bundles ou subir privilégios da CI.

## Validação e manutenção

`pnpm security:selftest` verifica expiração, datas inválidas, justificativa,
duplicidades, inventário e remoção de credenciais de URL. `pnpm security:audit`
valida artefatos/patches e consulta advisories. O gate completo exige tipos, lint,
domínio, PostgreSQL/Firestore, E2E, imagem, builds Android/iOS, Android nativo,
privacidade, CodeQL e React Doctor. O PR que atualizar uma dependência preserva
essas evidências antes de integrar. Inventário e política são revistos em cada
atualização e pelo mantenedor na revisão mensal dos patches.

Referência: [OWASP — Vulnerable Dependency Management](https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html).
