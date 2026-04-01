# 本機儀表板（Dashboard）+ 對話測試 — 完整流程（備忘）

專案根目錄假設：`D:\AI TOP SALES`（請改做你本機路徑）。  
PowerShell 用 **`cd "D:\AI TOP SALES"`**（路徑有空格要引號）。

---

## 〇、事前準備（只做一次／換電腦時）

1. 安裝 **Node ≥ 20**、**pnpm**、**Docker Desktop**（並確認 Docker 會開機自動起）。
2. 專案根目錄複製 **`.env.example` → `.env`**，最少填好：

   | 變數 | 用途 |
   |------|------|
   | `DATABASE_URL` | PostgreSQL，本機 Docker 例：`postgresql://postgres:postgres@localhost:5432/ai_top_sales` |
   | `JWT_SECRET` | 夠長字串 |
   | `NEXT_PUBLIC_API_URL` | `http://localhost:3001`（俾瀏覽器呼叫 API） |
   | `APP_URL` | `http://localhost:3000`（CORS；用 127.0.0.1:3000 開網頁亦得，API 已允許本機來源） |
   | `OPENAI_API_KEY` | 要試 ChatGPT／LLM planner 時填 |
   | `AI_ENGINE_MODE` | 唔填＝`auto`；強制規則_only 用 `rule` |

3. **Prisma（資料庫 schema）**  
   - 建議喺 **`packages/database/.env`** 寫同一條 `DATABASE_URL`。  
   - 空庫第一次：

     ```powershell
     pnpm docker:up
     pnpm install
     pnpm db:generate
     pnpm db:migrate:prod
     ```

   - 若出現 **P3005（schema not empty）** 要清 volume（**會刪晒 DB**）：

     ```powershell
     pnpm docker:clean
     pnpm docker:up
     pnpm db:generate
     pnpm db:migrate:prod
     ```

4. 安裝依賴：`pnpm install`（專案根目錄）。

---

## 一、Dashboard 啟動（每次開工）

### 1. 開資料庫／Redis

```powershell
cd "D:\AI TOP SALES"
pnpm docker:up
```

### 2. 開 API（NestJS，埠 **3001**）

```powershell
cd "D:\AI TOP SALES"
pnpm dev:api
```

等到見到：**`API running on http://localhost:3001`**、**`Prisma connected to database`**。  
快速檢查：瀏覽器開 **http://localhost:3001/api/health** → 應有 `status: ok`。

若報 **P1001 連唔上 DB** → 多數未 `docker:up` 或 `DATABASE_URL` 錯。

### 3. 開前端（Next.js，埠 **3000**）

**方式 A — 開發模式（有熱重載，Windows 有時會「開一陣又死」）**

```powershell
cd "D:\AI TOP SALES\apps\web"
pnpm clean
cd "D:\AI TOP SALES"
pnpm dev:web
```

等到 **Ready**。  
若 **500 / chunk 錯**：先 **停 dev**，清 port **3000** 舊 process，再 `pnpm clean` 後重開。

**釋放埠 3000（必須用 PowerShell 語法；唔好用 CMD 嘅 `for /f`）**

```powershell
cd "D:\AI TOP SALES"
.\scripts\kill-port.ps1 3000
```

或一行（內建 cmdlet）：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

若你堅持用 **命令提示字元 (cmd.exe)** 先至可以用：

```bat
for /f "tokens=5" %a in ('netstat -ano ^| findstr ":3000" ^| findstr LISTENING') do taskkill /F /PID %a
```

**方式 B — 穩定預覽（無熱重載，較少死機）**

跑之前請確認 **3000 冇被 `pnpm dev:web` 佔用**，否則會 **`EADDRINUSE`**：

```powershell
cd "D:\AI TOP SALES"
.\scripts\kill-port.ps1 3000
pnpm preview:web
```

改完前端 code 要再跑一次 `preview:web` 先見新版本。

### 4. 用瀏覽器開 Dashboard

- 建議用 **Chrome / Brave**，唔好只靠 Cursor 內建預覽。  
- 網址：**http://localhost:3000/login** 或 **http://127.0.0.1:3000/login**  
- 未有帳號 → **註冊**；登入後 → **主控台 / 知識庫 / 對話 / 預約**。

### 5. 檢查清單（開唔到時）

