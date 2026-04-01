# Phase 1 Freeze — Booking Line MVP

> Freeze date: 2026-03-19
> Target: demo-ready end-to-end in 2–4 weeks
> Primary flow: webchat → inbound message → contact resolve → conversation → AI reply → booking create → dashboard

---

## 1. Scope: IN vs OUT

### 1.1 Backend Modules

| Module | Status | Reason |
|--------|--------|--------|
| auth | **P1 必做** | 註冊/登入/JWT — 已有骨架 |
| tenants | **P1 必做** | 租戶設定讀取 — 已有骨架 |
| contacts | **P1 必做** | resolve-or-create + CRUD — 已有骨架，需補 resolve |
| conversations | **P1 必做** | 對話管理 + message 寫入 — 已有骨架，需補 inbound |
| bookings | **P1 必做** | CRUD + AI 自動建立 — 需新建 |
| knowledge-base | **P1 必做** | FAQ/知識文檔 CRUD + 搜尋 — 已有骨架 |
| chat (inbound) | **P1 必做** | 收訊息 → AI → 回覆的 orchestration endpoint — 需新建 |
| health | **P1 必做** | 已完成 |
| orders | 延後 P1.5 | schema 保留，不寫 module 代碼 |
| followups | 延後 P1.5 | schema 保留，不寫 module 代碼 |
| reminders | 延後 P1.5 | schema 保留，不寫 module 代碼 |
| worker (BullMQ) | 延後 P1.5 | 骨架保留，不寫 processor 邏輯 |
| channel-adapters | 延後 P2 | WhatsApp/IG/FB — P1 只做 webchat (直接 REST) |
| dashboard-stats | 延後 P1.5 | 前端先用 placeholder，後補 API |

### 1.2 Prisma Models

| Model | Status | Active Module Code |
|-------|--------|--------------------|
| Tenant | **P1 必做** | Yes |
| User | **P1 必做** | Yes (auth) |
| Contact | **P1 必做** | Yes |
| Conversation | **P1 必做** | Yes |
| Message | **P1 必做** | Yes |
| Booking | **P1 必做** | Yes |
| KnowledgeDocument | **P1 必做** | Yes |
| AiRun | **P1 必做** | Yes (observability) |
| ChannelConfig | **P1 必做** | Yes (webchat config) |
| Order | schema 保留 | No module code |
| FollowUpTask | schema 保留 | No module code |
| Reminder | schema 保留 | No module code |

> Schema 保持 15 個 model，但只有 9 個有對應的 working module code。
> Order / FollowUpTask / Reminder 留在 schema 因為未來遷移成本為零。

### 1.3 API Endpoints

**P1 必做：**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | 租戶註冊 |
| POST | /api/auth/login | 登入 |
| POST | /api/auth/refresh | 刷新 token |
| GET | /api/auth/me | 當前用戶 |
| GET | /api/tenants/current | 租戶資訊 |
| PATCH | /api/tenants/settings | 更新設定 |
| GET | /api/contacts | 聯絡人列表 |
| GET | /api/contacts/:id | 聯絡人詳情 |
| POST | /api/contacts | 建立聯絡人 |
| PATCH | /api/contacts/:id | 更新聯絡人 |
| GET | /api/conversations | 對話列表 |
| GET | /api/conversations/:id | 對話 + 訊息 |
| GET | /api/bookings | 預約列表 |
| GET | /api/bookings/:id | 預約詳情 |
| POST | /api/bookings | 手動建立預約 |
| PATCH | /api/bookings/:id | 更新預約 |
| GET | /api/knowledge-base | 知識文檔列表 |
| GET | /api/knowledge-base/search?q= | 搜尋知識 |
| POST | /api/knowledge-base | 新增文檔 |
| PATCH | /api/knowledge-base/:id | 更新文檔 |
| POST | /api/chat/message | **核心：收訊息 → AI 回覆** |
| GET | /api/health | 健康檢查 |

**延後：**

