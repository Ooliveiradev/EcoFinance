# Como Contribuir com o EcoFinance

Obrigado por se interessar em contribuir! 🎉 Este documento descreve como você pode participar do desenvolvimento do EcoFinance.

## Índice

- [Código de Conduta](#código-de-conduta)
- [Como reportar um bug](#como-reportar-um-bug)
- [Como sugerir uma feature](#como-sugerir-uma-feature)
- [Setup de desenvolvimento](#setup-de-desenvolvimento)
- [Fluxo de Pull Request](#fluxo-de-pull-request)
- [Convenção de commits](#convenção-de-commits)
- [Estrutura do projeto](#estrutura-do-projeto)

---

## Código de Conduta

Este projeto adere ao nosso [Código de Conduta](./CODE_OF_CONDUCT.md). Ao participar, você concorda em respeitá-lo.

---

## Como Reportar um Bug

1. Verifique se o bug já não foi reportado em [Issues](https://github.com/your-username/EcoFinance/issues)
2. Abra uma nova issue com o template **Bug Report**
3. Inclua:
   - Descrição clara do problema
   - Passos para reproduzir
   - Comportamento esperado vs. atual
   - Screenshots se aplicável
   - Versão do Node.js, SO e navegador

---

## Como Sugerir uma Feature

1. Abra uma issue com o template **Feature Request**
2. Descreva o problema que a feature resolveria
3. Sugira como você implementaria
4. Aguarde feedback antes de começar a codificar

---

## Setup de Desenvolvimento

Veja o [README.md](./README.md) para o guia completo de instalação. Resumo:

```bash
# Pré-requisitos: Node.js >= 20, pnpm >= 9, Docker

git clone https://github.com/your-username/EcoFinance.git
cd EcoFinance

# 1. Copiar e preencher variáveis de ambiente
cp .env.example .env

# 2. Subir banco de dados local
docker compose up -d

# 3. Instalar dependências
pnpm install

# 4. Aplicar schema do banco
pnpm db:push

# 5. (Opcional) Popular com dados de demonstração
curl -X POST http://localhost:3000/api/seed

# 6. Rodar em modo desenvolvimento
pnpm dev
```

---

## Fluxo de Pull Request

1. **Fork** o repositório
2. Crie uma branch a partir de `main`:
   ```bash
   git checkout -b feat/minha-feature
   # ou
   git checkout -b fix/meu-bugfix
   ```
3. Faça suas alterações seguindo as convenções abaixo
4. Certifique-se que o typecheck passa: `pnpm typecheck`
5. Abra um Pull Request com:
   - Título descritivo
   - Descrição do que foi feito e por quê
   - Screenshots se houver mudanças visuais

### Regras de PR

- PRs devem apontar para a branch `main`
- Pelo menos uma aprovação de review é necessária
- O CI (typecheck) deve estar verde

---

## Convenção de Commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/pt-br/):

```
<tipo>[escopo opcional]: <descrição>

[corpo opcional]

[rodapé(s) opcional(is)]
```

### Tipos válidos

| Tipo | Quando usar |
|------|-------------|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Apenas documentação |
| `style` | Formatação, sem mudança de lógica |
| `refactor` | Refatoração sem nova feature ou bugfix |
| `perf` | Melhoria de performance |
| `test` | Adição ou correção de testes |
| `chore` | Tarefas de manutenção, deps, CI |

### Exemplos

```
feat(dashboard): adicionar gráfico de linha para evolução do saldo
fix(api): corrigir query de transações do mês quando sem dados
docs(readme): atualizar guia de setup do Docker
chore(deps): atualizar turbo para 2.6.0
```

---

## Estrutura do Projeto

```
EcoFinance/
├── apps/
│   ├── next/          # Dashboard web (Next.js 15)
│   └── expo/          # App mobile Android (Expo)
├── packages/
│   ├── db/            # Schema Drizzle + migrations
│   └── shared/        # Tipos TypeScript compartilhados
├── docker-compose.yml # Banco local
└── turbo.json         # Configuração Turborepo
```

### Onde adicionar o quê

- **Nova página web** → `apps/next/src/app/[nome]/page.tsx`
- **Nova rota de API** → `apps/next/src/app/api/[nome]/route.ts`
- **Novo componente UI** → `apps/next/src/components/ui/`
- **Nova tela mobile** → `apps/expo/src/screens/`
- **Alteração no schema** → `packages/db/src/schema.ts` + `pnpm db:generate`
- **Novos tipos compartilhados** → `packages/shared/src/`

---

Dúvidas? Abra uma [Discussion](https://github.com/your-username/EcoFinance/discussions) ou uma Issue. 🚀
