# Internal pilot readiness — AI Top Sales

Checklist for running an **internal pilot or demo** of the current codebase (Phase 1: chat, AI engine, bookings, dashboard). Not a production go-live checklist.

---

## 1. Prerequisites

| Item | Notes |
|------|--------|
| **Node.js** | ≥ 20 (`engines` in root `package.json`) |
| **pnpm** | ≥ 9 (see `packageManager` in root `package.json`) |
| **Docker Desktop** (or compatible) | For PostgreSQL (+ Redis if you run the worker) |
| **Git** | Clean working tree optional but recommended before pilot |

---

## 2. Environment

1. Copy env template:
   ```bash
   cp .env.example .env
   ```
2. **Minimum for chat + API + web (pilot):**

   | Variable | Purpose |
   |----------|---------|
   | `DATABASE_URL` | PostgreSQL connection (default in `.env.example` matches `docker-compose` DB name `ai_top_sales`) |
   | `JWT_SECRET` | Auth (register/login); use a long random string for any shared demo |
   | `NEXT_PUBLIC_API_URL` | Web app → API (default `http://localhost:3001`) |
   | `APP_URL` | CORS / links (default `http://localhost:3000`) |
   | `API_PORT` | API listen port (default `3001`) |

3. **Redis** (`REDIS_HOST`, `REDIS_PORT`): required if you start **`pnpm dev:worker`**; not required for **API-only chat pilot** using `POST /api/chat/message`.

4. **`AI_ENGINE_MODE`** and **`OPENAI_API_KEY`**: Code default is **`auto`** — with a **non-empty key**, chat uses the **LLM JSON planner** (then template composers for wording). Set **`AI_ENGINE_MODE=rule`** to force **rule-only** (no OpenAI). LLM path (v1): improves **intent/extraction** routing; **all reply wording** still uses **template composers**. See [`ai-engine-llm.md`](./ai-engine-llm.md). **Do not commit real API keys** — keep them in local `.env` / `.env.local` only (both are gitignored).

---

## 3. Startup steps (recommended order)

```bash
# 1) Install
pnpm install

# 2) Infrastructure
pnpm docker:up

# 3) Prisma client + migrations
pnpm db:generate
pnpm db:migrate
# Production-like apply only:
# pnpm db:migrate:prod

# 4) Build workspace (ensures ai-engine + database client for API)
pnpm build
```

Start apps (pick what you need):

```bash
# API + Web (typical pilot)
pnpm dev:api
pnpm dev:web
# second terminal

# Optional: background worker (needs Redis)
pnpm dev:worker
```

---

## 4. Verify infrastructure

### PostgreSQL

- **Docker:** `docker compose ps` — `postgres` healthy.
- **Connect:** `pnpm db:studio` opens Prisma Studio against `DATABASE_URL`.
- **Quick SQL:** any client to `localhost:5432`, DB `ai_top_sales`, user/password from `DATABASE_URL`.

### Redis (if using worker)

```bash
redis-cli -h localhost -p 6379 ping
# Expect: PONG
```

### API

```bash
curl -s http://localhost:3001/api/health
# Expect JSON: { "status": "ok", ... }
```

Global prefix is **`/api`** (see `apps/api/src/main.ts`).

### Web

- Open `http://localhost:3000` — login after **tenant registration** (see demo script).

---

## 5. Run the verified chat E2E suite

**Purpose:** End-to-end **HTTP → Nest → Prisma → ai-engine → side effects** (not substitute for manual demo).

**Requires:** PostgreSQL up, migrations applied (including `bookings.idempotency_key`, `ai_runs.side_effect_failures`).

```bash
pnpm --filter @ats/ai-engine build
pnpm db:generate
pnpm --filter @ats/api build

cd apps/api
# PowerShell:
$env:RUN_CHAT_E2E='1'
pnpm test:chat-e2e
# bash:
# RUN_CHAT_E2E=1 pnpm test:chat-e2e
```

Details: [`api-chat-e2e-verification.md`](./api-chat-e2e-verification.md) · Spec: `apps/api/test/chat-flow.e2e-spec.ts`.

**If tests fail at `$connect`:** DB not running or wrong `DATABASE_URL`.

---

## 6. Pre-demo smoke (5 minutes)

