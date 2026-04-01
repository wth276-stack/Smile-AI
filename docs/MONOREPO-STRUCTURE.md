# AI Top Sales - Monorepo Structure Design

> Version: 0.1 | Date: 2026-03-19
> Depends on: [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. Monorepo Overview

### Tool Choice: pnpm workspaces + Turborepo

| Concern | Choice | Reason |
|---------|--------|--------|
| Package manager | **pnpm** | Strict dependency isolation, disk-efficient, workspace protocol (`workspace:*`), fastest install |
| Build orchestrator | **Turborepo** | Incremental builds, task caching, parallel execution, simple config |
| NOT Nx | — | Nx is powerful but over-engineered for a team < 5 devs. Turbo is lighter. |

### Port Allocation (Local Dev)

| App | Port | Purpose |
|-----|------|---------|
| `apps/web` | 3000 | Next.js dashboard |
| `apps/api` | 3001 | NestJS REST API |
| `apps/worker` | — | No HTTP; BullMQ processor |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache + queue |
| BullBoard (dev only) | 3002 | Queue monitoring UI |

---

## 2. Complete Monorepo File Tree

```
ai-top-sales/
│
├── apps/
│   ├── web/                          ← Next.js Dashboard (Section 5)
│   ├── api/                          ← NestJS API Server (Section 4)
│   └── worker/                       ← BullMQ Background Workers (Section 6)
│
├── packages/
│   ├── database/                     ← Prisma schema + client (Section 7)
│   ├── shared/                       ← Types, enums, utils, constants (Section 8)
│   ├── ai-engine/                    ← AI orchestration pipeline (Section 9)
│   └── channel-adapters/             ← WhatsApp / IG / FB / WebChat adapters (Section 10)
│
├── config/                           ← Shared config files (Section 11)
│   ├── eslint/
│   │   └── base.js                   ← Shared ESLint config
│   └── tsconfig/
│       ├── base.json                 ← Base tsconfig all packages extend
│       ├── nestjs.json               ← NestJS-specific compiler options
│       └── nextjs.json               ← Next.js-specific compiler options
│
├── docker/
│   ├── docker-compose.yml            ← Local dev: PG + Redis
│   ├── docker-compose.prod.yml       ← Production compose
│   ├── Dockerfile.api                ← API server image
│   ├── Dockerfile.worker             ← Worker image
│   └── Dockerfile.web                ← Next.js image
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── MONOREPO-STRUCTURE.md         ← This file
│   └── adr/                          ← Architecture Decision Records
│
├── .env.example                      ← Environment variable template
├── .gitignore
├── .prettierrc
├── package.json                      ← Root workspace config
├── pnpm-workspace.yaml               ← pnpm workspace definition
├── turbo.json                        ← Turborepo pipeline config
└── README.md
```

---

## 3. Root-Level Configuration Files

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "config/*"
```

### `turbo.json`

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "db:generate": {
      "cache": false
    },
    "db:migrate": {
      "cache": false
    }
  }
}
```

### Root `package.json` (scripts)

```jsonc
{
  "name": "ai-top-sales",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "dev:api": "turbo dev --filter=@ats/api",
    "dev:web": "turbo dev --filter=@ats/web",
    "dev:worker": "turbo dev --filter=@ats/worker",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test",
    "db:generate": "turbo db:generate --filter=@ats/database",
    "db:migrate": "turbo db:migrate --filter=@ats/database",
    "db:studio": "pnpm --filter @ats/database exec prisma studio",
    "docker:up": "docker compose -f docker/docker-compose.yml up -d",
    "docker:down": "docker compose -f docker/docker-compose.yml down",
    "clean": "turbo clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo": "^2.x",
    "prettier": "^3.x"
  },
  "packageManager": "pnpm@9.x.x"
}
```

**Naming convention**: All internal packages use `@ats/` scope (AI Top Sales). This avoids npm collisions and makes imports explicit: `import { TenantPlan } from '@ats/shared'`.

---

## 4. `apps/api` — NestJS API Server

This is the main backend server. It exposes REST endpoints, receives channel webhooks, and coordinates business logic.

```
apps/api/
├── src/
│   ├── main.ts                           ← Bootstrap NestJS app
│   ├── app.module.ts                     ← Root module, imports all feature modules
│   │
│   ├── common/                           ← Cross-cutting concerns (NOT a NestJS module)
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts         ← JWT authentication
│   │   │   ├── roles.guard.ts            ← RBAC authorization
│   │   │   └── tenant.guard.ts           ← Inject tenantId into request context
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts ← @CurrentUser() param decorator
│   │   │   ├── current-tenant.decorator.ts ← @CurrentTenant() param decorator
│   │   │   └── roles.decorator.ts        ← @Roles('OWNER','ADMIN') decorator
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts    ← Request/response logging
│   │   │   └── transform.interceptor.ts  ← Standardize response envelope
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts  ← Global error formatting
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts        ← Global DTO validation (class-validator)
│   │   └── middleware/
│   │       └── tenant-resolution.middleware.ts ← Resolve tenant from JWT or API key
│   │
│   ├── config/                           ← NestJS ConfigModule setup
│   │   ├── app.config.ts                 ← App-level config (port, cors, etc.)
│   │   ├── database.config.ts            ← DB connection config
│   │   ├── redis.config.ts               ← Redis connection config
│   │   ├── auth.config.ts                ← JWT secrets, expiry
│   │   ├── ai.config.ts                  ← OpenAI keys, default model
│   │   └── index.ts                      ← Re-export all
│   │
│   └── modules/                          ← Feature modules (one folder = one NestJS module)
│       │
│       │  ─── PLATFORM LAYER ───
│       ├── auth/
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts        ← POST /auth/login, /auth/register, GET /auth/me
│       │   ├── auth.service.ts           ← Login, register, token generation
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts       ← Passport JWT strategy
│       │   └── dto/
│       │       ├── login.dto.ts
│       │       └── register.dto.ts
│       │
│       ├── tenants/
│       │   ├── tenants.module.ts
│       │   ├── tenants.controller.ts     ← GET/PATCH /tenants/current
│       │   ├── tenants.service.ts        ← Tenant CRUD + settings
│       │   └── dto/
│       │       └── update-tenant-settings.dto.ts
│       │
│       ├── users/
│       │   ├── users.module.ts
│       │   ├── users.controller.ts       ← Team member CRUD
│       │   ├── users.service.ts
│       │   └── dto/
│       │
│       │  ─── CORE BUSINESS LAYER ───
│       ├── contacts/
│       │   ├── contacts.module.ts
│       │   ├── contacts.controller.ts
│       │   ├── contacts.service.ts       ← CRUD + upsert-from-channel logic
│       │   └── dto/
│       │
│       ├── conversations/
│       │   ├── conversations.module.ts
│       │   ├── conversations.controller.ts ← List, detail, assign, close
│       │   ├── conversations.service.ts
│       │   └── dto/
│       │
│       ├── messages/
│       │   ├── messages.module.ts
│       │   ├── messages.controller.ts    ← GET messages, POST human-agent message
│       │   ├── messages.service.ts
│       │   └── dto/
│       │
│       ├── orders/
│       │   ├── orders.module.ts
│       │   ├── orders.controller.ts
│       │   ├── orders.service.ts
│       │   └── dto/
│       │
│       ├── bookings/
│       │   ├── bookings.module.ts
│       │   ├── bookings.controller.ts
│       │   ├── bookings.service.ts
│       │   └── dto/
│       │
│       ├── follow-ups/
│       │   ├── follow-ups.module.ts
│       │   ├── follow-ups.controller.ts
│       │   ├── follow-ups.service.ts
│       │   └── dto/
│       │
│       ├── reminders/
│       │   ├── reminders.module.ts
│       │   ├── reminders.service.ts      ← Mostly internal; worker schedules them
│       │   └── dto/
│       │
│       ├── notifications/
│       │   ├── notifications.module.ts
│       │   ├── notifications.controller.ts ← GET /notifications (in-app)
│       │   ├── notifications.service.ts    ← Create + send (email, push, in-app)
│       │   ├── providers/
│       │   │   ├── email.provider.ts       ← Email sending (Resend / Nodemailer)
│       │   │   └── push.provider.ts        ← Push notifications (Phase 2)
│       │   └── dto/
│       │
│       │  ─── KNOWLEDGE & CONFIG LAYER ───
│       ├── knowledge-base/
│       │   ├── knowledge-base.module.ts
│       │   ├── knowledge-base.controller.ts ← CRUD for knowledge documents
│       │   ├── knowledge-base.service.ts    ← Search, match, manage docs
│       │   └── dto/
│       │
│       ├── channels/
│       │   ├── channels.module.ts
│       │   ├── channels.controller.ts    ← CRUD channel configs
│       │   ├── channels.service.ts
│       │   └── dto/
│       │
│       │  ─── WEBHOOK INGRESS ───
│       ├── webhooks/
│       │   ├── webhooks.module.ts
│       │   ├── webhooks.controller.ts    ← POST /webhooks/whatsapp, /webhooks/web-chat
│       │   └── webhooks.service.ts       ← Normalize + enqueue message
│       │
│       │  ─── DASHBOARD ───
│       ├── dashboard/
│       │   ├── dashboard.module.ts
│       │   ├── dashboard.controller.ts   ← GET /dashboard/stats
│       │   └── dashboard.service.ts      ← Aggregate queries
│       │
│       │  ─── PHASE 2 MODULES (stubs in Phase 1, implemented in Phase 2) ───
│       ├── scoring/                      ← Lead scoring
│       ├── sales-playbooks/              ← Playbook CRUD
│       ├── objection-rules/              ← Objection rule CRUD
│       ├── handoffs/                     ← Human handoff management
│       │
│       │  ─── PHASE 3 MODULES ───
│       ├── upsell-rules/                 ← Upsell/cross-sell rules
│       ├── decision-profiles/            ← Decision identity profiles
│       └── analytics/                    ← Advanced analytics endpoints
│
├── test/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
│
├── nest-cli.json
├── tsconfig.json                         ← extends config/tsconfig/nestjs.json
├── tsconfig.build.json
└── package.json
```

### `apps/api/package.json` 依賴

```jsonc
{
  "name": "@ats/api",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start:prod": "node dist/main",
    "lint": "eslint src/",
    "test": "jest"
  },
  "dependencies": {
    // NestJS core
    "@nestjs/common": "^10.x",
    "@nestjs/core": "^10.x",
    "@nestjs/platform-express": "^10.x",
    "@nestjs/config": "^3.x",
    "@nestjs/passport": "^10.x",
    "@nestjs/jwt": "^10.x",
    "@nestjs/bullmq": "^10.x",

    // Internal packages
    "@ats/database": "workspace:*",
    "@ats/shared": "workspace:*",
    "@ats/ai-engine": "workspace:*",
    "@ats/channel-adapters": "workspace:*",

    // Runtime
    "passport": "^0.7.x",
    "passport-jwt": "^4.x",
    "class-validator": "^0.14.x",
    "class-transformer": "^0.5.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "bcrypt": "^5.x"
  }
}
```

### Module Pattern (每個 module 的內部結構)

每個 NestJS module 都遵循統一的 pattern，以 `contacts` 為例：

```
modules/contacts/
├── contacts.module.ts          ← @Module declaration
├── contacts.controller.ts      ← REST endpoints, validation, auth guards
├── contacts.service.ts         ← Business logic, calls Prisma
├── dto/
│   ├── create-contact.dto.ts   ← Input validation via class-validator
│   ├── update-contact.dto.ts
│   └── query-contacts.dto.ts   ← Pagination, filters
└── contacts.types.ts           ← Module-specific types (if not in @ats/shared)
```

**Rules**:
- Controller handles HTTP concerns only (parse params, call service, return response)
- Service handles business logic + data access (via injected Prisma client)
- DTOs validate all inputs (no raw `any` from request body)
- Cross-module calls go through injected services, never direct DB queries from another module's tables

---

## 5. `apps/web` — Next.js Dashboard

```
apps/web/
├── app/                                  ← App Router
│   ├── (auth)/                           ← Auth-related pages (public layout)
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── register/
│   │   │   └── page.tsx
│   │   └── layout.tsx                    ← Minimal layout, no sidebar
│   │
│   ├── (dashboard)/                      ← Dashboard pages (protected layout)
│   │   ├── layout.tsx                    ← Sidebar + topbar + auth check
│   │   ├── page.tsx                      ← Dashboard home (stats overview)
│   │   │
│   │   ├── conversations/
│   │   │   ├── page.tsx                  ← Conversation list
│   │   │   └── [id]/
│   │   │       └── page.tsx              ← Conversation detail + message thread
│   │   │
│   │   ├── contacts/
│   │   │   ├── page.tsx                  ← Contact list with search/filter
│   │   │   └── [id]/
│   │   │       └── page.tsx              ← Contact detail + history
│   │   │
│   │   ├── orders/
│   │   │   ├── page.tsx
│   │   │   └── [id]/
│   │   │       └── page.tsx
│   │   │
│   │   ├── bookings/
│   │   │   ├── page.tsx                  ← Calendar + list view
│   │   │   └── [id]/
│   │   │       └── page.tsx
│   │   │
│   │   ├── follow-ups/
│   │   │   └── page.tsx                  ← Task list view
│   │   │
│   │   ├── knowledge-base/
│   │   │   ├── page.tsx                  ← Knowledge doc list
│   │   │   ├── new/
│   │   │   │   └── page.tsx
│   │   │   └── [id]/
│   │   │       └── page.tsx              ← Edit knowledge doc
│   │   │
│   │   ├── channels/
│   │   │   └── page.tsx                  ← Channel config (connect WhatsApp, etc.)
│   │   │
│   │   ├── settings/
│   │   │   ├── page.tsx                  ← General settings
│   │   │   ├── team/
│   │   │   │   └── page.tsx              ← Team member management
│   │   │   └── ai/
│   │   │       └── page.tsx              ← AI tone, greeting, model config
│   │   │
│   │   │  ─── PHASE 2 PAGES ───
│   │   ├── pipeline/                     ← Sales pipeline (Kanban board)
│   │   ├── handoffs/                     ← Handoff queue
│   │   ├── playbooks/                    ← Playbook editor
│   │   │
│   │   │  ─── PHASE 3 PAGES ───
│   │   └── analytics/                    ← Advanced analytics
│   │
│   ├── api/                              ← Next.js Route Handlers (minimal, proxy or auth callbacks)
│   │   └── auth/
│   │       └── [...nextauth]/
│   │           └── route.ts              ← (if using NextAuth, or custom token handling)
│   │
│   ├── layout.tsx                        ← Root layout (html, body, providers)
│   ├── globals.css
│   └── not-found.tsx
│
├── components/                           ← Shared UI components
│   ├── ui/                               ← Primitive UI (button, input, card, dialog, etc.)
│   │   ├── button.tsx                    ← shadcn/ui 風格
│   │   ├── input.tsx
│   │   ├── card.tsx
│   │   ├── dialog.tsx
│   │   ├── data-table.tsx
│   │   ├── badge.tsx
│   │   ├── avatar.tsx
│   │   └── ...
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx
│   │   ├── mobile-nav.tsx
│   │   └── page-header.tsx
│   ├── conversations/                    ← Domain-specific components
│   │   ├── conversation-list.tsx
│   │   ├── conversation-list-item.tsx
│   │   ├── message-thread.tsx
│   │   ├── message-bubble.tsx
│   │   └── message-input.tsx
│   ├── contacts/
│   │   ├── contact-card.tsx
│   │   └── contact-form.tsx
│   ├── bookings/
│   │   ├── booking-calendar.tsx
│   │   └── booking-card.tsx
│   ├── dashboard/
│   │   ├── stat-card.tsx
│   │   ├── recent-conversations.tsx
│   │   └── upcoming-bookings.tsx
│   └── knowledge-base/
│       ├── document-editor.tsx
│       └── document-list.tsx
│
├── lib/                                  ← Client-side utilities
│   ├── api-client.ts                     ← Fetch wrapper for NestJS API (with auth header)
│   ├── auth.ts                           ← Token storage, refresh logic
│   ├── utils.ts                          ← cn(), formatDate(), formatCurrency(), etc.
│   └── constants.ts                      ← Frontend constants
│
├── hooks/                                ← Custom React hooks
│   ├── use-auth.ts                       ← Auth state + login/logout methods
│   ├── use-api.ts                        ← Generic API fetching hook (SWR/React Query wrapper)
│   ├── use-conversations.ts              ← Conversation-specific data hooks
│   ├── use-contacts.ts
│   └── use-realtime.ts                   ← Polling / WebSocket for live updates (Phase 2)
│
├── stores/                               ← Client state (Zustand, minimal)
│   └── auth-store.ts                     ← JWT token + user info
│
├── types/                                ← Frontend-specific types (API response shapes)
│   └── api.ts
│
├── public/
│   └── ...
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json                         ← extends config/tsconfig/nextjs.json
├── postcss.config.js
└── package.json
```

### `apps/web/package.json` 依賴

```jsonc
{
  "name": "@ats/web",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15.x",
    "react": "^19.x",
    "react-dom": "^19.x",

    // Internal packages (types + utils only; NO Prisma, NO ai-engine)
    "@ats/shared": "workspace:*",

    // UI
    "tailwindcss": "^4.x",
    "@radix-ui/react-dialog": "^1.x",
    "@radix-ui/react-dropdown-menu": "^2.x",
    "lucide-react": "^0.x",
    "class-variance-authority": "^0.7.x",
    "clsx": "^2.x",
    "tailwind-merge": "^2.x",

    // Data fetching
    "swr": "^2.x",
    // OR "@tanstack/react-query": "^5.x"

    // State
    "zustand": "^5.x"
  }
}
```

**Important**: `apps/web` only depends on `@ats/shared` — never on `@ats/database` or `@ats/ai-engine`. The frontend never imports Prisma types directly. Shared enums and DTO types come from `@ats/shared`.

---

## 6. `apps/worker` — Background Job Processor

```
apps/worker/
├── src/
│   ├── main.ts                           ← Bootstrap worker (connect Redis, register processors)
│   │
│   ├── processors/                       ← BullMQ queue processors
│   │   ├── message.processor.ts          ← Process inbound messages (the main AI flow)
│   │   ├── reminder.processor.ts         ← Check & send due reminders
│   │   ├── follow-up.processor.ts        ← Check & escalate overdue follow-ups
│   │   ├── notification.processor.ts     ← Send notifications (email, push)
│   │   ├── channel-send.processor.ts     ← Send outbound messages via channel adapters
│   │   └── analytics.processor.ts        ← (Phase 2+) Aggregate analytics data
│   │
│   ├── services/                         ← Shared worker services
│   │   ├── ai-pipeline.service.ts        ← Wraps @ats/ai-engine, provides DB context
│   │   ├── side-effect.executor.ts       ← Executes AI engine side effects (CRM updates, etc.)
│   │   └── channel-sender.service.ts     ← Sends replies via @ats/channel-adapters
│   │
│   ├── schedulers/                       ← Cron-like repeatable jobs
│   │   ├── reminder-check.scheduler.ts   ← Every 1 min: check for due reminders
│   │   └── follow-up-check.scheduler.ts  ← Every 5 min: check for overdue follow-ups
│   │
│   └── worker.module.ts                  ← NestJS module (worker uses NestJS for DI)
│
├── tsconfig.json
└── package.json
```

### `apps/worker/package.json`

```jsonc
{
  "name": "@ats/worker",
  "private": true,
  "scripts": {
    "dev": "ts-node-dev --respawn src/main.ts",
    "build": "tsc",
    "start:prod": "node dist/main.js"
  },
  "dependencies": {
    "@nestjs/common": "^10.x",
    "@nestjs/core": "^10.x",
    "@nestjs/bullmq": "^10.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",

    "@ats/database": "workspace:*",
    "@ats/shared": "workspace:*",
    "@ats/ai-engine": "workspace:*",
    "@ats/channel-adapters": "workspace:*"
  }
}
```

### Worker 為什麼用 NestJS？

Worker 也用 NestJS（但不啟動 HTTP server），原因：
- 可以複用 `@ats/database` 的 Prisma module injection
- 可以用同樣的 DI pattern 注入 services
- 與 `apps/api` 共享 config module
- `@nestjs/bullmq` 提供成熟的 processor decorator

### Message Processing Flow (核心流程)

```
message.processor.ts 是最重要的 processor，處理所有 inbound message：

1. Receive job: { tenantId, channelId, rawMessage }
2. Load tenant config from Redis cache (or DB fallback)
3. Normalize message via @ats/channel-adapters
4. Upsert contact (contacts.service)
5. Find or create conversation (conversations.service)
6. Store inbound message (messages.service)
7. Call AI pipeline:
   ai-pipeline.service.ts → @ats/ai-engine orchestrator
   - Assembles context (conversation history, knowledge base, tenant config)
   - Runs AI pipeline layers
   - Returns { responseText, sideEffects[] }
8. Execute side effects (side-effect.executor.ts)
   - Update contact fields
   - Create order / booking
   - Schedule follow-up / reminder
   - Update conversation summary
   - Log AI run
9. Store outbound message
10. Enqueue channel-send job (send reply via WhatsApp / web chat)
```

---

## 7. `packages/database` — Prisma Schema + Client

```
packages/database/
├── prisma/
│   ├── schema.prisma                     ← Full Prisma schema
│   ├── migrations/                       ← Auto-generated migration files
│   └── seed.ts                           ← Seed script (demo tenant, test data)
│
├── src/
│   ├── index.ts                          ← Re-export PrismaClient + types
│   ├── client.ts                         ← Singleton PrismaClient factory
│   ├── prisma.module.ts                  ← NestJS module wrapping PrismaService
│   ├── prisma.service.ts                 ← NestJS injectable PrismaClient with onModuleInit/Destroy
│   └── middleware/
│       └── tenant-scope.middleware.ts     ← Prisma middleware: auto-inject tenantId on all queries
│
├── tsconfig.json
└── package.json
```

### `package.json`

```jsonc
{
  "name": "@ats/database",
  "private": true,
  "main": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:prod": "prisma migrate deploy",
    "db:push": "prisma db push",
    "db:studio": "prisma studio",
    "db:seed": "ts-node prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^6.x"
  },
  "devDependencies": {
    "prisma": "^6.x"
  }
}
```

### Tenant Scope Middleware 核心邏輯

```typescript
// packages/database/src/middleware/tenant-scope.middleware.ts
// 概念示意：

// Prisma extension 自動為所有 query 注入 tenantId
// 用法：const prisma = createTenantScopedClient(tenantId)
// 所有 findMany / create / update / delete 都會自動加上 where: { tenantId }
// 這確保 developer 不可能忘記加 tenant 過濾
```

### 為什麼 database 是 package 而不是放在 api 裡？

- `apps/api` 和 `apps/worker` 都需要 Prisma client
- Migration 和 schema 是獨立的 concern
- `prisma studio` 可以獨立運行
- 未來如果加 `apps/admin`（super admin），也直接引用

---

## 8. `packages/shared` — Types, Enums, Utils

```
packages/shared/
├── src/
│   ├── index.ts                          ← Re-export everything
│   │
│   ├── enums/
│   │   ├── index.ts
│   │   ├── tenant.enum.ts                ← TenantPlan, TenantStatus
│   │   ├── user.enum.ts                  ← UserRole
│   │   ├── contact.enum.ts               ← ContactStatus
│   │   ├── conversation.enum.ts          ← ConversationStatus, LeadState
│   │   ├── message.enum.ts               ← MessageDirection, MessageSender, MessageContentType
│   │   ├── channel.enum.ts               ← ChannelType
│   │   ├── order.enum.ts                 ← OrderStatus
│   │   ├── booking.enum.ts               ← BookingStatus
│   │   ├── follow-up.enum.ts             ← FollowUpType, FollowUpStatus
│   │   ├── reminder.enum.ts              ← ReminderChannel, ReminderStatus, ReminderTargetType
│   │   ├── notification.enum.ts          ← NotificationType
│   │   ├── ai.enum.ts                    ← AiTone, Intent, Sentiment, Urgency
│   │   ├── handoff.enum.ts               ← HandoffReason (Phase 2)
│   │   └── objection.enum.ts             ← ObjectionCategory, ObjectionStrategy (Phase 2)
│   │
│   ├── types/
│   │   ├── index.ts
│   │   ├── api-response.types.ts         ← { success, data, error, pagination } 標準回傳格式
│   │   ├── pagination.types.ts           ← PaginationParams, PaginatedResult
│   │   ├── tenant-config.types.ts        ← TenantConfig, BusinessHours
│   │   ├── ai-context.types.ts           ← AiContext, ExtractedSignals, AiSideEffect
│   │   ├── channel-message.types.ts      ← NormalizedMessage (channel gateway 統一格式)
│   │   └── queue-jobs.types.ts           ← Job payload types for BullMQ queues
│   │
│   ├── utils/
│   │   ├── index.ts
│   │   ├── date.utils.ts                 ← formatDate, isBusinessHours, getNextBusinessDay
│   │   ├── string.utils.ts               ← slugify, truncate, sanitizeHtml
│   │   ├── id.utils.ts                   ← generateId (cuid2 or nanoid)
│   │   └── validation.utils.ts           ← isValidPhone, isValidEmail
│   │
│   └── constants/
│       ├── index.ts
│       ├── queue-names.ts                ← QUEUE_NAMES.MESSAGE_PROCESSING, etc.
│       ├── cache-keys.ts                 ← Redis key patterns (tenant:config:{id}, etc.)
│       ├── defaults.ts                   ← Default AI settings, pagination limits
│       └── limits.ts                     ← Max message length, max knowledge docs per tenant, etc.
│
├── tsconfig.json
└── package.json
```

### `package.json`

```jsonc
{
  "name": "@ats/shared",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "lint": "eslint src/"
  },
  "dependencies": {}
}
```

### 為什麼 enums 放在 shared 而不是 Prisma schema 的 enum？

Prisma 的 enum 會生成 TypeScript enum，但只在 `@prisma/client` 裡。問題：
- Frontend 不能 import `@prisma/client`（不應該知道 DB schema）
- Channel adapters 不需要 Prisma dependency

所以我們在 `@ats/shared` 定義 canonical enums，Prisma schema 裡的 enum 與之保持同步。一個 source of truth（shared），Prisma schema 鏡像它。

---

## 9. `packages/ai-engine` — AI Orchestration Pipeline

```
packages/ai-engine/
├── src/
│   ├── index.ts                          ← Export orchestrator + types
│   │
│   ├── orchestrator.ts                   ← Main entry: processMessage(context) -> AiResult
│   │
│   ├── pipeline/                         ← Pipeline layers (executed in sequence)
│   │   ├── context-assembler.ts          ← Build AiContext from raw inputs
│   │   ├── signal-extractor.ts           ← LLM call to extract intent, entities, signals
│   │   ├── knowledge-matcher.ts          ← Match relevant knowledge docs
│   │   ├── lead-state-engine.ts          ← FSM for lead state transitions (Phase 2+)
│   │   ├── decision-engine.ts            ← Route to the correct strategy
│   │   ├── response-generator.ts         ← Compose and call LLM for final response
│   │   └── guardrails.ts                 ← Validate AI output before returning
│   │
│   ├── strategies/                       ← Strategy handlers (loaded by decision-engine)
│   │   ├── faq-responder.strategy.ts     ← Answer from knowledge base
│   │   ├── info-collector.strategy.ts    ← Ask customer for info (name, phone, etc.)
│   │   ├── booking-creator.strategy.ts   ← Guide booking flow
│   │   ├── order-creator.strategy.ts     ← Guide order flow
│   │   ├── general-chat.strategy.ts      ← Friendly general response
│   │   ├── objection-handler.strategy.ts ← Handle price/timing/trust objections (Phase 2)
│   │   ├── cta-pusher.strategy.ts        ← Push call-to-action (Phase 2)
│   │   ├── handoff.strategy.ts           ← Initiate human handoff (Phase 2)
│   │   ├── upsell.strategy.ts            ← Upsell/cross-sell (Phase 3)
│   │   └── trust-repair.strategy.ts      ← Trust repair mode (Phase 3)
│   │
│   ├── prompts/                          ← Prompt templates (string templates with variables)
│   │   ├── system/
│   │   │   ├── base-role.prompt.ts       ← "You are an AI sales assistant for {{businessName}}..."
│   │   │   └── tone-variants.prompt.ts   ← Tone modifiers (friendly, professional, etc.)
│   │   ├── instructions/
│   │   │   ├── faq-answer.prompt.ts      ← "Answer the customer's question using the following knowledge..."
│   │   │   ├── collect-info.prompt.ts    ← "Naturally ask the customer for {{missingFields}}..."
│   │   │   ├── create-booking.prompt.ts  ← "Help the customer book an appointment..."
│   │   │   └── ...
│   │   └── extraction/
│   │       └── signal-extraction.prompt.ts ← Structured output prompt for signal extraction
│   │
│   ├── llm/                              ← LLM client abstraction
│   │   ├── llm-client.ts                 ← OpenAI API wrapper (chat completion)
│   │   ├── llm-client.interface.ts       ← Interface for swappable LLM providers
│   │   └── token-counter.ts              ← Estimate token usage
│   │
│   └── types/
│       ├── context.types.ts              ← AiContext (input to pipeline)
│       ├── result.types.ts               ← AiResult (output: response + side effects)
│       ├── signals.types.ts              ← ExtractedSignals
│       ├── side-effects.types.ts         ← AiSideEffect union type
│       └── strategy.types.ts             ← Strategy interface
│
├── tsconfig.json
└── package.json
```

### `package.json`

```jsonc
{
  "name": "@ats/ai-engine",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src/"
  },
  "dependencies": {
    "openai": "^4.x",
    "@ats/shared": "workspace:*"
  }
}
```

### 設計關鍵

**零 DB 依賴**：`@ats/ai-engine` 不 import `@ats/database`。它接收一個 `AiContext` object（由 worker 組裝），返回一個 `AiResult` object（包含 response text + side effects array）。Side effects 是 data，不是 function calls。

```typescript
// 使用方式（在 worker 裡）：
import { processMessage } from '@ats/ai-engine';
import type { AiContext, AiResult } from '@ats/ai-engine';

const context: AiContext = {
  tenant: { name: '美麗髮廊', tone: 'FRIENDLY', language: 'zh-HK', ... },
  contact: { name: '陳小姐', phone: '9123xxxx', ... },
  conversation: { messages: [...last20Messages], leadState: 'NEW', ... },
  knowledgeDocs: [{ title: 'FAQ', content: '...' }, ...],
  currentMessage: { content: '我想預約星期六下午剪髮', ... },
};

const result: AiResult = await processMessage(context);
// result = {
//   responseText: '好的陳小姐！星期六下午有空位，請問你想約幾點呢？😊',
//   sideEffects: [
//     { type: 'UPDATE_CONTACT', data: { name: '陳小姐' } },
//     { type: 'UPDATE_CONVERSATION', data: { summary: '客戶想預約星期六下午剪髮' } },
//   ],
//   signals: { intent: 'booking', sentiment: 'positive', ... },
//   aiRunLog: { model: 'gpt-4o-mini', promptTokens: 450, ... },
// }
```

---

## 10. `packages/channel-adapters` — Channel Integration

```
packages/channel-adapters/
├── src/
│   ├── index.ts                          ← Export adapters + normalizer types
│   │
│   ├── types.ts                          ← NormalizedInboundMessage, OutboundMessage, ChannelAdapter interface
│   │
│   ├── adapters/
│   │   ├── whatsapp/
│   │   │   ├── whatsapp.adapter.ts       ← WhatsApp Cloud API integration
│   │   │   ├── whatsapp.normalizer.ts    ← Raw webhook → NormalizedInboundMessage
│   │   │   ├── whatsapp.sender.ts        ← Send message via WhatsApp API
│   │   │   └── whatsapp.types.ts         ← WhatsApp-specific webhook payload types
│   │   │
│   │   ├── web-chat/
│   │   │   ├── web-chat.adapter.ts       ← Simple HTTP-based web chat
│   │   │   ├── web-chat.normalizer.ts
│   │   │   └── web-chat.sender.ts        ← Return response (or push via WebSocket)
│   │   │
│   │   ├── instagram/                    ← Phase 2
│   │   │   └── ...
│   │   │
│   │   └── facebook/                     ← Phase 2
│   │       └── ...
│   │
│   └── adapter-factory.ts               ← getAdapter(channelType) → ChannelAdapter
│
├── tsconfig.json
└── package.json
```

### Adapter Interface

```typescript
interface ChannelAdapter {
  normalizeInbound(rawPayload: unknown): NormalizedInboundMessage;
  sendOutbound(channelConfig: ChannelConfig, message: OutboundMessage): Promise<void>;
  verifyWebhook?(req: unknown): boolean;
}
```

每個 channel adapter 都實現這個 interface。Worker 透過 `adapter-factory.ts` 取得對應 adapter：

```typescript
const adapter = getAdapter('WHATSAPP');
const normalized = adapter.normalizeInbound(webhookPayload);
// ...process...
await adapter.sendOutbound(channelConfig, { text: result.responseText });
```

---

## 11. Config / Env / Infra

### Environment Variables Strategy

```
ai-top-sales/
├── .env.example                    ← Template, committed to git
├── .env                            ← Local dev values, git-ignored
├── apps/api/.env                   ← API-specific overrides (optional)
├── apps/web/.env.local             ← Next.js local env (NEXT_PUBLIC_*)
└── apps/worker/.env                ← Worker-specific overrides (optional)
```

Root `.env` is loaded by all apps. App-specific `.env` files override when needed.

### `.env.example` 完整模板

```env
# ── Database ──
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_top_sales

# ── Redis ──
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# ── Auth ──
JWT_SECRET=change-me-in-production
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ── OpenAI ──
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o-mini

# ── WhatsApp Cloud API ──
WHATSAPP_API_URL=https://graph.facebook.com/v21.0
WHATSAPP_VERIFY_TOKEN=my-verify-token

# ── App URLs ──
NEXT_PUBLIC_API_URL=http://localhost:3001
APP_URL=http://localhost:3000
API_PORT=3001

# ── Email (Phase 1: optional) ──
# RESEND_API_KEY=re_...

# ── File Storage (Phase 2) ──
# S3_ENDPOINT=
# S3_BUCKET=
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
```

### Docker Compose (Local Dev)

```yaml
# docker/docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: ai_top_sales
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### ESLint Config (Shared)

```javascript
// config/eslint/base.js
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
};
```

Each app extends this:

```javascript
// apps/api/.eslintrc.js
module.exports = {
  extends: ['../../config/eslint/base.js'],
  // app-specific overrides
};
```

### TypeScript Config (Shared Base)

```jsonc
// config/tsconfig/base.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "dist"]
}
```

```jsonc
// config/tsconfig/nestjs.json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "commonjs",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true
  }
}
```

```jsonc
// config/tsconfig/nextjs.json
{
  "extends": "./base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  }
}
```

---

## 12. Package vs App — 劃分決策表

| 能力 | 位置 | 類型 | 理由 |
|------|------|------|------|
| Prisma schema + client | `packages/database` | **Package** | API + Worker + 未來 admin 都要用 |
| Shared enums, types, utils | `packages/shared` | **Package** | 全部 apps 和 packages 都可能用 |
| AI pipeline (orchestrator + strategies + prompts) | `packages/ai-engine` | **Package** | 可獨立測試；無 NestJS / DB 依賴；未來可能獨立部署 |
| Channel adapters (WhatsApp, web chat, etc.) | `packages/channel-adapters` | **Package** | Swappable；API 接收 webhook + Worker 發送回覆都要用 |
| REST API endpoints + controllers | `apps/api` | **App** | NestJS-specific，不可能被其他 app import |
| Background job processors | `apps/worker` | **App** | 獨立 process，可獨立擴展 |
| Dashboard UI | `apps/web` | **App** | Next.js-specific |
| Auth logic (JWT, guards) | `apps/api/common/` | **App 內** | 只有 API server 需要；太薄不值得拆 package |
| NestJS module 的 service / controller / DTO | `apps/api/modules/` | **App 內** | NestJS-coupled，不需要被 worker import（worker 用 DB 直接操作） |
| Queue job payload 定義 | `packages/shared/types/` | **Package** | API enqueue + Worker dequeue 都要用同一份 type |
| Queue processor 實作 | `apps/worker/processors/` | **App 內** | 只有 worker 需要 |
| Notification providers (email, push) | `apps/api/modules/notifications/providers/` | **App 內** | Phase 1 夠簡單；Phase 2 如果 worker 也要發，再抽成 package |
| Config (ESLint, TSConfig) | `config/` | **Config 資料夾** | 非 package；被 extends/reference |
| Industry templates (knowledge, FAQ, playbook) | Root `templates/` 或 DB | **Data** | Phase 1 用 DB（tenant 自行設定）；templates 資料夾做為 seed data |

### 什麼時候應該從 app 抽成 package？

遵循 **Rule of Two**：
- 如果只有一個 app 用 → 留在 app 內
- 如果兩個以上 app 用 → 抽成 package
- 如果邏輯可以獨立測試且零 framework 依賴 → 值得抽 package（如 ai-engine）

### Phase 2 可能新增的 packages

| Package | Trigger |
|---------|---------|
| `packages/notification-providers` | 當 worker 也需要直接發 notification 時 |
| `packages/analytics` | 當 analytics 邏輯足夠複雜，多處需要 |

---

## 13. 開發工作流

### 日常開發命令

```bash
# 啟動基礎設施
pnpm docker:up                   # Start PostgreSQL + Redis

