# Demo script — AI Top Sales (internal pilot)

**Audience:** Internal stakeholders / store ops / engineering  
**Duration:** ~15–20 minutes (7 scenarios)  
**Assumption:** API + Web running, PostgreSQL migrated, tenant registered, **knowledge base** seeded with at least two services (e.g. **Eye Treatment** with `價錢：HKD 680`, **HIFU 緊緻** with `價錢：HKD 1200`) so the **rule-based ai-engine** can match names and prices.

**Chat entry point:** `POST http://localhost:3001/api/chat/message`  
Body (JSON): `tenantId`, `channel` (`WEBCHAT` or `WHATSAPP`), `externalContactId` (unique per “customer”), `message`, optional `contactName`.

---

## Before you start

1. Copy `tenantId` from DB (Prisma Studio → `tenants`) or from JWT/session context after login.
2. Use a **fresh `externalContactId`** per demo run (e.g. `demo-alice-001`) so drafts don’t collide with earlier tests.
3. Optional: open **Conversations** and **Bookings** in the web app in another tab to show live persistence.

---

## Scenario 1 — Greeting & service inquiry

**Say / send (message):**  
`你好`  
then  
`我想了解 Eye Treatment`

| Step | Expected outcome |
|------|------------------|
| HTTP 200 | JSON with `reply` (Cantonese-style assistant copy). |
| Second turn | Reply includes **service summary** from knowledge (not empty menu only). |
| DB | New **contact** (if first time), **conversation**, **messages** (customer + AI), **`AiRun`** row with `status: SUCCESS`, `signals.intents` includes **`PRODUCT_INQUIRY`**. |

**Talking point:** “AI reads our knowledge documents, no fake ‘always in stock’ claims in the current copy.”

---

## Scenario 2 — Price question

**Send:** `Eye Treatment 幾錢？`

| Expected |
|----------|
| Reply mentions **HKD 680** (or your doc’s price line). |
| `signals.intents` includes **`PRICE_INQUIRY`**. |
| No booking row yet unless user also completed a booking flow. |

---

## Scenario 3 — Booking with full details (happy path)

**Send (adjust “明天” if needed for clarity):**  
`我想預約 Eye Treatment，明天晚上7點，我叫陳大文電話91234567`

| Expected |
|----------|
| Reply confirms **submission to shop** wording (not “already confirmed booking”). |
| **`sideEffectFailures`**: empty array in HTTP response. |
| **Contact:** `name` **陳大文**, `phone` **91234567** (not “陳大文電話” glued). |
| **Booking:** one row, `status` **PENDING**, `serviceName` matches display name from engine. |
| **Latest `AiRun`:** `status: SUCCESS`, `signals.action` **`REQUEST_BOOKING`**, `sideEffects` includes executed effects. |

**Talking point:** “REQUEST_BOOKING = pending staff confirmation; CRM row is created for follow-up.”

---

## Scenario 4 — Booking follow-up with draft (time-only)

**Use a new `externalContactId`**, e.g. `demo-bob-002`.

1. `我想預約 Eye Treatment`  
2. `晚上7點`

| Expected |
|----------|
| After step 1: AI asks for missing slots (e.g. date). |
| After step 2: **Time** merged into draft; latest `AiRun` **`signals.intents`** includes **`BOOKING_REQUEST`** (matches E2E **S4**). |
| No duplicate phantom “OTHER” intent for a pure time follow-up when draft exists. |

---

## Scenario 5 — Cross-service price while prior context exists

**Use a new `externalContactId`**, e.g. `demo-carol-003`.

1. `我想了解 Eye Treatment`  
2. `HIFU 幾錢？`

| Expected |
|----------|
| Second reply reflects **HIFU** price (**1200**), **not** 680 — current message wins over stale context for **price** (matches E2E **S7**). |

---

## Scenario 6 — Idempotent retry (duplicate full booking message)

Use **`externalContactId`** from scenario 3 (or resend the **exact same** full booking sentence twice in a row).

| Expected |
|----------|
| Still **one** logical booking for that contact + same slot key (**idempotency** on `CREATE_BOOKING`). |
| Second response should not create a second row for the same tenant/contact/service/start instant. |

**Talking point:** “Retries or double-send won’t spam duplicate bookings for the same slot.”

---

## Scenario 7 — Dashboard & conversation review (UI)

1. Open **Conversations** → open the thread you used.  
2. Open **Bookings** → show **PENDING** row.  
3. Open **Knowledge base** → show the doc the AI used.

| Expected |
|----------|
| Message order: customer then AI, repeated per turn. |
| Booking visible with correct service name and start time. |

---

## Optional stress messages (Q&A)

| Message | Purpose |
|---------|---------|
| `聽日晚上7點` (with booking intent) | Cantonese **聽日** = tomorrow (date extraction). |
| `7點` alone | Engine may **not** infer AM/PM; assistant asks for 上午/下午 or 24h — intentional safety. |

---

## Closing line for stakeholders

“This pilot uses a **deterministic AI engine** for reliability in demos; live LLM can be wired later. Bookings are **PENDING** until staff confirm in your real process.”
