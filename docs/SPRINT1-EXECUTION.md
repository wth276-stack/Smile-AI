# Sprint 1 Execution Plan

> Goal: first visible and testable end-to-end outcome
> Timeline: Week 1–2
> Success criteria: human tester can register, add knowledge, send chat message, see AI reply + booking

---

## A. Execution Plan

| Step | What | Estimated Time | Blocker? |
|------|------|---------------|----------|
| 1 | Install pnpm (if not installed) | 1 min | Yes — prerequisite |
| 2 | Install dependencies | 2-3 min | Yes |
| 3 | Start PostgreSQL + Redis via Docker | 30 sec | Yes — needs Docker Desktop |
| 4 | Create `.env` from template | 1 min | Yes |
| 5 | Generate Prisma client | 10 sec | Yes — must run before API |
| 6 | Run database migration | 10 sec | Yes — creates tables |
| 7 | Start API server | 5 sec | Yes |
| 8 | Verify health endpoint | 5 sec | Validation checkpoint |
| 9 | Start Web frontend | 10 sec | Yes |
| 10 | Register via browser | 30 sec | Validation checkpoint |
| 11 | Add knowledge docs via curl | 1 min | Test data setup |
| 12 | Send chat message via curl | 10 sec | **Core E2E test** |
| 13 | View conversation in browser | 30 sec | Validation checkpoint |

---

## B. Required Commands

### Prerequisites

```powershell
# Check Node.js >= 20
node --version

# Install pnpm if not present
npm install -g pnpm@9

# Check Docker is running
docker --version
```

### Step 1: Install dependencies

```powershell
cd "d:\AI TOP SALES"
pnpm install
```

### Step 2: Start infrastructure

```powershell
pnpm docker:up
```

Wait 5 seconds, then verify:

```powershell
docker ps
```

You should see two containers: `postgres` (port 5432) and `redis` (port 6379).

### Step 3: Create .env

```powershell
Copy-Item .env.example .env
```

Then edit `.env`:

```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_top_sales
JWT_SECRET=sprint1-dev-secret-change-in-production
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
API_PORT=3001
APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
REDIS_HOST=localhost
REDIS_PORT=6379
```

### Step 4: Generate Prisma client + migrate

```powershell
pnpm db:generate
pnpm db:migrate
```

When prompted for migration name, enter: `init`

### Step 5: Start API

```powershell
pnpm dev:api
```

Verify:

```powershell
curl http://localhost:3001/api/health
```

Expected:
```json
{"status":"ok","timestamp":"2026-03-19T..."}
```

### Step 6: Start Frontend (in a new terminal)

```powershell
cd "d:\AI TOP SALES"
pnpm dev:web
```

Open browser: http://localhost:3000

---

## C. Required Environment Variables

| Variable | Value (dev) | Required By |
|----------|-------------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ai_top_sales` | API, Prisma |
| `JWT_SECRET` | any string >= 16 chars | API (auth) |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | API (auth) |
| `JWT_REFRESH_EXPIRES_IN` | `7d` | API (auth) |
| `API_PORT` | `3001` | API |
| `APP_URL` | `http://localhost:3000` | API (CORS) |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Web (API calls) |
| `REDIS_HOST` | `localhost` | Worker only (not needed for Sprint 1) |
| `REDIS_PORT` | `6379` | Worker only |
| `OPENAI_API_KEY` | not needed yet | Sprint 2 |

### Which apps must boot successfully

| App | Port | Sprint 1 Required? |
|-----|------|---------------------|
| `@ats/api` (NestJS) | 3001 | **Yes** |
| `@ats/web` (Next.js) | 3000 | **Yes** |
| `@ats/worker` (BullMQ) | — | No — skip for Sprint 1 |
| PostgreSQL | 5432 | **Yes** |
| Redis | 6379 | No — only needed by worker |

---

## D. Manual QA Steps

### QA-1: Health Check

```powershell
curl http://localhost:3001/api/health
```

**Pass**: returns `{"status":"ok",...}`

### QA-2: Register

```powershell
curl -X POST http://localhost:3001/api/auth/register `
  -H "Content-Type: application/json" `
  -d '{\"tenantName\":\"Demo Hair Salon\",\"name\":\"Alice Wong\",\"email\":\"alice@demo.com\",\"password\":\"demo1234\"}'
```

**Pass**: returns `{"accessToken":"...","refreshToken":"..."}`

Save the accessToken for subsequent requests:

```powershell
$TOKEN = "paste-access-token-here"
```

### QA-3: Verify Auth

```powershell
curl http://localhost:3001/api/auth/me `
  -H "Authorization: Bearer $TOKEN"
```

**Pass**: returns user object with `tenantId`, `name`, `email`, `role: "OWNER"`

Save the `tenantId` value:

```powershell
$TENANT = "paste-tenant-id-here"
```

### QA-4: Add Knowledge Documents

```powershell
curl -X POST http://localhost:3001/api/knowledge-base `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $TOKEN" `
  -d '{\"title\":\"剪髮服務\",\"content\":\"男士剪髮 $150，女士剪髮 $250，洗剪吹 $350。營業時間：星期一至六 10:00-20:00。\",\"category\":\"services\"}'
```

```powershell
curl -X POST http://localhost:3001/api/knowledge-base `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $TOKEN" `
  -d '{\"title\":\"染髮服務\",\"content\":\"全頭染 $800 起，挑染 $600 起，需預約，全程約 2-3 小時。\",\"category\":\"services\"}'