# 初始化 DB
pnpm db:generate                 # Generate Prisma client
pnpm db:migrate                  # Run migrations

# 同時啟動所有 app（Turborepo parallel）
pnpm dev                         # Starts web (3000) + api (3001) + worker

# 或只啟動需要的
pnpm dev:api                     # Only API server
pnpm dev:web                     # Only dashboard

# DB 管理
pnpm db:studio                   # Open Prisma Studio (GUI for DB)

# 全專案 lint / test
pnpm lint
pnpm test
```

### 新增 NestJS Module 的 SOP

```bash
# 1. 在 apps/api/src/modules/ 建立 folder
# 2. 建立 module / controller / service / dto
# 3. 在 app.module.ts imports 裡加上新 module
# 4. 如果有新 table → 更新 packages/database/prisma/schema.prisma
# 5. pnpm db:migrate 產生 migration
# 6. 如果有新 enum → 在 packages/shared/src/enums/ 加上
```

### 新增 Channel Adapter 的 SOP

```bash
# 1. 在 packages/channel-adapters/src/adapters/ 建立 folder
# 2. 實作 ChannelAdapter interface（normalizer + sender）
# 3. 在 adapter-factory.ts 註冊
# 4. 在 apps/api/src/modules/webhooks/ 加上 webhook endpoint
# 5. 在 packages/shared/src/enums/channel.enum.ts 加上新 ChannelType
```

---

## 14. Summary: What Gets Built in Phase 1

Phase 1 只需要實作以下 structure，Phase 2/3 的 folder 可以先建空 stub 或完全不建：

### Must Build (Phase 1)

```
apps/api/src/modules/
  ├── auth/           ✅
  ├── tenants/        ✅
  ├── users/          ✅
  ├── contacts/       ✅
  ├── conversations/  ✅
  ├── messages/       ✅
  ├── orders/         ✅
  ├── bookings/       ✅
  ├── follow-ups/     ✅
  ├── reminders/      ✅
  ├── notifications/  ✅ (basic: in-app + email)
  ├── knowledge-base/ ✅
  ├── channels/       ✅
  ├── webhooks/       ✅
  ├── dashboard/      ✅ (basic stats)
  └── settings/       ✅ (tenant AI config)

