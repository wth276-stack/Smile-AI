# AI Top Sales

AI-powered Sales, Booking & CRM System — multi-tenant SaaS.

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | Next.js 15, React 19, Tailwind CSS 4 |
| Backend    | NestJS 11, Prisma 6, PostgreSQL 16  |
| Worker     | NestJS + BullMQ + Redis             |
| AI Engine  | `@ats/ai-engine` — code default **`AI_ENGINE_MODE=auto`**: uses **LLM planner** when **`OPENAI_API_KEY`** is set, else rule path. Set **`AI_ENGINE_MODE=rule`** to force deterministic only. **v1 reply wording stays template composers** for all flows. See [`docs/ai-engine-llm.md`](docs/ai-engine-llm.md). |
| Monorepo   | pnpm workspaces + Turborepo        |

**Default behaviour:** with unset env, **`auto`** — OpenAI runs when a key is present; use **`AI_ENGINE_MODE=rule`** to disable. Details: [`docs/known-limitations.md`](docs/known-limitations.md), [`docs/ai-engine-llm.md`](docs/ai-engine-llm.md).

**Try chat locally & confirm ChatGPT/OpenAI:** [`docs/local-chat-openai.md`](docs/local-chat-openai.md) · script `scripts/local-chat-smoke.ps1`.

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker & Docker Compose

### 1. Clone & Install

```bash
pnpm install
```

### 2. Start Infrastructure

```bash
pnpm docker:up
```

This starts PostgreSQL (port 5432) and Redis (port 6379).

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your values (JWT_SECRET, DATABASE_URL, etc.)
# OPENAI_API_KEY / OPENAI_DEFAULT_MODEL: optional; not used by the default rule-based runAiEngine() chat path today
```

### 4. Setup Database

```bash
pnpm db:generate
pnpm db:migrate
```

### 5. Start Development

```bash
# Start all apps
pnpm dev

# Or start individually
pnpm dev:api     # NestJS API on :3001
pnpm dev:web     # Next.js on :3000
pnpm dev:worker  # Background worker
```

## Project Structure

```
ai-top-sales/
├── apps/
│   ├── api/          # NestJS backend API
│   ├── web/          # Next.js frontend
│   └── worker/       # BullMQ background worker
├── packages/
│   ├── database/     # Prisma schema & client
│   ├── shared/       # Enums, types, utils
│   ├── ai-engine/    # AI pipeline orchestrator
│   └── channel-adapters/ # Channel integration interfaces
├── config/           # Shared TSConfig
├── docker/           # Docker Compose (PostgreSQL + Redis)
└── docs/             # Architecture documents
```

## Product Phases

| Phase | Name           | Description                              |
|-------|----------------|------------------------------------------|
| 1     | Starter        | AI Receptionist — FAQ, orders, bookings  |
| 2     | Growth         | AI Sales Assistant — lead scoring, pipeline |
| 3     | Elite          | AI Top Sales Agent — closing, upsell     |

## API Endpoints (Phase 1)

| Method | Endpoint                | Description          |
|--------|-------------------------|----------------------|
| POST   | /api/auth/register      | Register tenant      |
| POST   | /api/auth/login         | Login                |
| POST   | /api/auth/refresh       | Refresh tokens       |
| GET    | /api/auth/me            | Current user         |
| GET    | /api/contacts           | List contacts        |
| POST   | /api/contacts           | Create contact       |
| GET    | /api/conversations      | List conversations   |
| GET    | /api/conversations/:id  | Conversation + messages |
| GET    | /api/knowledge-base     | List documents       |
| POST   | /api/knowledge-base     | Create document      |
| GET    | /api/health             | Health check         |

## Internal pilot & demo

Operational checklists and scripts (current verified behaviour):

- `docs/internal-pilot-readiness.md` — Prerequisites, startup, env, DB/Redis/API checks, chat E2E, troubleshooting
- `docs/demo-script.md` — 5–7 demo scenarios with expected outcomes
- `docs/known-limitations.md` — Non-production caveats grounded in this repo
- `docs/api-chat-e2e-verification.md` — How to run `pnpm test:chat-e2e` (`RUN_CHAT_E2E=1`)

## Architecture Documents

Detailed design docs are in the `docs/` folder:

- `MASTER-ARCHITECTURE.md` — Complete consolidated architecture
- `ARCHITECTURE.md` — System overview
- `MONOREPO-STRUCTURE.md` — Repo structure decisions
- `BACKEND-DOMAIN-DESIGN.md` — Backend domain model
- `AI-ENGINE-SPEC.md` — AI engine pipeline design
- `PRISMA-SCHEMA-PLAN.md` — Database schema plan
- `FRONTEND-SPEC.md` — Frontend architecture
