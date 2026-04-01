# 本機試對話 + 確認有冇用到 ChatGPT（OpenAI）

Chat 引擎會讀 repo **根目錄**嘅 `.env`（`apps/api` 用 `envFilePath: '../../.env'`）。

## 1. 準備環境

1. **Docker** 開 Postgres（同 `docker-compose.yml` 一致）：

   ```powershell
   pnpm docker:up
   ```

2. 喺 **repo 根目錄**建立或編輯 **`.env`**（可複製 `.env.example`），最少要有：

   ```env
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_top_sales
   JWT_SECRET=dev-secret-at-least-32-chars-long!!
   AI_ENGINE_MODE=auto
   OPENAI_API_KEY=sk-你的真實key
   OPENAI_DEFAULT_MODEL=gpt-4o-mini
   API_PORT=3001
   APP_URL=http://localhost:3000
   ```

3. **Prisma migrate** 需要 `DATABASE_URL`。建議喺 **`packages/database/.env`** 寫同一條 `DATABASE_URL`（同上面 Docker 一致）。若暫時唔想加檔案，可喺 PowerShell：

   ```powershell
   cd <你的專案根目錄>
   pnpm install
   $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_top_sales"
   pnpm db:generate
   pnpm db:migrate
   ```

   - **`pnpm db:migrate`** 係互動命令（本機終端機用）。
   - **無互動**（例如 script）：空庫時可用 **`pnpm db:migrate:prod`**（`prisma migrate deploy`）。

   **若出現 `P3005`（database schema is not empty）**：Postgres volume 裡有舊表，同 migration 歷史唔夾。本機可清 volume 再嚟過（**會刪晒 DB 資料**）：

   ```powershell
   pnpm docker:clean
   pnpm docker:up
   pnpm db:generate
   pnpm db:migrate:prod
   ```

4. 開 API：

   ```powershell
   pnpm dev:api
   ```

   見到 `API running on http://localhost:3001` 即 OK。

## 2. 點樣知「有冇用到 ChatGPT」

### A. 睇 API 終端機（最直接）

每句 user 訊息處理時會有 **`[LLM-PIPELINE]`** log：

| Log | 意思 |
|-----|------|
| `shouldAttemptLlmPlanner=true` … `OPENAI_API_KEY_set=true` | 會 call OpenAI |
| `success intent=... composer=...` | Planner 成功，用模板出句 |
| `runAiEngine source=llm_pipeline` | **今次係 LLM 路徑** |
| `runAiEngine source=rule_fallback` | 今次冇用 LLM（fallback 或 `AI_ENGINE_MODE=rule`） |
| `fallback=...` | OpenAI/JSON/semantic 失敗 → 轉規則引擎 |

### B. 睇資料庫 `AiRun`

成功行 LLM 時 `analytics.model` 會係 **`gpt-4o-mini`**（或你設嘅 `OPENAI_DEFAULT_MODEL`），`inputTokens` / `outputTokens` > 0。  
行純規則時通常係 **`mock-p1-v2`**，tokens 0。

```powershell
pnpm db:studio
```

打開 `AiRun` 表睇最近一筆嘅 JSON。

## 3. 發送測試對話

`POST /api/chat/message` **唔使 JWT**，但要有效 **`tenantId`**（UUID）同最好有 **知識庫** 文檔（否則回覆較空）。

### 方法一：一鍵腳本（推薦）

喺 repo 根目錄（已開 `pnpm dev:api`）：

```powershell
cd <你的專案根目錄>
.\scripts\local-chat-smoke.ps1
```

會自動：`/api/auth/register` → 加一篇知識庫 → `POST /api/chat/message`，最後提示你睇終端機嘅 `[LLM-PIPELINE]`。

### 方法二：手動

1. **註冊**（建立 tenant + user）：

   `POST http://localhost:3001/api/auth/register`  
   Body JSON：`tenantName`, `name`, `email`, `password`（≥8 位）

2. 從回傳嘅 **`accessToken`** 解出 **`tenantId`**（JWT payload），或用 API log 行  
   `New tenant registered: <uuid>`。

3. 用 **`Authorization: Bearer <accessToken>`**  
   `POST http://localhost:3001/api/knowledge-base`  
   加 `title` + `content`（例如服務名、價錢）。

4. **對話**：

   `POST http://localhost:3001/api/chat/message`

   ```json
   {
     "tenantId": "你的-tenant-uuid",
     "channel": "WEBCHAT",
     "externalContactId": "test-user-001",
     "contactName": "阿明",
     "message": "HIFU 幾錢？"
   }
   ```

## 4. 常見問題

- **成日 `rule_fallback`**：檢查 `AI_ENGINE_MODE` 唔好係 `rule`；`OPENAI_API_KEY` 唔好有空格；睇 `fallback=semantic_check_failed` 等原因。
- **API throw**：`chat.service` 會回固定粵語 fallback 句；查 log `runAiEngine failed`.
- **唔好 commit `.env`**：真 key 只留本機。
