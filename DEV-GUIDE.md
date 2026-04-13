
# AI Top Sales — 開發指南

## 📝 登入資料

| 項目 | 值 |
|------|-----|
| Email | `demo@example.com` |
| Password | `demo123456` |
| Tenant ID | `demo-tenant` |

---

## 🌐 本地 URLs (開發模式)

| 頁面 | URL |
|------|-----|
| 首頁 | http://localhost:3001 |
| 登入 | http://localhost:3001/login |
| 註冊 | http://localhost:3001/register |
| Dashboard 主頁 | http://localhost:3001/dashboard |
| 對話列表 | http://localhost:3001/dashboard/conversations |
| 對話詳情 | http://localhost:3001/dashboard/conversations/[id] |
| 聯絡人 | http://localhost:3001/dashboard/contacts |
| 預約管理 | http://localhost:3001/dashboard/bookings |
| 知識庫 | http://localhost:3001/dashboard/knowledge-base |
| 設定 | http://localhost:3001/dashboard/settings |
| Demo Chat | http://localhost:3001/demo/chat |

---

## 🚀 Railway (Production) URLs

| 服務 | URL |
|------|-----|
| API Base | `https://atsapi-production-ad45.up.railway.app` |
| API Login | `POST https://atsapi-production-ad45.up.railway.app/api/auth/login` |
| DB Public Host | `crossover.proxy.rlwy.net:30442` |
| DB Internal Host | `postgres.railway.internal:5432` (只限 Railway 內部) |

---

## 📁 專案結構

```
AI TOP SALES/
├── .env                              # 根目錄環境變數 (API/Worker 用)
├── DEV-GUIDE.md                      # 本文件
├── apps/
│   ├── api/                          # NestJS API Server
│   ├── web/                          # Next.js 15 前端 (App Router)
│   │   ├── .env.local                # ⚠️ 前端環境變數 (NEXT_PUBLIC_*)
│   │   ├── next.config.ts
│   │   ├── app/
│   │   │   ├── layout.tsx            # 根 Layout
│   │   │   ├── page.tsx              # 首頁 /
│   │   │   ├── globals.css
│   │   │   ├── (auth)/
│   │   │   │   ├── login/page.tsx    # /login
│   │   │   │   └── register/page.tsx # /register
│   │   │   ├── (dashboard)/dashboard/
│   │   │   │   ├── page.tsx          # /dashboard
│   │   │   │   ├── bookings/page.tsx # /dashboard/bookings
│   │   │   │   ├── contacts/page.tsx # /dashboard/contacts
│   │   │   │   ├── conversations/
│   │   │   │   │   ├── page.tsx      # /dashboard/conversations
│   │   │   │   │   └── [id]/page.tsx # /dashboard/conversations/:id
│   │   │   │   ├── knowledge-base/page.tsx # /dashboard/knowledge-base
│   │   │   │   └── settings/page.tsx # /dashboard/settings
│   │   │   ├── demo/
│   │   │   │   └── chat/page.tsx     # /demo/chat
│   │   │   ├── api/                  # Next.js API Routes
│   │   │   └── internal/
│   │   ├── lib/
│   │   │   └── api-client.ts         # API base URL 定義
│   │   └── stores/
│   │       └── auth-store.ts         # Zustand 登入狀態
│   └── worker/                       # Background Worker
├── packages/
│   └── database/
│       ├── .env                      # ⚠️ Prisma 專用 DATABASE_URL
│       └── prisma/
│           ├── schema.prisma         # DB Schema
│           ├── seed-demo.ts          # Demo 全套資料 Seed
│           └── seed-user.ts          # 單獨 User Seed
```

---

## ⚙️ 環境變數檔案 (3 個)

### 1. `.env` (根目錄 — API/Worker 用)
```env
DATABASE_URL=postgresql://postgres:SGJKfdamLXsFAiYPDJRWhTikfCXhmYzY@crossover.proxy.rlwy.net:30442/railway
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=random-secret-key-change-in-production
OPENAI_API_KEY=sk-proj-...
OPENAI_DEFAULT_MODEL=gpt-4o-mini
USE_V2_ENGINE=true
NEXT_PUBLIC_API_URL=https://atsapi-production-ad45.up.railway.app
APP_URL=http://localhost:3000
API_PORT=3001
```

