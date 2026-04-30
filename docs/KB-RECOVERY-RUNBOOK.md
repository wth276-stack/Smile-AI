# KB Recovery Runbook

This project treats demo / pilot KB data as product-critical state. Dashboard or UI work must not reset it silently.

## Source Of Truth

- Exact recovery snapshot: `artifacts/demo-tenant-kb-snapshot.json`
- Human-readable recovery snapshot: `artifacts/demo-tenant-kb-snapshot.md`
- Canonical beauty markdown source: `kb/beauty-salon/*.md`
- Timestamped backups: `artifacts/kb-backups/*.json`

## Before Any Dashboard / Demo / Seed Work

Run a timestamped backup:

```bash
pnpm exec tsx scripts/backup-tenant-kb.ts --tenant-id demo-tenant --label before-dashboard-work
```

This is read-only and writes under `artifacts/kb-backups/`.

## Restore The 2026-04-23 Demo KB Snapshot

If the KB was only partially reset and most titles are still present, restore missing titles first:

```bash
pnpm exec tsx scripts/restore-missing-kb-from-snapshot.ts --tenant-id demo-tenant --snapshot artifacts/demo-tenant-kb-snapshot.json
pnpm exec tsx scripts/restore-missing-kb-from-snapshot.ts --tenant-id demo-tenant --snapshot artifacts/demo-tenant-kb-snapshot.json --apply
```

Use full replace only when the current KB is truly wrong or disposable.

Dry-run first:

```bash
pnpm exec tsx scripts/restore-tenant-kb-from-snapshot.ts --tenant-id demo-tenant --snapshot artifacts/demo-tenant-kb-snapshot.json --replace
```

Apply only after checking the create / update / delete counts:

```bash
pnpm exec tsx scripts/restore-tenant-kb-from-snapshot.ts --tenant-id demo-tenant --snapshot artifacts/demo-tenant-kb-snapshot.json --replace --apply
```

`--apply` automatically writes a pre-restore backup unless `--no-backup` is passed.

## Re-import Canonical Beauty Markdown

Use this when you want the cleaned markdown-derived beauty KB, not the exact DB snapshot:

```bash
pnpm --filter @ats/database exec tsx scripts/import-beauty-salon-kb.ts --tenant-id demo-tenant
pnpm --filter @ats/database exec tsx scripts/import-beauty-salon-kb.ts --tenant-id demo-tenant --apply
pnpm --filter @ats/database exec tsx scripts/delete-demo-overlap-kb-docs.ts --apply
```

## Guardrails

- Do not run `db:seed:demo` or destructive demo seed flows before a KB backup.
- `POST /api/demo/reset` preserves KB by default. It only replaces `KnowledgeDocument` rows when `resetKnowledgeBase: true` is explicitly supplied.
- UI/dashboard tasks must not edit `kb/`, `artifacts/`, Prisma seed data, or `KnowledgeDocument` rows unless the task is explicitly about KB recovery.
- If a tool resets the KB, restore from the latest `artifacts/kb-backups/*.json` first. If that backup is bad, restore from `artifacts/demo-tenant-kb-snapshot.json`.
