# `api-server` (standalone Express)

This package is a **development / demo** Express app. It talks to the AI engine and database helpers directly and **does not** go through the NestJS app in `apps/api` (no shared Nest middleware, auth, or the same persistence pipeline as production).

**Production:** Do not deploy this server as your primary API. Use `apps/api` for the integrated chat flow (contacts, conversations, `Message.metadata`, side effects, etc.).

**Run locally:**

```bash
pnpm --filter api-server dev
```

From `packages/api-server`, `pnpm dev` runs `npx tsx src/index.ts`.

If `NODE_ENV=production`, the process logs a warning on startup — this stack is still intended for local experimentation, not as a hardened production surface.

---

## Demo web UI (`/demo/chat`)

The browser demo lives in the **Next.js** app (`apps/web`), not in this package. Route: **`http://localhost:3000/demo/chat`** (default Next dev port).

- Start the web app, for example: `pnpm dev:web` from the repo root.
- A **404** on `/demo/chat` usually means Next is not running or you are on the wrong port (e.g. API on 3001 vs web on 3000).

The Nest chat API used by that page is typically `http://localhost:3001/api/chat/message` — ensure `NEXT_PUBLIC_*` or proxy settings match your local ports.
