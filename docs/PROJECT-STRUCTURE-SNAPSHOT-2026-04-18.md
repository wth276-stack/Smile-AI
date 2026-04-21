# AI Top Sales — Project Structure Snapshot

**日期：2026-04-18**  
**來源：** 本機 repo `AI TOP SALES` 目錄掃描（與 `進度快照 v11`（2026-04-15）、`DEV-GUIDE12_04_2026`、`PROJECT-STRUCTURE-SNAPSHOT-2026-04-15` 對照後更新）。

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
├── DEV-GUIDE.md（若存在）
├── ADMIN_GUIDE.md（若存在）
├── docker-compose.yml
├── Dockerfile.*（api / web / worker / railway 等，以 repo 為準）
├── apps/
├── packages/
├── config/
├── docker/
├── docs/
├── scripts/
├── kb/beauty-salon/                ← 五份 Markdown 範例／匯入用 KB
└── tests/（若存在，如 phase1-verify）
```

**與 2026-04-15 快照差異（重點）：**

- **`kb/beauty-salon/`** 現有完整五檔（臉部 / 激光與緊緻 / 眼部身體脫毛 / 美甲套餐 / 通用 FAQ）。
- **`packages/database`** 新增 **beauty KB 匯入腳本**（見 §5），非 dashboard 匯入流程。
- **Prisma migrations 清單**與 04-15 相同（未見 04-15 之後新 migration 目錄）。

---

## 2. `apps/web` — Next.js（App Router）

**實際掃到之 `app/` 路由（節選）：**

```
apps/web/app/
├── layout.tsx
├── page.tsx                         ← /
├── globals.css
├── (auth)/
│   ├── layout.tsx
│   ├── login/page.tsx
│   └── register/page.tsx
├── (dashboard)/
│   ├── layout.tsx
│   └── dashboard/
│       ├── page.tsx
│       ├── bookings/page.tsx
│       ├── contacts/page.tsx
│       ├── conversations/page.tsx
│       ├── conversations/[id]/page.tsx
│       ├── knowledge-base/page.tsx
│       └── settings/page.tsx
├── demo/
│   ├── page.tsx                     ← [v11] 行業 Demo 入口
│   └── chat/page.tsx                ← /demo/chat
├── chat/
│   └── [tenantSlug]/page.tsx        ← 公開嵌入聊天
```

```
apps/web/components/
└── HeroChatMultiIndustry.tsx        ← [v11] 5 行業 demo UI
```

**與 04-15 一致之處：** 仍**未**在 `app/` 下見到舊版 DEV-GUIDE 曾寫的 `app/api/`、`internal/`（若文件仍寫，以實際目錄為準）。  
**與 v11 進度快照一致：** `/demo`、`HeroChatMultiIndustry` 存在。

---

## 3. `apps/api` — NestJS REST API

**`AppModule` 目前 import：** `Auth`, `Tenants`, `Contacts`, `Conversations`, `Bookings`, `KnowledgeBase`, `Chat`, `Dashboard`, `Health`, **`DemoModule`**（**未**見 `WhatsappModule`）。

**Chat 模組（`modules/chat/`）** — 與 04-15 快照一致，包含例如：  
`chat.controller.ts`、`public-chat.controller.ts`、`chat.service.ts`、`chat-persistence.service.ts`、`knowledge-retriever.service.ts`、`stale-confirmation-escape.ts`、`dto/`（含 `demo-chat`、`public-chat`）等。

**Demo（行業 reset）** — 實際路徑為 **`apps/api/src/demo/`**（非 `modules/demo/`）：  
`demo.module.ts`、`demo.controller.ts`、`demo.service.ts`、`industry-seeds.ts`、`dto/reset-demo.dto.ts`。

**WhatsApp（注意）：**  
`apps/api/src/modules/whatsapp/` 目錄下目前**僅見** `whatsapp.module.ts`，檔內 **import** `whatsapp-webhook.controller` / `service` / `sender` 等；**這些被引用檔在該目錄掃描中未出現**，且 **WhatsappModule 未加入 `AppModule`**。若你本地有未同步檔案或分支差異，請以實機為準；否則補齊實作前請勿假設 WhatsApp 已可用。

---

## 4. `apps/worker` — BullMQ Worker

結構與 04-15 快照一致（`main.ts`、`worker.module.ts`、`processors/reminder.processor.ts` 等；細節以目錄為準）。

---

## 5. `packages/database` — Prisma + helpers

**與 04-15 相比新增／較顯眼之腳本與工具：**

```
packages/database/
├── package.json                    ← 含 script: import:beauty-kb
├── prisma/
│   ├── schema.prisma
│   ├── seed-demo.ts, seed-user.ts, …
│   └── migrations/                 ← 同 04-15 所列（至 20260415120000_add_booking_customer_fields）
├── scripts/
│   ├── import-beauty-salon-kb.ts   ← beauty KB → KnowledgeDocument 匯入（--tenant-id 必填；--apply）
│   ├── lib/beauty-kb-parse.ts
│   ├── dump-tenant-kb.mjs
│   ├── count-audit-preboundary.ts
│   └── replay-real-confirmation-boundary.ts
├── src/                            ← client, helpers, scripts/merge-duplicates 等
├── query.ts, reset-contact.ts, clear-demo.ts, check-contact.ts …
```

**匯入 beauty KB：**  
`pnpm --filter @ats/database import:beauty-kb -- --tenant-id <tenantId>`（預設 dry-run；`--apply` 寫入）。

---

## 6. `packages/ai-engine` — AI 核心（V2 為 production 主線）

```
packages/ai-engine/src/
├── index.ts
├── types.ts, booking-state.ts, engine.ts, orchestrator.ts, …
├── draft-update-policy.ts          ← 根目錄（v11 曾寫在 v2/ 下；實際在 src/）
├── kb-parser.ts, document-parser.ts, …
├── v2/
│   ├── engine.ts, prompt.ts, validator.ts, types.ts
│   ├── date-utils.ts
│   ├── confirmation-boundary.ts
│   ├── booking-confirmation-rejection.ts
│   ├── confirmation-boundary.test.ts
│   ├── validator.kb-match.test.ts
│   ├── resolve-relative-dates.test.ts
│   └── index.ts
├── thin-core-v1/ …
└── __tests__/ …
```

**與 04-15 快照：** v2 輔助檔與測試檔延續；另見 **`draft-update-policy.ts`** 在 **`src/`** 根層（供 orchestrator / llm-draft-merge 等使用）。

---

## 7. 其他 `packages/`

與 04-15 類似：`shared/`、`channel-adapters/`、`api-server/`（Express 實驗旁路）等；細目以 `packages/` 為準。

---

## 8. `config/` — 共用 TypeScript 設定

`config/tsconfig/`（`base.json`、`nestjs.json`、`nextjs.json` 等）— 與舊快照一致。

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

（與 04-15 清單一致。）

---

## 10. `docs/` — 專案文件（節選）

含 `ARCHITECTURE.md`、`MASTER-ARCHITECTURE.md`、`MONOREPO-STRUCTURE.md`、`V2-HANDOFF.md`、`api-chat-e2e-verification.md`、**`PROJECT-STRUCTURE-SNAPSHOT-2026-04-15.md`** 等；其餘見 `docs/` 目錄。

---

## 11. `kb/beauty-salon/` — 範例／匯入用內容

```
kb/beauty-salon/
├── 01-臉部護理.md
├── 02-激光與緊緻提升.md
├── 03-眼部身體與脫毛.md
├── 04-美甲與套餐優惠.md
└── 05-通用FAQ與使用指引.md
```

---

## 12. 與 `進度快照 v11`（2026-04-15）對照（結構面）

| 項目 | v11 描述 | 現況（本快照） |
|------|-----------|----------------|
| Demo API | `GET /demo/industries`、`POST /demo/reset` | `demo/` 模組仍在 `src/demo/`；路由以 `demo.controller` 為準 |
| 5 行業 Landing | `HeroChatMultiIndustry` | `apps/web/components/` 仍存在 |
| 改期／取消、KB、booking 欄位 | 見 v11 文字 | 程式檔仍在；**未**在本快照中重跑 E2E |
| Beauty KB 匯入器 | v11 **未**記載 | **新增** `import-beauty-salon-kb` + parse 模組 |

---

## 13. 維護建議

- **單一真相：** 帳號、URL、環境變數仍以 repo 內 **`DEV-GUIDE.md`**（或你最新版 DEV-GUIDE）為準；Railway／DB 連線若與舊 PDF 不同，以 **`.env.example` / 實際部署** 為準。
- **結構更新：** 大改目錄後可複製本檔為新日期 **`PROJECT-STRUCTURE-SNAPSHOT-YYYY-MM-DD.md`**，設計向文件（如 `MONOREPO-STRUCTURE.md`）不必每次覆寫。

---

*Snapshot generated from workspace tree — 2026-04-18*
