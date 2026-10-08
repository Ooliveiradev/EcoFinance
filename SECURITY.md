# Política de segurança

## Como reportar uma vulnerabilidade

**Não abra issue pública para falhas de segurança.** Use o relato privado do GitHub:
aba **Security → Report a vulnerability** deste repositório
(<https://github.com/Ooliveiradev/EcoFinance/security/advisories/new>).

Inclua, se possível:

- componente afetado (web, API, app Expo, regras do Firestore, CI);
- passos para reproduzir com dados sintéticos;
- impacto esperado (ex.: acesso a dados de outro usuário, execução de código, vazamento de segredo).

Nunca envie dados financeiros ou pessoais reais, senhas ou tokens no relato.

## O que esperar

- Confirmação de recebimento em até 7 dias.
- Avaliação e plano de correção comunicados no próprio relato privado.
- Divulgação coordenada: o aviso público (GitHub Security Advisory) só é publicado depois da correção, com crédito a quem reportou, se desejado.

## Versões suportadas

Somente o branch `main` recebe correções de segurança.

## Escopo

Dentro do escopo: código deste repositório, workflows do GitHub Actions, regras e configuração do Firebase versionadas aqui.

Fora do escopo: ataques de negação de serviço volumétricos, engenharia social, vulnerabilidades em dependências sem caminho de exploração no EcoFinance (reporte ao projeto de origem) e instâncias auto-hospedadas por terceiros.

## Proteções do repositório

- Merge no `main` só por pull request, com o check "PR quality gate" verde, conversas resolvidas e aprovação do mantenedor (CODEOWNERS).
- `main` e tags não aceitam force-push nem exclusão.
- Workflows de forks exigem aprovação do mantenedor antes de rodar; actions fixadas por SHA; `GITHUB_TOKEN` somente leitura por padrão.
- Secret scanning com push protection, alertas e atualizações de segurança do Dependabot e CodeQL na CI.