- [ ] `GET /api/health` → `ok`
- [ ] Register/login on web; dashboard loads stats (may show `—` until data exists)
- [ ] At least one **Knowledge document** exists for the tenant (titles/content match services you will name in chat — see [`demo-script.md`](./demo-script.md))
- [ ] `POST /api/chat/message` returns `reply` + `conversationId` (use `tenantId` from your logged-in tenant)

---

## 7. Related docs

| Doc | Use |
|-----|-----|
| [`demo-script.md`](./demo-script.md) | Step-by-step demo scenarios |
| [`known-limitations.md`](./known-limitations.md) | What not to promise in pilot |
| [`api-chat-e2e-verification.md`](./api-chat-e2e-verification.md) | Chat E2E harness |

---

## 8. Recovery & troubleshooting

### Database down / Prisma errors

| Symptom | Action |
|---------|--------|
| `PrismaClientInitializationError`, E2E fails at `$connect` | Start Postgres: `pnpm docker:up`. Confirm `DATABASE_URL` host/port/db match `docker-compose` (default DB name `ai_top_sales`). |
| Migration errors | From repo root: `pnpm db:generate` then `pnpm db:migrate` (dev) or `pnpm db:migrate:prod` (deploy-style). |
| “Table does not exist” | Migrations not applied — run migrate before API/E2E. |

### Duplicate bookings / idempotency

| Symptom | Action |
|---------|--------|
| Worried about double-send | AI path uses **`BookingsService.upsertFromAiSideEffect`** + **`idempotencyKey`** (tenant + contact + trimmed service + start instant). Same payload → same key → upsert, not a second row. |
| Still see two rows | Check **different** `externalContactId`, **different** service string, or **different** resolved start time. Manual **`POST /api/bookings`** may not set idempotency — avoid blind retries there. |

### Booking failure path (`CREATE_BOOKING` fails)

| Symptom | Action |
|---------|--------|
| HTTP 200 but `sideEffectFailures` non-empty | Inspect `sideEffectFailures` and latest **`AiRun`**: `status` **`ERROR`**, `error` text, persisted **`signals`** with **`_integration.bookingPersisted: false`** and **cleared** draft `date`/`time` (avoids stuck “confirmed” UX). |
| Contact updated but no booking | **`UPDATE_CONTACT`** may succeed while **`CREATE_BOOKING`** fails — always read **`sideEffectFailures`**, not reply tone alone. |

### Draft weirdness / context mismatch

| Symptom | Action |
|---------|--------|
| Wrong service price after switching topic | Engine uses **`allowsDraftServiceFallback`** for PRICE/DETAIL: if the user names a new service (≥2 chars extracted), **draft service is not reused**. If still wrong, check **knowledge doc titles** and **service matcher** aliases. |
| “7點” not booking | Intentionally strict time parsing — ask for **上午/下午** or **24h** (see [`known-limitations.md`](./known-limitations.md)). |
| Draft empty mid-flow | **`bookingDraft`** is restored from **last `AiRun.signals`**; missing/failed runs can drop context — use a **consistent `externalContactId`** per demo customer and avoid deleting `AiRun` rows during tests. |

### Redis / worker

| Symptom | Action |
|---------|--------|
| Worker crashes or jobs stall | Ensure `REDIS_*` matches running Redis; `pnpm docker:up` includes Redis if your compose file defines it. Chat-only pilot can skip worker. |

---

## 9. Recommended next engineering priorities (after pilot)

Priorities aligned with **closing pilot gaps**, not big refactors:

1. **Secure `POST /api/chat/message`** — JWT, API key, or signed channel token + rate limiting before any public exposure.
2. **Optional LLM path** — Feature-flag real OpenAI (or other) behind `runAiEngine` while keeping mock for regression tests.
3. **First-class draft store** — Persist `bookingDraft` on `Conversation` (or dedicated table) instead of inferring only from last `AiRun.signals`.
4. **Staff confirmation workflow** — UI/actions to move `Booking` from `PENDING` → confirmed/cancelled; notifications (email/WhatsApp).
5. **CI for chat E2E** — Postgres service container + `RUN_CHAT_E2E=1` on main branch after schema stabilises.
6. **Observability** — Structured logs + correlation id (`conversationId` / `aiRunId`) on chat path for pilot feedback triage.

---

## 10. Sign-off (internal)

| Role | Name | Date | Notes |
|------|------|------|-------|
| Pilot lead | | | |
| Engineering | | | E2E green / waived: |
| Stakeholder | | | |
