# AI Top Sales — Codebase Snapshot（全倉一覽）

**As of:** 2026-04-23  
**Git:** `37ccaf5` — `fix(ai-engine): restore green build and tests`  
**Monorepo 名稱（root `package.json`）:** `ai-top-sales`  
**遠端:** 與多租戶示範 / Smile AI 產品線相關之私有倉庫（部署曾見 Railway；以實際 `README` / 環境為準）

---

## 1. 一句話

**pnpm + Turborepo 多包架構**：Next.js 後台、NestJS API、BullMQ Worker、以 `@ats/ai-engine` 為核心之預約／對話 LLM 引擎、Prisma + PostgreSQL 持久層，外加輕量 channel 型別與可選的 Express `api-server` 開發用伺服器。

---

## 2. 技術棧（實證自 `package.json`）

| 層 | 技術 |
|----|------|
| 套件 / 建置 | pnpm 9、Turborepo 2、Node `>=20` |
| Web | Next.js 15、React 19、Tailwind CSS 4、Zustand、RHF + Zod |
| API | NestJS 11、Express、BullMQ、Passport JWT、class-validator |
| 資料庫 | Prisma 6、PostgreSQL |
| 佇列 / 快取 | Redis（`docker` 內有服務定義，供本機併用） |
| AI | `@ats/ai-engine` 使用 OpenAI SDK；引擎預設 **V2**（`USE_V1_ENGINE=1` 可切 V1） |
| @ats/ai-engine 測試 | Vitest 4 |
| @ats/api 測試 | Jest |

---

## 3. 倉庫地圖

```
ai-top-sales/
├── apps/
│   ├── web/                 # @ats/web — Next.js（後台、demo chat、公開 chat 路由）
│   ├── api/                 # @ats/api — NestJS 生產 API
│   └── worker/              # @ats/worker — Nest + BullMQ 背景處理
├── packages/
│   ├── ai-engine/           # @ats/ai-engine — 對話 / 預約 / KB 之核心邏輯
│   ├── database/            # @ats/database — Prisma schema、client、seed
│   ├── shared/              # @ats/shared — 共用型別、enum、常數
│   ├── channel-adapters/    # @ats/channel-adapters — 渠道抽象（目前精簡）
│   └── api-server/          # 套件名 "api-server" — Express 獨立 dev/demo，非生產 Nest
├── docker/                  # docker-compose：PostgreSQL 14、Redis 7
├── docs/                    # 架構、流程、實作筆記（見 §10）
├── scripts/                 # 臨界路徑測試、smoke、tenant 設定、WhatsApp 等
├── package.json             # 根腳本：turbo build/dev/test、db:*、docker
├── pnpm-workspace.yaml      # apps/*、packages/*
└── turbo.json               # build 產出 dist、.next；dev 依賴 ^build
```

**註：** 部分設計文檔（如 `MONOREPO-STRUCTURE.md`）提到 `config/*` workspace；**目前** `pnpm-workspace.yaml` 僅收錄 `apps/*` 與 `packages/*`。

---

## 4. 應用（`apps/`）

### 4.1 `apps/web`（`@ats/web`）

- **框架：** App Router 結構，路由例如：
  - `/` 首頁
  - `(auth)/login`、`register`
  - `(dashboard)/dashboard/*`：conversations、contacts、bookings、knowledge-base、settings
  - `demo/chat`、`demo/` 示範
  - `chat/[tenantSlug]` 公開租戶聊天
- **狀態：** `stores/auth-store.ts`（Zustand）
- **依賴：** 主要使用 `@ats/shared` workspace

### 4.2 `apps/api`（`@ats/api`）

- **職責：** REST、JWT 認證、租戶隔離、對話、聊天（含公眾 / demo）、預約、聯絡人、知識庫上傳與匯入、儀表、WhatsApp webhook 與發送、健康檢查。
- **模組目錄（`src/modules/` 為主）：** `auth`、`chat`、`conversations`、`contacts`、`bookings`、`knowledge-base`、`tenants`、`dashboard`、`whatsapp`、`health`；另有 `common/`（prisma、guards、filters、DTO）與 `demo/`（示範租戶、admin guard、多行業 seed 等）。
- **依賴 workspace：** `@ats/ai-engine`、`@ats/database`、`@ats/channel-adapters`、`@ats/shared`
- **測試：** 多份 `*.spec.ts`（chat metadata、persistence、booking lookup、WhatsApp 等）

### 4.3 `apps/worker`（`@ats/worker`）

- **職責：** Nest 應用 + BullMQ，依賴 `@ats/database`、`@ats/shared`、`@ats/ai-engine`（以程式為準，作為背景任務用）

---

## 5. 程式庫（`packages/`）

