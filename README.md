<div align="center">
  <img src="docs/dashboard-preview.png" alt="EcoFinance Dashboard" width="100%" />

  <h1>EcoFinance</h1>

  <p>
    <strong>Gestão inteligente de finanças pessoais com IA, Open Finance e geolocalização</strong>
  </p>

  <p>
    <a href="https://github.com/your-username/EcoFinance/blob/main/LICENSE">
      <img src="https://img.shields.io/badge/license-MIT-10b981?style=flat-square" alt="MIT License" />
    </a>
    <a href="https://nodejs.org">
      <img src="https://img.shields.io/badge/node-%3E%3D20-10b981?style=flat-square&logo=node.js&logoColor=white" alt="Node >= 20" />
    </a>
    <img src="https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js" alt="Next.js 15" />
    <img src="https://img.shields.io/badge/Expo-SDK_53-1C1E24?style=flat-square&logo=expo" alt="Expo" />
    <img src="https://img.shields.io/badge/Turborepo-2-EF4444?style=flat-square&logo=turborepo" alt="Turborepo" />
    <img src="https://img.shields.io/badge/PostgreSQL-PostGIS-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL + PostGIS" />
    <a href="https://github.com/your-username/EcoFinance/actions">
      <img src="https://img.shields.io/github/actions/workflow/status/your-username/EcoFinance/ci.yml?branch=main&style=flat-square&label=CI" alt="CI" />
    </a>
  </p>
</div>

---

## ✨ Features

| Feature | Descrição |
|---|---|
| 📊 **Dashboard Analítico** | Cards de saldo, receitas e despesas com % comparativo vs mês anterior |
| 🤖 **Chat com IA** | Assistente Google Gemini 2.0 Flash com acesso ao banco de dados via function calling |
| 🏦 **Open Finance (Pluggy)** | Sincronização automática de contas e transações de bancos brasileiros |
| 📂 **Importação OFX** | Upload de extratos `.ofx` de qualquer banco |
| 📱 **App Mobile** | Captura notificações de gastos em segundo plano (Android) |
| 🗺️ **Mapa Geográfico** | Visualize onde você gastou dinheiro via PostGIS + Leaflet |
| 🚗 **Recibos Uber** | Rastreamento automático de corridas com origem/destino |
| 🏷️ **Categorização IA** | Gemini AI categoriza automaticamente cada transação |
| 🎨 **Design Dark Premium** | Glassmorphism, animações suaves e design 100% responsivo |
| 🐳 **Docker-first** | Banco local com um comando, sem precisar de conta Supabase |

---

## 🏗️ Arquitetura

```
EcoFinance/                       # Monorepo Turborepo + pnpm
├── apps/
│   ├── next/                     # Dashboard web — Next.js 15, Tailwind v4, Drizzle
│   │   └── src/
│   │       ├── app/
│   │       │   ├── page.tsx           # Dashboard (SSR)
│   │       │   ├── transactions/      # Tabela de transações
│   │       │   ├── accounts/          # Gestão de contas
│   │       │   ├── map/               # Mapa geoespacial
│   │       │   └── api/
│   │       │       ├── chat/          # Chat IA (Gemini 2.0 Flash)
│   │       │       ├── pluggy/        # Webhook + sync Open Finance
│   │       │       ├── transactions/  # Notificações, OFX, Uber, nearby
│   │       │       ├── health/        # Health-check para o mobile
│   │       │       └── seed/          # Dados de demonstração (dev only)
│   │       ├── components/ui/         # Design system (Card, Badge, Table…)
│   │       └── lib/
│   │           ├── pluggy-client.ts   # Pluggy API com retry + backoff
│   │           └── ofx-parser.ts      # Parser de extratos OFX
│   │
│   └── expo/                     # App mobile — Expo SDK 53, React Native
│       └── src/
│           ├── screens/               # Home, Contas, Assistente IA, Onboarding
│           └── services/
│               ├── api-client.ts      # Comunicação com o Next.js
│               └── notification-handler.ts  # Background task de notificações
│
└── packages/
    ├── db/                       # @ecofinance/db — Schema + migrations
    │   ├── src/
    │   │   ├── schema.ts          # Drizzle schema (accounts, transactions, uber)
    │   │   └── index.ts           # Conexão postgres.js
    │   └── migrations/
    │       └── 0001_init.sql      # PostGIS, tabelas, índices, trigger geom
    └── shared/                   # @ecofinance/shared — Tipos TypeScript
```

