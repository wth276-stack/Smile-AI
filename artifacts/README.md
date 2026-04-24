# KB preservation artifacts

This directory holds **offline snapshots** of `KnowledgeDocument` data exported from a database, for review and recovery.

- **`demo-tenant-kb-snapshot.json`** / **`demo-tenant-kb-snapshot.md`** — full read-only export for tenant `demo-tenant` (see `scripts/export-demo-tenant-kb.ts`).

**Important**

- A snapshot reflects **the database at export time**, not necessarily `packages/database/src/industry-seeds.ts`. Production or staging DBs can contain extra rows (e.g. manual imports) or differ from the small canonical beauty seed in git.
- **`applyIndustrySeedToTenant`**, **`pnpm db:seed:demo`**, and **`POST /api/demo/reset`** (demo reset) can **delete all** `KnowledgeDocument` rows for a tenant and replace them with data derived from the current seed. Run a **new export** before any reset/seed if you need to preserve the current state.

**Regenerate**

```bash
pnpm exec tsx scripts/export-demo-tenant-kb.ts
```

(from repository root, with `DATABASE_URL` in `.env`)
