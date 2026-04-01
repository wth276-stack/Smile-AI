# Known limitations & non-production caveats

Grounded in the **current** AI Top Sales codebase (chat → `@ats/ai-engine` → Prisma). Use this in pilot briefings so expectations stay honest. Short summary of the AI layer: root **`README.md`** (Tech stack → AI Engine).

---

## 1. AI engine

| Limitation | Detail |
|------------|--------|
| **Modes** | Code default **`AI_ENGINE_MODE=auto`** when unset: **with `OPENAI_API_KEY` set**, OpenAI JSON planner runs for intent/extraction/merge hints; **without a key**, behaviour matches rule-only. **`AI_ENGINE_MODE=rule`** forces deterministic `processMessage()` only (tokens 0 from planner). **All customer reply text** in v1 still from **`compose*`** templates. Semantic checks; failures → **rule fallback**. See [`ai-engine-llm.md`](./ai-engine-llm.md). |
| **Rule-based baseline** | With `rule` mode (or LLM fallback), behaviour is the existing intent routing + templates + knowledge text. |
| **No live calendar** | Date/time parsing uses **local `Date`** rules in `packages/ai-engine` (e.g. 聽日/明天, weekdays). **No** Google Calendar / staff roster / real availability. |
| **Ambiguous times** | Bare **「7點」** without 上午/下午/晚上 or 24h time may yield **no time slot** extracted on purpose — avoids wrong AM/PM guesses. |
| **Service matching** | Fuzzy match + ambiguity handling: some inputs may **disambiguate** or **mis-match** if knowledge titles/aliases don’t cover colloquial names. |

---

## 2. Chat API & persistence

| Limitation | Detail |
|------------|--------|
| **`POST /api/chat/message` is unauthenticated** | Controller has **no JWT guard** today — fine for **internal** pilot behind VPN; **do not** expose raw to the public internet without auth / rate limits. |
| **Draft source** | `bookingDraft` is loaded from the **latest `AiRun.signals`** for that conversation — not a separate “draft table”. If `signals` shape drifts or runs are missing, draft restore can be wrong. |
| **`AiRun` is append-only** | Each turn creates a new row; analytics must **read JSON** (`signals`, `sideEffects`, `sideEffectFailures`) — dashboards don’t auto-wire every field today. |

---

## 3. Bookings & side effects

| Limitation | Detail |
|------------|--------|
| **Semantics** | Engine **`REQUEST_BOOKING`** maps to a **`CREATE_BOOKING` side effect** that **inserts** a `Booking` row (`PENDING`). Copy says “submit to shop” — **not** the same as staff-confirmed appointment. |
| **Idempotency scope** | Duplicate protection uses **`idempotencyKey`** = hash(tenant + contact + **trim(serviceName)** + **startTime ms**). Two **different** bookings at the **exact same instant** for the same contact/service would collapse to one row (rare). |
| **Manual API bookings** | `POST /bookings` from dashboard API creates rows **without** `idempotencyKey` — duplicates are still possible there if clients retry blindly. |
| **Partial failure** | If **`CREATE_BOOKING`** fails, latest run is **`ERROR`** with **`sideEffectFailures`** and **sanitised `signals`** (`date`/`time` cleared, `_integration.bookingPersisted: false`). **`UPDATE_CONTACT`** can still succeed in the same turn — check `sideEffectFailures` for the full picture. |

---

## 4. Product / UX

| Limitation | Detail |
|------------|--------|
| **Web chat UI** | Primary demo path in docs is **HTTP API**; web dashboard lists **conversations/bookings** but may not embed a full chat widget for customers yet. |
| **Channels** | DTO allows `WEBCHAT` / `WHATSAPP`; **WhatsApp delivery** depends on channel adapters + config not covered in this doc. |
| **Worker / Redis** | BullMQ worker is **optional** for the chat pilot path; required for queued jobs as product grows. |

---

## 5. Testing

| Limitation | Detail |
|------------|--------|
| **Chat E2E** | `pnpm test:chat-e2e` requires **`RUN_CHAT_E2E=1`** and a **real PostgreSQL** with migrations. It is **not** part of default `pnpm test` unless you wire CI. |

---

## What this is **not**

- Not a HIPAA / PCI audit checklist.  
- Not a load test (concurrency, rate limits).  
- Not a legal review of messaging in your jurisdiction.

For pilot, treat as **internal demo quality** with **staff confirmation** still the source of truth for real appointments.
