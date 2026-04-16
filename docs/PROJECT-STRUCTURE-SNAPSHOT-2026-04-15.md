# AI Top Sales — Project Structure Snapshot

**日期：2026-04-15**  
**來源：** 本機 repo `AI TOP SALES` 目錄掃描（與 `進度快照 v9` / `DEV-GUIDE12_04_2026` / 舊 Codebase Snapshot 對照後更新）。

---

## 1. 根目錄（Monorepo）

```
AI TOP SALES/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.scripts.json
├── README.md
├── DEV-GUIDE.md
├── ADMIN_GUIDE.md
├── NEW-ENGINE-SPEC.md
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.railway-api-v3
├── Dockerfile.railway-web
├── Dockerfile.railway-worker
├── nixpacks.toml
├── railway.json
├── railpack.json
├── .env.example                    ← 若存在
├── apps/
├── packages/
├── config/
├── docker/
│   ├── docker-compose.yml
│   └── .env.example
├── docs/                           ← 架構 / 規格 / 本文件
├── scripts/                        ← 一次性工具與 smoke 測試
├── kb/beauty-salon/                ← 範例 KB 內容（Markdown）
└── [各種根目錄 debug / ab_*.json / test 檔 — 開發用，非正式 app 結構]
```

---

## 2. `apps/web` — Next.js（App Router）

```
apps/web/
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── package.json
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    ← /
│   ├── globals.css
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx          ← /login
│   │   └── register/page.tsx     ← /register
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   └── dashboard/
│   │       ├── page.tsx            ← /dashboard
│   │       ├── bookings/page.tsx
│   │       ├── contacts/page.tsx
│   │       ├── conversations/page.tsx
│   │       ├── conversations/[id]/page.tsx
│   │       ├── knowledge-base/page.tsx
│   │       └── settings/page.tsx
│   ├── demo/
│   │   └── chat/page.tsx           ← /demo/chat
│   └── chat/
│       └── [tenantSlug]/page.tsx   ← /chat/:tenantSlug（公開嵌入聊天）
├── lib/
│   ├── api-client.ts
│   └── cn.ts
└── stores/
    └── auth-store.ts
```

**與舊快照差異：** 已加入 `app/chat/[tenantSlug]/page.tsx`；`app/api/` 與 `app/internal/` 在現有 repo 中**未**出現（若舊文件有寫，可視為已移除或未實作）。

---

## 3. `apps/api` — NestJS REST API

```
apps/api/
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── package.json
├── scripts/                        ← chat flow 測試 body JSON 等
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── common/
    │   ├── decorators/
    │   │   ├── current-user.decorator.ts
    │   │   └── tenant-id.decorator.ts
    │   ├── dto/pagination.dto.ts
    │   ├── filters/http-exception.filter.ts
    │   ├── guards/jwt-auth.guard.ts
    │   └── prisma/
    │       ├── prisma.module.ts
    │       └── prisma.service.ts
    └── modules/
        ├── auth/
        │   ├── auth.controller.ts
        │   ├── auth.service.ts
        │   ├── auth.module.ts
        │   ├── jwt.strategy.ts
        │   └── dto/auth.dto.ts
        ├── chat/
        │   ├── chat.controller.ts
        │   ├── public-chat.controller.ts      ← 公開 / 租戶 slug 聊天
        │   ├── chat.service.ts
        │   ├── chat.module.ts
        │   ├── chat-persistence.service.ts
        │   ├── chat-persistence.service.spec.ts
        │   ├── knowledge-retriever.service.ts
        │   ├── stale-confirmation-escape.ts
        │   └── dto/
        │       ├── chat-message.dto.ts
        │       ├── demo-chat.dto.ts
        │       └── public-chat.dto.ts
        ├── contacts/
        ├── conversations/
        ├── bookings/
        │   ├── booking-idempotency.util.ts
        │   └── booking-idempotency.util.spec.ts
        ├── dashboard/
        ├── knowledge-base/
        │   └── kb-import.service.ts
        ├── tenants/
        └── health/
```

**與舊快照差異：** `chat` 模組新增 `public-chat.controller.ts`、`stale-confirmation-escape.ts`、`dto/demo-chat.dto.ts`、`dto/public-chat.dto.ts`、`chat-persistence.service.spec.ts`。

---

## 4. `apps/worker` — BullMQ Worker

```
apps/worker/
├── nest-cli.json
├── tsconfig.json
├── tsconfig.build.json
├── package.json
└── src/
    ├── main.ts
    ├── worker.module.ts
    └── processors/
        └── reminder.processor.ts
```

---

## 5. `packages/database` — Prisma + helpers

