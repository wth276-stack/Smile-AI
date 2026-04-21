# AI Top Sales / Smile AI — Project Snapshot 2026-04-21

**Commit:** `ca9d4f9` fix(booking): persist validated action/intent in conversation history
**Branch:** main (pushed, Railway deploying)

---

## Architecture

Monorepo (pnpm workspace) with 4 apps + 4 packages:

| Package | Path | Purpose |
|---------|------|---------|
| @ats/api | `apps/api` | NestJS backend (Express), WhatsApp webhook, booking engine |
| @ats/web | `apps/web` | Next.js admin dashboard |
| @ats/worker | `apps/worker` | BullMQ reminder processor |
| @ats/ai-engine | `packages/ai-engine` | V2 LLM booking engine (OpenAI JSON mode) |
| @ats/api-server | `packages/api-server` | Express API routes |
| @ats/database | `packages/database` | Prisma ORM, conversation helpers |
| @ats/shared | `packages/shared` | Shared types, constants, utils |
| @ats/channel-adapters | `packages/channel-adapters` | Channel abstraction types |

**Infrastructure:** Railway (Node), PostgreSQL (Railway), WhatsApp Business API (Meta Cloud)

---

## Key Files (Booking Flow)

### API Layer
| File | Role |
|------|------|
| `apps/api/src/modules/chat/chat.service.ts` | Central orchestrator: loads state, calls engine, persists draft/signals |
| `apps/api/src/modules/chat/ai-message-metadata.ts` | **NEW** — Patches rawLlmJson action/intent to validated values before persisting |
| `apps/api/src/modules/chat/ai-message-metadata.spec.ts` | **NEW** — 9 Jest regression tests for metadata patching |
| `apps/api/src/modules/chat/chat-persistence.service.ts` | AiRun save, side-effect execution, confirmationPending reset |
| `apps/api/src/modules/chat/stale-confirmation-escape.ts` | Detects FAQ/price queries during pending confirmation |
| `apps/api/src/modules/whatsapp/whatsapp-webhook.service.ts` | Inbound WhatsApp messages, wa_id phone extraction |
| `apps/api/src/modules/whatsapp/whatsapp-sender.service.ts` | Outbound WhatsApp messages via Cloud API |
| `apps/api/src/modules/whatsapp/whatsapp-webhook.controller.ts` | GET/POST webhook endpoints with HMAC verification |

### AI Engine (V2)
| File | Role |
|------|------|
| `packages/ai-engine/src/v2/engine.ts` | Main V2 engine: LLM call, validation, slot fallback, confirmation boundary |
| `packages/ai-engine/src/v2/validator.ts` | Action coercion (REPLY→CONFIRM_BOOKING), affirmation detection, date-swap fix |
| `packages/ai-engine/src/v2/prompt.ts` | System prompt builder: KB formatting, date calendar, booking state |
| `packages/ai-engine/src/v2/date-utils.ts` | HK timezone date helpers |
| `packages/ai-engine/src/v2/confirmation-boundary.ts` | Case 3 deterministic confirmation template |
| `packages/ai-engine/src/v2/booking-confirmation-rejection.ts` | Detects user rejection of booking confirmation |
| `packages/ai-engine/src/v2/engine.booking-rescue.test.ts` | 25 Vitest regression tests for booking flow |
| `packages/ai-engine/src/service-matcher.ts` | Service catalog matching (exact/close/ambiguous) |

### Database
| File | Role |
|------|------|
| `packages/database/src/conversation-helpers.ts` | `updateBookingDraft`, `getConversationBookingState`, metadata merge |
| `packages/database/src/v2-helpers.ts` | V2 AiRun queries |
| `packages/database/prisma/seed-demo.ts` | Demo tenant + KB seed data |

---

## Booking Flow State Machine

```
User: "我想預約HIFU"
  → COLLECT_BOOKING (infer service, collect date/time/name/phone)
  → REPLY coerced to CONFIRM_BOOKING if all 5 slots filled + confirmation summary

User: "星期四，4點，Yuki，64991498"
  → COLLECT_BOOKING (merge slots, WhatsApp wa_id auto-fills phone)
  → CONFIRM_BOOKING if all slots filled

User: "正確" / "好" / "確認"
  → SUBMIT_BOOKING (confirmationPending=true required)
  → CREATE_BOOKING side effect

User: "唔啱" / "想改"
  → COLLECT_BOOKING (rejection detected)

Duplicate affirm guard:
  SUBMIT_BOOKING without confirmationPending → REPLY_ONLY (prevents double-booking)
```

### Slot Priority
```
phone:    bookingDraft.phone > extracted.phone > waPhone (stripped 852 prefix)
customerName: bookingDraft.customerName > extracted.customerName > (no WhatsApp profile name)
service:  mergedDraft > LLM newSlots > inferMissingService > deterministicSlotFallback
```

### Action Coercion Rules
- REPLY + full draft + confirmation summary → CONFIRM_BOOKING (deterministic)
- REPLY + full draft + user affirmation text → SUBMIT_BOOKING (simple guard)
- confirmationPending + affirmation → SUBMIT_BOOKING (clears LLM slot noise)
- CONFIRM_BOOKING + missing slots → COLLECT_BOOKING (rescue + re-ask)
- SUBMIT_BOOKING without confirmationPending → REPLY_ONLY (duplicate-affirm guard)

---

## WhatsApp Integration

- **Webhook:** `POST /whatsapp/webhook` (HMAC verified)
- **Verification:** `GET /whatsapp/webhook?hub.verify_token=...`
- **Phone auto-fill:** `wa_id` → strip `852` prefix → local 8-digit HK number
- **Customer name:** NOT auto-filled from WhatsApp profile (explicitly avoided)

---

## Recent Commits (Booking Flow Fixes)

| Commit | Description |
|--------|-------------|
| `ca9d4f9` | Persist validated action/intent in conversation history (patch rawLlmJson) |
| `8fafa2c` | Deterministic CONFIRM_BOOKING coercion + remove WhatsApp customerName auto-fill |
| `859ca1c` | Resolve TS2871 strict null check in booking-rescue test |
| `f3ea6a3` | WhatsApp phone auto-fill + service carry-forward + inferMissingService |
| `3005188` | Rescue missing booking slots before CONFIRM_BOOKING downgrade |

---

## Known Issues / Deferred

| Issue | Status |
|-------|--------|
| Price display `$D 3,800` → `$3,800` | Deferred — prompt.ts regex needs `HKD?\s*` instead of `HK\$?` |
| Conversation history shows raw LLM action before this commit | **Fixed** — `buildAiMessageMetadata` now patches action/intent |
| WhatsApp profile name polluting customerName | **Fixed** — removed customerName auto-fill from profile |

---

## Test Suite

| Suite | Runner | Files | Tests |
|-------|--------|-------|-------|
| @ats/ai-engine v2 | Vitest | 5 files | 25 passing |
| @ats/api metadata | Jest | 1 file | 9 passing |
| @ats/api chat-persistence | Jest | 1 file | (existing) |
| @ats/api bookings idempotency | Jest | 1 file | (existing) |

---

## Deployment

- **Platform:** Railway (auto-deploy on push to `main`)
- **Database:** PostgreSQL on Railway (Prisma migrations)
- **WhatsApp:** Meta Cloud API (permanent token via System User)
- **Environment:** `demo-tenant` with 6 KB documents (HIFU, facial, anti-aging, RF, laser, firming)