| 現象 | 檢查 |
|------|------|
| **`EADDRINUSE` / port 3000** | 停咗 `pnpm dev:web` 未？用 **`.\scripts\kill-port.ps1 3000`** 再跑 `preview:web` 或 `start` |
| **一直「登入中…」、Network 冇 `login` 請求** | 已修：`auth-store` 唔可以再預設 `isLoading: true`（`/login` 唔會跑 `fetchMe`，會令按鈕 **disabled**、永遠顯示登入中）。請 **更新程式後** 再試；若仍怪，先 **硬重新整理**。 |
| **一直「登入中…」（有發請求）** | 多數 **API 未開** 或 **連唔到 3001**。另開終端跑 **`pnpm dev:api`**；瀏覽器開 **http://localhost:3001/api/health** 要見 `ok`。用 **`pnpm preview:web`** 時，改咗 **`NEXT_PUBLIC_API_URL`** 要 **重新 build**。前端對 API 有 **約 25 秒逾時**。 |
| Failed to fetch | API 有冇開、`NEXT_PUBLIC_API_URL` 是否 `http://localhost:3001`、改完 `.env` 要重開 `dev:web` |
| Internal Server Error / 759.js | `apps\web` 執行 `pnpm clean`，殺死 3000 舊 node，再開 `pnpm dev:web` |
| 本 repo 已為 Windows dev 開 webpack **polling**（`next.config.ts`），減少無故崩潰 |

---

## 二、測試對話（Chat）流程

Chat **唔經** Dashboard 表單，用 **`POST /api/chat/message`**（唔使 JWT）。  
知識庫內容來自你 **該 tenant** 喺 Dashboard 入低嘅文檔。

### 1. 拎 `tenantId`（同一個 acc／tenant）

登入 Dashboard 後任揀一種：

- **F12 → Network** → 揀 **`me`**（或 `stats`）→ Response 入面 **`data.tenantId`**  
- 或 **Application → Local Storage → `accessToken`** → 去 [jwt.io](https://jwt.io) 解 JWT → **`tenantId`**

### 2. 固定「客戶身份」（同一條對話線）

同一個 **`externalContactId`**（自訂字串）＝同一個客、同一條 thread、預約 draft 會跟住。  
換 **`externalContactId`** ＝新客／新對話。

### 3. 用 PowerShell 發一句（範本）

```powershell
$tenantId = "貼上你的tenantId"
$body = @{
  tenantId          = $tenantId
  channel           = "WEBCHAT"
  externalContactId = "my-thread-001"
  contactName       = "阿明"
  message           = "你的句子"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3001/api/chat/message" `
  -Method Post -ContentType "application/json; charset=utf-8" -Body $body
```

**唔好**喺 PowerShell 直接打粵語句子當指令；句子只可以放喺 **`message`** 變數。

### 4. 一鍵煙霧測試（英文句，避免編碼問題）

```powershell
cd "D:\AI TOP SALES"
.\scripts\local-chat-smoke.ps1
```

會：註冊 → 加一篇 KB → 發一句價錢相關問題。

### 5. 點知有冇用到 OpenAI（ChatGPT 類）

睇 **跑 `pnpm dev:api` 嗰個終端機**，搵 **`[LLM-PIPELINE]`**：

| Log | 意思 |
|-----|------|
| `shouldAttemptLlmPlanner=true` … `OPENAI_API_KEY_set=true` | 會嘗試 call OpenAI |
| `runAiEngine source=llm_pipeline` | **今句有行 LLM planner** |
| `runAiEngine source=rule_fallback` | 今句純規則（或 planner 失敗） |

或用 **`pnpm db:studio`** → 表 **`AiRun`**：`model` 係 **`gpt-4o-mini`**（或你設嘅 model）且 tokens > 0 → 通常用過 OpenAI。

### 6. 預約多輪（手動試劇本例子）

用固定 **`externalContactId`**，順序發（內容要配合你知識庫真實服務名）：

1. `我想預約 XXX`  
2. `聽日`  
3. `下午3點`  
4. `我叫陳大文`  
5. `91234567`  

然後去 Dashboard **對話**、**預約** 睇結果。

### 7. 「問排期」（有 draft 之後）

當已有服務／日期／時間等 **draft 進度** 後，可試：**`有冇位？`**、**`咩時間有位？`**  
API log 可能見 **`composer=availability`**；回覆會解釋由同事確認排期、可提出心儀時間（詳見 `composeAvailabilityResponse`）。

---

## 三、相關文件（repo 內）

| 文件 | 內容 |
|------|------|
| [`local-chat-openai.md`](./local-chat-openai.md) | OpenAI 環境、Prisma、smoke 腳本補充 |
| [`ai-engine-process.md`](./ai-engine-process.md) | LLM vs 規則、fallback、`[LLM-PIPELINE]` 說明 |
| [`ai-engine-llm.md`](./ai-engine-llm.md) | v1 行為、環境變數 |

---

**最後濃縮版（熟手用）**  
`docker:up` → `pnpm dev:api` → `pnpm dev:web`（或 `pnpm preview:web`）→ 瀏覽器 `localhost:3000` → 知識庫加料 → `tenantId` + `POST /api/chat/message` → 睇 API log `[LLM-PIPELINE]`。