packages/
  ├── database/       ✅ (full schema from day 1)
  ├── shared/         ✅ (all enums + core types)
  ├── ai-engine/      ✅ (v1: context-assembler + signal-extractor + decision-engine + response-generator + guardrails)
  │                      (strategies: faq-responder, info-collector, booking-creator, order-creator, general-chat)
  └── channel-adapters/ ✅ (web-chat + whatsapp)

apps/web/
  ├── (auth)/         ✅ (login, register)
  └── (dashboard)/    ✅ (home, conversations, contacts, orders, bookings, follow-ups, knowledge-base, channels, settings)

apps/worker/
  ├── processors/     ✅ (message, reminder, follow-up, notification, channel-send)
  └── schedulers/     ✅ (reminder-check, follow-up-check)
```

### Defer to Phase 2

```
apps/api/src/modules/
  ├── scoring/
  ├── sales-playbooks/
  ├── objection-rules/
  └── handoffs/

packages/ai-engine/src/strategies/
  ├── objection-handler.strategy.ts
  ├── cta-pusher.strategy.ts
  └── handoff.strategy.ts

packages/ai-engine/src/pipeline/
  └── lead-state-engine.ts (activate FSM)

apps/web/(dashboard)/
  ├── pipeline/
  ├── handoffs/
  └── playbooks/
```

### Defer to Phase 3

```
apps/api/src/modules/
  ├── upsell-rules/
  ├── decision-profiles/
  └── analytics/

packages/ai-engine/src/strategies/
  ├── upsell.strategy.ts
  └── trust-repair.strategy.ts

apps/web/(dashboard)/
  └── analytics/
```