### Fluxo de dados

```
Banco do usuário
  ├── Pluggy Webhook → POST /api/pluggy/webhook → Gemini AI → banco local
  ├── App Mobile (notificação push interceptada) → POST /api/transactions/notification
  └── Upload OFX → POST /api/transactions/import-ofx → parser → banco local
                                                              ↓
                              Next.js (SSR) ← PostgreSQL + PostGIS (Supabase / Docker)
                              ↕
                        Chat IA (Gemini 2.0 Flash + Function Calling)
```

---

## 🚀 Começando

### Pré-requisitos

| Ferramenta | Versão mínima | Instalação |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| pnpm | 9+ | `npm install -g pnpm@9` |
| Docker | qualquer | [docker.com](https://www.docker.com) |

> **Não tem Supabase?** Sem problema — o Docker Compose cria um banco PostgreSQL + PostGIS local.

---

### 1. Clonar o repositório

```bash
git clone https://github.com/your-username/EcoFinance.git
cd EcoFinance
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
```

Abra o `.env` e preencha as variáveis. Veja a [tabela completa abaixo](#-variáveis-de-ambiente).

> Para testes locais, as únicas variáveis obrigatórias são `DATABASE_URL` e `GEMINI_API_KEY`.

### 3. Subir o banco de dados local

```bash
docker compose up -d
```

Isso cria um container PostgreSQL 16 + PostGIS na porta `5432`.  
`DATABASE_URL` para uso local: `postgresql://postgres:postgres@localhost:5432/ecofinance`

### 4. Instalar dependências

```bash
pnpm install
```

### 5. Criar o schema do banco

```bash
pnpm db:push
```

Isso aplica o arquivo `packages/db/migrations/0001_init.sql` com todas as tabelas, índices e o trigger geoespacial.

### 6. (Opcional) Popular com dados de demonstração

```bash
curl -X POST http://localhost:3000/api/seed
```

Isso cria 2 contas e ~35 transações realistas para você ver o dashboard funcionando imediatamente.

> Só funciona em desenvolvimento (`NODE_ENV !== 'production'`).

### 7. Rodar em modo desenvolvimento

```bash
pnpm dev
```

| App | URL |
|---|---|
| Dashboard Web | http://localhost:3000 |
| Health Check | http://localhost:3000/api/health |

---

## 🔑 Variáveis de Ambiente

Copie `.env.example` para `.env`. A tabela abaixo descreve cada variável:

| Variável | Obrigatório | Descrição |
|---|---|---|
| `DATABASE_URL` | ✅ | Connection string PostgreSQL. Local: `postgresql://postgres:postgres@localhost:5432/ecofinance` |
| `GEMINI_API_KEY` | ✅ | Chave da API Google Gemini (gratuita em [aistudio.google.com](https://aistudio.google.com)) |
| `PLUGGY_CLIENT_ID` | ⚠️ Opcional | Client ID do [Pluggy](https://dashboard.pluggy.ai) (para sync de bancos) |
| `PLUGGY_CLIENT_SECRET` | ⚠️ Opcional | Client Secret do Pluggy |
| `API_SECRET_KEY` | ⚠️ Opcional | Chave secreta para autenticar o app mobile (mínimo 32 chars) |
| `SUPABASE_URL` | ⚠️ Opcional | URL do projeto Supabase (se usar Supabase em vez de Docker) |
| `SUPABASE_ANON_KEY` | ⚠️ Opcional | Chave pública do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Opcional | Chave secreta do Supabase (só servidor) |
| `NEXT_PUBLIC_SUPABASE_URL` | ⚠️ Opcional | Mesmo que `SUPABASE_URL`, exposto ao browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ⚠️ Opcional | Mesmo que `SUPABASE_ANON_KEY`, exposto ao browser |

---

## 📱 App Mobile (Android)

O app Expo captura notificações de transações enviadas por aplicativos de banco e as envia automaticamente para o servidor.

### Setup

```bash
# Instalar dependências
pnpm install

# Apontar para o servidor local
# No arquivo apps/expo/.env (ou nas configurações do app):
EXPO_PUBLIC_API_URL=http://SEU_IP_LOCAL:3000
EXPO_PUBLIC_API_SECRET=sua-chave-secreta

# Rodar no emulador Android
cd apps/expo
npx expo run:android
```

> No emulador Android, o endereço `10.0.2.2` aponta para o `localhost` do computador.

### Funcionalidades do Mobile

- **Onboarding animado** com configuração de permissões (localização + notificações)
- **Background task** que monitora notificações de bancos em tempo real
- **Tela de Assistente IA** para conversar com o Gemini
- **Tela de Contas** com saldo e sincronização
- **Tela de Opções** com configuração da URL da API e chave secreta

---

## 🗄️ Banco de Dados

### Schema

| Tabela | Descrição |
|---|---|
| `accounts` | Contas bancárias (com referência ao item Pluggy) |
| `transactions` | Transações financeiras (com coluna `geom` PostGIS para geolocalização) |
| `uber_trips_metadata` | Metadados de corridas Uber (origem, destino, motorista) |

### Comandos úteis

```bash
# Aplicar schema (development)
pnpm db:push

# Gerar migration a partir de mudanças no schema
pnpm db:generate

# Iniciar banco local
docker compose up -d

# Parar banco local
docker compose down

# Apagar todos os dados e recriar
docker compose down -v && docker compose up -d && pnpm db:push
```

---

## 🛠️ Scripts

| Comando | Descrição |
|---|---|
| `pnpm dev` | Roda todos os apps em modo desenvolvimento |
| `pnpm build` | Build de produção de todos os apps |
| `pnpm typecheck` | Verifica tipos TypeScript em todos os packages |
| `pnpm lint` | Linting em todos os apps |
| `pnpm db:push` | Aplica o schema no banco sem gerar migration |
| `pnpm db:generate` | Gera arquivo de migration a partir do schema |
| `pnpm clean` | Remove todos os artefatos de build e cache |

Para rodar um app específico:

```bash
# Só o dashboard web
pnpm --filter @ecofinance/next dev

# Só o app mobile
pnpm --filter @ecofinance/expo dev
```

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Leia o [CONTRIBUTING.md](./CONTRIBUTING.md) para entender o processo de Pull Request e as convenções de commit.

Veja também nosso [Código de Conduta](./CODE_OF_CONDUCT.md).

---

## 📋 Roadmap

- [ ] Autenticação de usuários (NextAuth / Supabase Auth)
- [ ] Multi-usuário com Row Level Security (RLS)
- [ ] Metas financeiras e orçamento mensal por categoria
- [ ] Exportação de relatórios em PDF
- [ ] Gráfico de linha para evolução do saldo no tempo
- [ ] Alertas inteligentes (gastos acima da média)
- [ ] Suporte a iOS no app mobile
- [ ] Internacionalização (i18n) — inglês / espanhol

---

## 📄 Licença

Distribuído sob a licença MIT. Veja [LICENSE](./LICENSE) para mais informações.

---

<div align="center">
  <p>Feito com ❤️ no Brasil 🇧🇷</p>
</div>