| 名稱 | 說明 |
|------|------|
| **@ats/ai-engine** | 編譯產出 `dist/`。入口 `src/index.ts`：`runAiEngine()` 依環境變數選 V1 `orchestrator` 或 V2 `v2/engine`。內含 booking state、意圖、LLM 管線、service matcher、`thin-core-v1/`、`v2/`（validator、prompt、reply-grounding、confirmation 邊界等），大量 `*.test.ts` / regression。 |
| **@ats/database** | Prisma `schema.prisma`（PostgreSQL）、`src` 匯出 client 與 helper（如對話 / V2 輔助）。含 `prisma/seed*.ts`、匯入腳本。 |
| **@ats/shared** | 輕量共用：`types/`、`enums/`、`constants/`、`utils/`。 |
| **@ats/channel-adapters** | 渠道型別封裝（`src/types.ts`），規模小。 |
| **api-server**（目錄 `packages/api-server`） | `package.json` 的 **name 為 `api-server`**，非 `@ats/*`。Express 5、獨立 `tsx` dev；**說明自述為 dev/demo，非生產 Nest API**。 |

---

## 6. 資料層（Prisma）

- **位置：** `packages/database/prisma/schema.prisma`
- **資料庫：** PostgreSQL（`DATABASE_URL`）
- **主要模型（16 個）：**  
  `Tenant`、`User`、`Contact`、`Conversation`、`Message`、`Order`、`Booking`、`FollowUpTask`、`Reminder`、`AiRun`、`KnowledgeDocument`、`ChannelConfig`、`BusinessHours`、`TimeSlot`、`MediaMessage` 等。  
- **產品概念：** 多租戶、對話與訊息、知識庫文件、渠道設定、AI 執行紀錄、預約與冪等鍵、營業時間等。

---

## 7. AI 引擎要點

- **預設路徑：** V2（`packages/ai-engine/src/v2/engine.ts`）；可改 env 用 V1。
- **V2 相關：** `validator`（行為與肯定句）、`prompt`、`reply-grounding`、日期工具、預約確認／拒絕、service taxonomy / switch（`service-matcher.ts`）等。
- **V1 遺產：** `orchestrator.ts`、多數 regression 與 thin-core 路徑仍於倉內可切換測試。
- **測試（編撰時曾驗證）：** `pnpm --filter @ats/ai-engine test` — **15 個測試檔、136 條**（Vitest）。

---

## 8. 本機與維運

- **Docker：** `docker/docker-compose.yml` — `postgres:14` + `redis:7`（port 5432、6379）。
- **根指令摘錄：**
  - `pnpm dev` / `dev:api` / `dev:web` / `dev:worker`
  - `pnpm build`、`pnpm test`、`pnpm lint`（Turborepo）
  - `db:generate`、`db:migrate`、`db:push`、`db:seed`、`db:seed:demo`
  - `docker:up` / `down` / `clean`
- **`.env`：** `turbo.json` 的 `globalDependencies` 含 `.env`（變更會影響快取判定）。

---

## 9. 測試與腳本

| 區域 | 狀況（以專內實際指令為準） |
|------|---------------------------|
| @ats/ai-engine | Vitest，覆蓋 v2、slot、或chestrator 等；見 §7 |
| @ats/api | Jest 單元／整合（chat、webhook 等） |
| `scripts/` | 預約臨界路徑、v2 引擎測試、public chat smoke、persona、tenant 設定、WhatsApp token 等 |
| 根目錄 | `tests/phase1-verify.ts` 等 |

---

## 10. 文檔索引（`docs/`）

| 方向 | 範例檔名 |
|------|----------|
| 總體架構 | `ARCHITECTURE.md`、`MASTER-ARCHITECTURE.md`、`MONOREPO-STRUCTURE.md` |
| AI 引擎 | `AI-ENGINE-SPEC.md`、`ai-engine-llm.md`、`ai-engine-process.md` |
| 前後台 / 網域 | `FRONTEND-SPEC.md`、`BACKEND-DOMAIN-DESIGN.md` |
| 決策與階段 | `DECISION_HIERARCHY.md`、`PHASE1-FREEZE.md`、`V2-HANDOFF.md` |
| 實戰 / 內測 | `local-runbook-zh-HK.md`、`internal-pilot-readiness.md` |
| 歷史 snapshot | `PROJECT-STRUCTURE-SNAPSHOT-2026-04-15.md`、同系列其他日期檔 |

---

## 11. 最近狀態（本 snapshot 的 commit）

- **37ccaf5** 重點：修復 `@ats/ai-engine` **tsc 建置**與測試一致性（`service-matcher` 匯出與 v2 `engine` 型別／變數次序、`engine.booking-rescue.test` 斷言），以及與 `reply-grounding` 相關之調整；目標為 **建置 + 測試綠色** 以利佈署。

---

## 12. 已知限制

- 舊文檔中的「測試檔案數 / 測試條數」可能隨提交變化；**以執行 `pnpm --filter` 之結果為準**。
- 部署目標（Railway / 其他）請以實際 `README`、env 及 CI 為準；本表不鎖定單一雲廠商。

---

*本檔由掃描倉庫目錄、`package.json`、Prisma schema 與目前 HEAD 產生，用於內部對齊；細節實作請以原始碼為準。*
