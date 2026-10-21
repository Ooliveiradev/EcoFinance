# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

---

## [Não lançado] — reestruturação para gestão mensal

Resumo da refatoração acompanhada em #18. Detalhes e evidências de cada item em `docs/refatoracao/`.

### Adicionado
- Autenticação por email/senha (Better Auth, Argon2id), sessões revogáveis e isolamento por usuário em web, API e app (#3).
- Runtime no Cloud Firestore Enterprise em São Paulo, com backup, restauração e reversão para PostgreSQL (#47).
- Meu mês, contas, categorias personalizadas, receitas, despesas e transferências com centavos exatos (#4, #5).
- Recorrências, orçamento por categoria, pagamento/adiamento/conciliação e fechamento de mês (#6).
- Cartões, faturas, parcelas, estornos e pagamento de fatura sem dupla contagem (#7).
- Importação com revisão e confirmação atômica: OFX/QFX, CSV/TSV, XLS/XLSX, PDF e fotos com OCR local (#8, #9, #10).
- Relatórios por competência e caixa com o mesmo cálculo do dashboard, API e CSV (#12).
- Backup do usuário, restauração com prévia e exclusão de dados (#14).
- Sugestão de categoria por regras do usuário e aprendidas; modelo local opcional (#11, parcial).
- Telas nativas no Expo com cache e rascunhos por usuário (#13, parcial).
- Deploy no Cloud Run com Workload Identity Federation e provisionamento em um comando (#16, parcial).
- README com capturas reais da web e dados sintéticos reproduzíveis (#17).

### Corrigido
- Datas da lista "Lançamentos do mês" apareciam um dia antes, com horário 21:00, no fuso de São Paulo.

### Removido
- Pluggy/Open Finance, captura de notificações com GPS, mapa, recibos Uber, chat Gemini e segredo global da API (#15). Os lançamentos já gravados continuam consultáveis e exportáveis.

## [1.0.0] — 2026-07-01

Versão anterior à reestruturação. Vários recursos abaixo foram removidos na transição (#15).

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
