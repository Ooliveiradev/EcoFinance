# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [1.0.0] — 2026-07-01

### ✨ Adicionado

#### Dashboard Web (`apps/next`)
- Dashboard com cards de saldo total, receitas, despesas e contagem de transações com comparação mensal (% vs mês anterior)
- Gráfico de rosca interativo de despesas por categoria com tooltip customizado (Recharts)
- Tabela de transações recentes com paginação, filtros e busca
- Página de contas bancárias com sincronização via Pluggy
- Página de mapa geográfico com transações geolocalizadas (PostGIS + Leaflet)
- Sidebar responsiva com menu mobile (hamburguer)
- Sistema de design dark com glassmorphism (Tailwind v4)
- Importação de extratos `.OFX` com parser customizado
- Integração com Pluggy Open Finance API (sincronização automática de contas/transações)
- Chat com IA (Google Gemini 2.0 Flash) com function calling para busca de transações

#### App Mobile (`apps/expo`)
- App Android com navegação por abas (Home, Contas, Assistente IA, Opções)
- Onboarding animado com solicitação de permissões (localização, notificações)
- Rastreamento de notificações de transações bancárias em background
- Integração com a API interna para envio de transações capturadas
- Tela de configuração da URL e chave da API

#### Banco de Dados (`packages/db`)
- Schema PostgreSQL com Drizzle ORM (contas, transações, metadados Uber)
- Suporte a PostGIS com coluna `geom geography(POINT, 4326)` auto-populada por trigger
- Função SQL `buscar_lancamentos_proximos` para busca geoespacial por raio
- Indexes otimizados nas colunas `account_id`, `date`, `external_id`, `category`
- Categorização automática de transações via Gemini AI
- Suporte a recibos Uber (origem, destino, motorista, duração)

### 🏗️ Infraestrutura
- Monorepo Turborepo com pnpm workspaces
- `docker-compose.yml` para PostgreSQL + PostGIS local (sem precisar de Supabase)
- Endpoint `/api/seed` para popular o banco com dados de demonstração
- Endpoint `/api/health` para health-check e teste de conectividade do mobile
- GitHub Actions CI para typecheck automático

---

## Links

- [Repositório](https://github.com/your-username/EcoFinance)
- [Issues](https://github.com/your-username/EcoFinance/issues)