```
packages/database/
├── package.json
├── tsconfig.json
├── query.ts
├── reset-contact.ts
├── clear-demo.ts
├── check-contact.ts
├── prisma/
│   ├── schema.prisma
│   ├── seed-demo.ts
│   ├── seed-user.ts
│   ├── fix-user.ts
│   ├── check-data.ts
│   ├── check-messages.ts
│   └── migrations/
│       ├── migration_lock.toml
│       ├── 20250101000000_init_schema/
│       ├── 20260326074004_add_structured_kb_fields/
│       ├── 20260326100832_add_doc_type/
│       ├── 20260326102011_add_price_faq/
│       ├── 20260326103549_add_steps/
│       ├── 20260326142954_add_aliases/
│       ├── 20260331_unique_tenant_phone/
│       ├── 20260401120000_add_media_message/
│       └── 20260415120000_add_booking_customer_fields/
└── src/
    ├── client.ts
    ├── index.ts
    ├── json.ts
    ├── tenant-scope.ts
    ├── conversation-helpers.ts
    ├── business-hours-helpers.ts
    ├── media-helpers.ts
    ├── service-helpers.ts
    ├── v2-helpers.ts
    └── scripts/
        ├── find-duplicates.ts
        ├── merge-duplicates.ts
        └── verify-contacts-index.ts
```

---

## 6. `packages/ai-engine` — AI 核心（V2 為 production 主線）

```
packages/ai-engine/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                    ← USE_V2_ENGINE → runAiEngineV2
    ├── types.ts
    ├── engine.ts
    ├── orchestrator.ts             ← V1 legacy
    ├── v2/                         ← ACTIVE（單次 LLM + validator）
    │   ├── index.ts
    │   ├── engine.ts
    │   ├── prompt.ts
    │   ├── validator.ts
    │   ├── types.ts
    │   ├── date-utils.ts
    │   ├── confirmation-boundary.ts
    │   ├── booking-confirmation-rejection.ts
    │   └── resolve-relative-dates.test.ts
    ├── thin-core-v1/               ← Legacy 路徑（保留）
    ├── [大量 legacy：decision-engine、llm-first-*.ts、orchestrator 周邊等]
    └── __tests__/
        └── phase15.test.ts
```

**與舊快照差異：** `v2/` 下除 `engine / prompt / validator / types` 外，新增 `date-utils.ts`、`confirmation-boundary.ts`、`booking-confirmation-rejection.ts` 等；`src/` 其餘檔案仍為 V1 / thin-core / LLM-first 遺留。

---

## 7. 其他 `packages/`

```
packages/
├── shared/
│   └── src/
│       ├── index.ts
│       ├── constants/index.ts
│       ├── enums/index.ts
│       ├── types/index.ts
│       └── utils/index.ts
│
├── channel-adapters/
│   └── src/
│       ├── index.ts
│       └── types.ts
│
└── api-server/                     ← 舊 Express 實驗 / 旁路，非 Nest `apps/api` 主線
    ├── README.md
    ├── package.json
    └── src/
        ├── index.ts
        ├── server.js
        ├── db.js
        ├── session.js
        ├── admin-routes.ts
        ├── media-routes.ts
        ├── media-processor.ts
        ├── vision-ai.ts
        └── public/
            ├── index.html
            └── admin.html
```

---

## 8. `config/` — 共用 TypeScript 設定

```
config/tsconfig/
├── base.json
├── nestjs.json
└── nextjs.json
```

---

## 9. `scripts/` — 根目錄工具腳本

```
scripts/
├── set-tenant-settings.ts
├── test-v2-engine.ts
├── test-persona-switch.ts
├── test-booking-critical-path.ts
├── test-session-cutoff.ts
├── local-chat-smoke.ps1
└── kill-port.ps1
```

---

## 10. `docs/` — 專案文件（節選）

```
docs/
├── ARCHITECTURE.md
├── MASTER-ARCHITECTURE.md
├── MONOREPO-STRUCTURE.md           ← 設計稿（較舊日期），與「實際目錄」以本文件為準
├── PROJECT-STRUCTURE-SNAPSHOT-2026-04-15.md   ← 本快照
├── local-runbook-zh-HK.md
├── DECISION_ENGINE_V1_CHANGELOG.md
├── api-chat-e2e-verification.md
└── …（其餘見 repo 內 docs/ 目錄）
```

---

## 11. 與 `進度快照 v9` 對照（重點）

| 項目 | v9 快照 | 現況（2026-04-15） |
|------|---------|-------------------|
| 前端路由 | 含 `app/api/`、`internal/` | 未見；新增 `/chat/[tenantSlug]` |
| Chat 模組 | 僅列核心檔 | 新增 `public-chat`、`stale-confirmation-escape`、demo/public DTO |
| `ai-engine` v2 | 4 核心檔 | 同目錄下多個輔助模組（date / boundary / rejection 等） |
| DB migrations | 未逐條列出 | 見 §5 遷移清單（含 `booking_customer_fields`） |
| 根目錄 `docker-compose` | 主要寫 `docker/` | 根目錄另有 `docker-compose.yml` |

---

## 12. 維護建議

- **單一真相：** 日常開發 URL / env / 帳號仍以 repo 內 **`DEV-GUIDE.md`** 為準；若與本快照衝突，以 **實際檔案** 為準。
- **結構更新：** 大改目錄後可複製本檔為新日期 `PROJECT-STRUCTURE-SNAPSHOT-YYYY-MM-DD.md`，避免覆蓋設計向的 `MONOREPO-STRUCTURE.md`。

---

*Snapshot generated from workspace tree — 2026-04-15*