| Endpoint | Reason |
|----------|--------|
| /api/orders/* | P1.5 |
| /api/followups/* | P1.5 |
| /api/reminders/* | P1.5 |
| /api/dashboard/stats | P1.5 (前端先用 placeholder) |
| /api/webhooks/whatsapp | P2 |
| /api/webhooks/instagram | P2 |
| /api/handoff/* | P2 |
| /api/playbooks/* | P2 |
| /api/scoring/* | P2 |

### 1.4 Frontend Pages

**P1 必做：**

| Route | Description |
|-------|-------------|
| /login | 登入 — 已有 |
| /register | 註冊 — 已有 |
| /dashboard | 主控台（stats placeholder）— 已有 |
| /dashboard/conversations | 對話列表 — 需接 API |
| /dashboard/conversations/[id] | 對話詳情 + 聊天視窗 — 需新建 |
| /dashboard/contacts | 聯絡人列表 — 需接 API |
| /dashboard/bookings | 預約列表 — 需新建 |
| /dashboard/knowledge-base | 知識庫管理 — 需接 API |
| /dashboard/settings | 基本設定 — 已有 placeholder |

**延後：**

| Route | Reason |
|-------|--------|
| /dashboard/orders | P1.5 |
| /dashboard/followups | P1.5 |
| /dashboard/contacts/[id] | P1.5 (先用 modal) |
| /dashboard/bookings/[id] | P1.5 (先用 modal) |
| /dashboard/settings/ai | P2 |
| /dashboard/settings/channels | P2 |
| /dashboard/analytics | P2 |

---

## 2. Primary Flow — Booking Line

```
Customer (webchat)
    │
    ▼
POST /api/chat/message
  { tenantId, channel: "WEBCHAT", externalContactId, message }
    │
    ├── 1. Contact Resolve ── findOrCreate by externalId
    ├── 2. Conversation Resolve ── findOrCreate OPEN conversation
    ├── 3. Save inbound Message
    ├── 4. AI Engine (6 layers)
    │      ├── Context Assembler
    │      ├── Knowledge Retriever
    │      ├── Signal Extractor ──┐
    │      ├── Decision Engine    │ single LLM call
    │      ├── Response Generator ┘
    │      └── Side Effect Collector
    ├── 5. Execute side effects (create booking, update contact)
    ├── 6. Save AI Message
    ├── 7. Save AiRun log
    └── 8. Return { reply, conversationId, sideEffects }
    │
    ▼
Dashboard sees: new conversation, new booking, updated contact
```

### Chat endpoint contract

**Request:**
```json
{
  "tenantId": "cuid",
  "channel": "WEBCHAT",
  "externalContactId": "webchat_visitor_abc123",
  "contactName": "陳先生",
  "message": "我想預約下星期三下午剪髮"
}
```

**Response:**
```json
{
  "reply": "好的陳先生！請問你想預約下星期三幾點？我們下午 2-8 點有空檔。",
  "conversationId": "cuid",
  "contactId": "cuid",
  "sideEffects": [
    { "type": "UPDATE_CONTACT", "data": { "name": "陳先生" } }
  ]
}
```

---

## 3. AI Engine — Phase 1 Minimal (6 Layers)

```
AiEngineInput
    │
    ▼
┌─────────────────────────┐
│  1. Context Assembler    │  code — 組裝 tenant settings + contact + messages
├─────────────────────────┤
│  2. Knowledge Retriever  │  code — ILIKE keyword search in knowledge_documents
├─────────────────────────┤
│  3. Signal Extractor     │  ┐
├─────────────────────────┤  │
│  4. Decision Engine      │  ├── SINGLE LLM call (structured JSON output)
├─────────────────────────┤  │
│  5. Response Generator   │  ┘
├─────────────────────────┤
│  6. Side Effect Collector│  code — parse LLM JSON → typed SideEffect[]
└─────────────────────────┘
    │
    ▼
AiEngineResult
```

### Single LLM call strategy

P1 uses ONE LLM call that returns structured JSON:

```json
{
  "reply": "自然語言回覆",
  "intents": ["BOOKING_REQUEST"],
  "extractedFields": { "name": "陳先生", "service": "剪髮", "preferredDate": "下星期三下午" },
  "action": "ASK_TIME_SLOT" | "CREATE_BOOKING" | "REPLY_ONLY" | "ASK_INFO",
  "bookingData": { "serviceName": "剪髮", "startTime": "2026-03-25T14:00:00Z" },
  "shouldHandoff": false
}
```

### P1 intent types (exhaustive list)

| Intent | Description |
|--------|-------------|
| GREETING | 打招呼 |
| FAQ | 一般查詢 |
| BOOKING_REQUEST | 想預約 |
| BOOKING_CHANGE | 想改預約 |
| BOOKING_CANCEL | 想取消預約 |
| PRICE_INQUIRY | 問價 |
| AVAILABILITY_CHECK | 問有無空 |
| CONTACT_INFO | 提供個人資料 |
| OTHER | 其他 |

### P1 action types (exhaustive list)

| Action | Side Effect |
|--------|-------------|
| REPLY_ONLY | 無 |
| ASK_INFO | 無（AI 追問客戶資料） |
| ASK_TIME_SLOT | 無（AI 提供可選時段） |
| CREATE_BOOKING | → Booking.create |
| UPDATE_CONTACT | → Contact.update |
| CREATE_BOOKING + UPDATE_CONTACT | → 兩者 |

### 刪除的層（P2+）

- ❌ Intent Classifier (獨立 code 層) — P1 由 LLM 在一次 call 內完成
- ❌ Objection Classifier — P2
- ❌ Lead State Engine — P2
- ❌ Tone & Persona Layer — P3
- ❌ Closing Reinforcement — P3
- ❌ Upsell / Cross-sell Layer — P3
- ❌ Handoff Evaluator — P2 (P1 只用 shouldHandoff flag)
- ❌ Analytics / Learning Loop — P3

---

## 4. Explicit Exclusions (Phase 1 不做)

### Database
- ❌ Playbook table
- ❌ HandoffLog table
- ❌ ObjectionEvent table
- ❌ LeadScore / ScoringRule tables
- ❌ SalesAction table
- ❌ ConversationSummary table
- ❌ DecisionIdentityProfile table
- ❌ UpsellRule table

### Backend Logic
- ❌ Lead scoring calculations
- ❌ Lead state machine
- ❌ Objection detection / handling
- ❌ Handoff workflow (只有 boolean flag)
- ❌ Conversation summary generation
- ❌ Sales playbook matching
- ❌ BullMQ job processing
- ❌ WhatsApp webhook handler
- ❌ Instagram / Facebook integration
- ❌ Advanced analytics / reporting

### Frontend
- ❌ Sales pipeline / kanban view
- ❌ Lead scoring display
- ❌ Objection analytics
- ❌ Playbook management
- ❌ Advanced AI settings
- ❌ Channel configuration wizard
- ❌ Analytics dashboard
- ❌ Dark mode (P1.5)

### AI Engine
- ❌ Multi-call LLM pipeline
- ❌ RAG vector search
- ❌ Tone adaptation
- ❌ Closing reinforcement
- ❌ Upsell / cross-sell
- ❌ Decision identity detection
- ❌ Prompt optimization loop

---

## 5. Implementation Order

### Sprint 1 (Week 1–2): Foundation → Inbound

| # | Task | Files | Depends On |
|---|------|-------|------------|
| 1 | pnpm install + DB migrate | root | — |
| 2 | Auth flow E2E (register → login → JWT) | existing | 1 |
| 3 | Knowledge base CRUD (backend + frontend) | existing + frontend | 2 |
| 4 | Bookings module (backend CRUD) | new | 2 |
| 5 | Chat module — inbound endpoint | new | 2, 3 |
| 6 | Contact resolve-or-create | modify contacts.service | 2 |
| 7 | Conversation resolve-or-create | modify conversations.service | 2 |

### Sprint 2 (Week 2–3): AI Engine → Booking Flow

| # | Task | Files | Depends On |
|---|------|-------|------------|
| 8 | AI engine 6-layer implementation | packages/ai-engine/ | 3 |
| 9 | Chat module wires AI engine + side effects | chat module | 5, 6, 7, 8 |
| 10 | Conversation thread view (frontend) | new page | 9 |
| 11 | Bookings page (frontend) | new page | 4 |
| 12 | Contacts page connects to API | modify page | 6 |

### Sprint 3 (Week 3–4): Polish → Demo

| # | Task | Files | Depends On |
|---|------|-------|------------|
| 13 | Dashboard stats (basic counts) | API + frontend | 9 |
| 14 | Webchat widget (embeddable snippet) | new component | 9 |
| 15 | Seed data for demo | prisma/seed.ts | 9 |
| 16 | End-to-end smoke test | manual | all |

---

## 6. File-by-File Plan

### 6.1 Existing files — NO CHANGE needed

```
.env.example
.gitignore
.prettierrc
package.json
pnpm-workspace.yaml
turbo.json
docker/docker-compose.yml
config/tsconfig/*.json

packages/shared/src/enums/index.ts        ← enums 保持不動（含 P2/3 enums）
packages/shared/src/types/index.ts
packages/shared/src/utils/index.ts
packages/shared/src/constants/index.ts
packages/shared/src/index.ts
packages/shared/package.json
packages/shared/tsconfig.json

packages/database/prisma/schema.prisma    ← 15 models 保持不動
packages/database/src/client.ts
packages/database/src/tenant-scope.ts
packages/database/src/index.ts
packages/database/package.json
packages/database/tsconfig.json

packages/channel-adapters/*               ← interface 保留，不實作

apps/api/src/common/*                     ← 全部保留
apps/api/src/modules/auth/*               ← 全部保留
apps/api/src/modules/tenants/*            ← 全部保留
apps/api/src/modules/health/*             ← 全部保留
apps/api/src/modules/knowledge-base/*     ← 全部保留
apps/api/package.json
apps/api/tsconfig.json
apps/api/nest-cli.json

apps/web/app/layout.tsx
apps/web/app/globals.css
apps/web/app/page.tsx
apps/web/app/(auth)/*                     ← login + register 保留
apps/web/lib/api-client.ts
apps/web/lib/cn.ts
apps/web/stores/auth-store.ts
apps/web/package.json
apps/web/next.config.ts
apps/web/postcss.config.mjs
apps/web/tsconfig.json
```

### 6.2 Existing files — MODIFY

| File | Change |
|------|--------|
| `apps/api/src/app.module.ts` | 加入 BookingsModule + ChatModule |
| `apps/api/src/modules/contacts/contacts.service.ts` | 加 resolveOrCreate() |
| `apps/api/src/modules/conversations/conversations.service.ts` | 加 resolveOrCreate() + addMessage() |
| `packages/ai-engine/src/types.ts` | 簡化：移除 P2/P3 fields (leadStage, objection, decisionStyle) |
| `packages/ai-engine/src/orchestrator.ts` | 實作 6 層 pipeline |
| `apps/web/app/(dashboard)/layout.tsx` | 移除 orders/followups nav items (P1.5) |
| `apps/web/app/(dashboard)/dashboard/page.tsx` | 接 stats API (Sprint 3) |
| `apps/web/app/(dashboard)/dashboard/conversations/page.tsx` | 接真實 API |
| `apps/web/app/(dashboard)/dashboard/contacts/page.tsx` | 接真實 API |
| `apps/web/app/(dashboard)/dashboard/knowledge-base/page.tsx` | 接真實 API + CRUD |

### 6.3 New files — CREATE

**Backend:**

```
apps/api/src/modules/bookings/
  ├── bookings.module.ts
  ├── bookings.controller.ts
  └── bookings.service.ts

apps/api/src/modules/chat/
  ├── chat.module.ts
  ├── chat.controller.ts          ← POST /api/chat/message
  ├── chat.service.ts             ← orchestrates the booking line flow
  └── dto/
      └── chat-message.dto.ts
```

**AI Engine:**

```
packages/ai-engine/src/
  ├── layers/
  │   ├── context-assembler.ts
  │   ├── knowledge-retriever.ts
  │   ├── llm-call.ts             ← single LLM call (signal + decision + response)
  │   └── side-effect-collector.ts
  ├── prompts/
  │   └── booking-assistant.ts    ← system prompt template
  ├── orchestrator.ts             ← rewrite: 6-layer pipeline
  └── types.ts                    ← simplify for P1
```

**Frontend:**

```
apps/web/app/(dashboard)/dashboard/conversations/[id]/
  └── page.tsx                    ← 對話詳情 + 聊天視窗

apps/web/app/(dashboard)/dashboard/bookings/
  └── page.tsx                    ← 預約列表

apps/web/components/
  └── chat-widget.tsx             ← Sprint 3: 可嵌入 webchat widget
```

**Database:**

```
packages/database/prisma/
  └── seed.ts                     ← Sprint 3: demo seed data
```

### 6.4 Existing files — DELETE or EMPTY

| File | Action |
|------|--------|
| `apps/web/app/(dashboard)/dashboard/settings/page.tsx` | 保留 placeholder，不擴展 |
| `apps/worker/src/processors/reminder.processor.ts` | 保留空殼，不實作 |

### 6.5 Empty folders to KEEP (for structure)

```
apps/worker/src/processors/       ← P1.5
packages/channel-adapters/src/    ← P2
```

---

## 7. Minimized Prisma Model Summary

**9 active models (有 module code):**

```
Tenant ─┬─ User (auth)
        ├─ Contact ─┬─ Conversation ── Message
        │           └─ Booking
        ├─ KnowledgeDocument
        ├─ AiRun ── Conversation
        └─ ChannelConfig
```

**3 dormant models (schema 保留，不寫 code):**

```
Order          ← P1.5
FollowUpTask   ← P1.5
Reminder       ← P1.5
```

---

## 8. Demo Scenario

> 髮型屋老闆註冊 → 新增知識文檔（服務項目 + 價目表 + 營業時間）→ 客戶透過 webchat 傳訊息「我想預約剪髮」→ AI 回覆詢問時間 → 客戶回覆「下星期三下午三點」→ AI 建立預約並確認 → 老闆在 dashboard 看到新預約

這就是 Phase 1 的完整 demo 流程。

---

## 9. Anti-patterns to Avoid

1. **不要** 為 Order/FollowUp/Reminder 寫 controller — schema 夠了
2. **不要** 實作 WhatsApp webhook — webchat REST API 足夠 demo
3. **不要** 寫多次 LLM call — P1 單次 call + JSON structured output
4. **不要** 建立 scoring/playbook/objection 相關檔案
5. **不要** 寫 dark mode / responsive mobile layout — P1.5
6. **不要** 優化 AI prompt — 先跑通流程，再 iterate prompt
7. **不要** 加 WebSocket — P1 用 polling or SWR refetch