```

**Pass**: returns created document objects

### QA-5: Verify Knowledge Base

```powershell
curl http://localhost:3001/api/knowledge-base `
  -H "Authorization: Bearer $TOKEN"
```

**Pass**: returns array with 2 documents

### QA-6: Send Chat Message — Greeting

```powershell
curl -X POST http://localhost:3001/api/chat/message `
  -H "Content-Type: application/json" `
  -d "{\"tenantId\":\"$TENANT\",\"channel\":\"WEBCHAT\",\"externalContactId\":\"webchat_visitor_001\",\"contactName\":\"陳先生\",\"message\":\"你好\"}"
```

**Pass**: returns:
- `reply` containing a greeting mentioning "陳先生"
- `conversationId` (save this)
- `contactId` (save this)

### QA-7: Send Chat Message — Booking Request

```powershell
curl -X POST http://localhost:3001/api/chat/message `
  -H "Content-Type: application/json" `
  -d "{\"tenantId\":\"$TENANT\",\"channel\":\"WEBCHAT\",\"externalContactId\":\"webchat_visitor_001\",\"message\":\"我想預約剪髮\"}"
```

**Pass**: returns:
- `reply` asking for time + listing services from knowledge base
- `sideEffects` array (may be empty — asking for info)
- same `conversationId` as QA-6 (conversation reuse)

### QA-8: Send Chat Message — Provide Time (Creates Booking)

```powershell
curl -X POST http://localhost:3001/api/chat/message `
  -H "Content-Type: application/json" `
  -d "{\"tenantId\":\"$TENANT\",\"channel\":\"WEBCHAT\",\"externalContactId\":\"webchat_visitor_001\",\"message\":\"下午三點\"}"
```

**Pass**: returns:
- `reply` confirming the booking
- `sideEffects` containing `CREATE_BOOKING`

### QA-9: Verify Data via API

**Contacts:**
```powershell
curl http://localhost:3001/api/contacts `
  -H "Authorization: Bearer $TOKEN"
```
**Pass**: shows 陳先生 in the list

**Conversations:**
```powershell
curl http://localhost:3001/api/conversations `
  -H "Authorization: Bearer $TOKEN"
```
**Pass**: shows 1 open conversation

**Conversation messages:**
```powershell
curl http://localhost:3001/api/conversations/CONVERSATION_ID_HERE `
  -H "Authorization: Bearer $TOKEN"
```
**Pass**: shows all 6 messages (3 customer + 3 AI)

**Bookings:**
```powershell
curl http://localhost:3001/api/bookings `
  -H "Authorization: Bearer $TOKEN"
```
**Pass**: shows 1 booking with serviceName and startTime

### QA-10: Browser Test

1. Open http://localhost:3000
2. Register a new account (or login with alice@demo.com / demo1234)
3. See dashboard with stat cards (placeholders for now)
4. Click "對話" — should show conversation list
5. Click "聯絡人" — should show contacts list
6. Click "預約" — should show bookings list
7. Click "知識庫" — should show documents

> Note: frontend pages currently show placeholder UI. Sprint 1 priority was the
> API flow. Frontend will connect to real data in Sprint 1 tasks 10-12.

---

## E. Known Blockers / Assumptions

### Hard requirements
1. **Docker Desktop** must be running for PostgreSQL. Without it, nothing works.
2. **pnpm >= 9** must be installed globally. npm or yarn will not work with the workspace config.
3. **Node.js >= 20** is required by NestJS 11 and Next.js 15.

### Assumptions
1. Port 3000, 3001, 5432, 6379 are all free on localhost.
2. Windows PowerShell is the shell (curl commands use PowerShell backtick `` ` `` for line continuation).
3. Docker Desktop has sufficient memory (default is fine).

### Known limitations (acceptable for Sprint 1)
1. **Mock LLM** — AI responses are keyword-matched, not real LLM. Booking creation uses tomorrow 3pm as a hardcoded time. Real LLM integration is Sprint 2.
2. **No WebSocket** — frontend does not live-update. After curl chat tests, refresh the page to see new data.
3. **Frontend pages are stubs** — conversations/contacts/bookings pages show placeholders. Connecting them to real API data is Sprint 1 tasks 10-12.
4. **Chat endpoint is unauthenticated** — by design (webchat visitors don't have JWT). TenantId validation is implicit (Prisma throws if tenant doesn't exist).
5. **No Redis dependency for API** — the API server boots without Redis. Only the worker (deferred) needs it.
6. **Single user per tenant** — register creates tenant + owner. Adding staff users is P1.5.

### If something fails

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `pnpm install` hangs | Network / registry issue | `pnpm install --prefer-offline` |
| `db:generate` fails | @prisma/client version mismatch | `pnpm --filter @ats/database exec prisma generate` |
| `db:migrate` connection refused | Docker not running or port conflict | `docker ps`, check port 5432 |
| API crashes on start | Missing `.env` or `JWT_SECRET` | Check `.env` file exists |
| CORS error from frontend | `APP_URL` mismatch | Ensure `.env` has `APP_URL=http://localhost:3000` |
| Register returns 500 | DB tables don't exist | Re-run `pnpm db:migrate` |
| Chat returns 500 | Invalid tenantId | Use tenantId from QA-3 response |