### 2. `apps/web/.env.local` (Next.js 前端)
```env
NEXT_PUBLIC_API_URL=https://atsapi-production-ad45.up.railway.app
```

### 3. `packages/database/.env` (Prisma)
```env
DATABASE_URL=postgresql://postgres:SGJKfdamLXsFAiYPDJRWhTikfCXhmYzY@crossover.proxy.rlwy.net:30442/railway
```

### ⚠️ 注意事項
- Next.js **只讀** `apps/web/.env.local`，唔會讀根目錄 `.env` 嘅 `NEXT_PUBLIC_*`
- Prisma **優先讀** `packages/database/.env`，會覆蓋環境變數同根目錄 `.env`
- 改完 `NEXT_PUBLIC_*` 變數後必須**重啟** dev server 先生效

---

## 🔧 常用指令

### 啟動前端
```bash
pnpm --filter @ats/web exec next dev --port 3001
```

### Port 被佔用時
```powershell
# 方法 1：換 port
pnpm --filter @ats/web exec next dev --port 3002

# 方法 2：殺 process (可能需要管理員權限)
taskkill /F /IM node.exe

# 方法 3：搵出佔用 port 嘅 PID 再殺
netstat -ano | findstr :3001
taskkill /F /PID <PID>
```

### 資料庫操作
```bash
# Seed demo 資料 (tenant + services + FAQs + user + contact)
pnpm --filter @ats/database exec npx tsx prisma/seed-demo.ts

# 只 Seed user
pnpm --filter @ats/database exec npx tsx prisma/seed-user.ts

# Introspect DB (從 DB 拉 schema)
pnpm --filter @ats/database exec npx prisma db pull

# 推送 schema 到 DB
pnpm --filter @ats/database exec npx prisma db push

# Generate Prisma Client
pnpm --filter @ats/database exec npx prisma generate
```

### API 測試 (PowerShell)
```powershell
# Login — 取得 accessToken
Invoke-RestMethod -Uri "https://atsapi-production-ad45.up.railway.app/api/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body '{"email":"demo@example.com","password":"demo123456"}'

# 帶 Token 請求
$token = "eyJhbG..."
Invoke-RestMethod -Uri "https://atsapi-production-ad45.up.railway.app/api/knowledge" `
  -Headers @{ Authorization = "Bearer $token" }
```

---

## 🐛 常見問題

| 問題 | 原因 | 解決方法 |
|------|------|---------|
| Port EADDRINUSE | 舊 process 佔住 port | `taskkill /F /IM node.exe` (管理員) 或換 port |
| Prisma "invalid port number" | `.env` 編碼錯誤 (UTF-16 BOM) | 用 `-Encoding ASCII` 或 `notepad` 重新儲存 |
| 前端 login "Not Found" | `NEXT_PUBLIC_API_URL` 未設定 | 確認 `apps/web/.env.local` 存在且正確 |
| `postgres.railway.internal` 連唔到 | 本地唔能用 Railway 內部網絡 | 改用公共 URL `crossover.proxy.rlwy.net:30442` |
| PowerShell Set-Content 亂碼 | 預設 UTF-16 編碼 | 加 `-Encoding ASCII` 或用 `[System.IO.File]::WriteAllText()` |
| 改完 env 冇效果 | Next.js cache | 刪 `apps/web/.next` 再重啟 dev server |

---

## 📊 Demo 資料一覽

### Services (4 個)
| 名稱 | 原價 | 優惠價 |
|------|------|--------|
| HIFU 緊緻療程 | HK$6,980 | HK$4,980 |
| 深層清潔 Facial | HK$480 | HK$298 |
| IPL 彩光嫩膚 | HK$800 | HK$498 |
| Botox 瘦面療程 | HK$2,500 | HK$1,800 |

### FAQs (5 個)
- 付款方式 (現金/信用卡/支付寶/微信/轉數快)
- 營業時間 (週一至五 10-21, 週六 10-19, 週日休息)
- 地址及交通 (銅鑼灣告士打道 123 號)
- 預約流程 (WhatsApp/電話/網上)
- 退款政策

### Demo Contact
- Demo Customer (+852 9123 4567)
'@ -Encoding ASCII
```