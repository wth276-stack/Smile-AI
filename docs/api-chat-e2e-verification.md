# Chat → AI engine → persistence (API E2E)

## Prereqs

1. PostgreSQL reachable at `DATABASE_URL` (see repo root `.env`).
2. Schema applied, including `bookings.idempotency_key` and `ai_runs.side_effect_failures`:

   ```bash
   cd packages/database
   pnpm exec prisma migrate deploy
   ```

3. Workspace built: `pnpm --filter @ats/ai-engine build`, `pnpm --filter @ats/database exec prisma generate`, `pnpm --filter @ats/api build`.

## Run

```bash
cd apps/api
# PowerShell:
$env:RUN_CHAT_E2E='1'
pnpm test:chat-e2e
```

Uses **real** `POST /api/chat/message` via in-process HTTP (`fetch` to `listen(0)`).

## Scenarios covered

See `apps/api/test/chat-flow.e2e-spec.ts` (S1–S7): inquiry, price, full booking, draft follow-up, duplicate idempotency, simulated `CREATE_BOOKING` failure, cross-service price with draft.

## If tests fail at `$connect`

PostgreSQL is not running or `DATABASE_URL` is wrong — start Docker (`docker compose up -d postgres`) or point `DATABASE_URL` at your instance.
