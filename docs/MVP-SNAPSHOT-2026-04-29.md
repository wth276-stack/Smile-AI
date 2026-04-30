# MVP Snapshot - 2026-04-29

## Decision

Status: MVP can start selling as a guided pilot.

Recommended sales mode:
- Sell to 3-5 warm businesses first.
- Position as "AI WhatsApp / web chat receptionist for enquiry + booking", not a fully self-serve platform yet.
- Keep setup assisted: we configure KB, services, FAQs, business hours, and test the flow before handover.

Not ready for:
- Fully self-serve onboarding at scale.
- Unsupservised multi-tenant production rollout.
- Complex calendar/payment integration promises.

## Current MVP Capability

Core demo is now viable:
- Beauty demo KB restored to 36 active docs.
- KB breakdown: 25 SERVICE, 11 FAQ, 0 GENERAL.
- V2 AI engine is active by default.
- KB retrieval has top-k selection and pins the current booking service.
- Prompt v3 compact is in place.
- Booking flow supports create, modify, cancel with confirmation before side effects.
- `/api/demo/reset` no longer wipes KB by default.
- KB backup and restore scripts are available.
- MVP smoke test script exists and passes.

## Verification

Latest verified commands:

```text
pnpm --filter @ats/ai-engine test
PASS 19 files / 182 tests

pnpm --filter @ats/ai-engine build
PASS

pnpm --filter @ats/api build
PASS

API_BASE=http://localhost:3002 pnpm run smoke:mvp
MVP smoke passed
```

Smoke coverage:
- HIFU price + effect duration.
- Address + payment FAQ.
- Recommendation from customer need.
- Unknown service does not invent price.
- Booking create: CREATE_BOOKING.
- Booking modify: MODIFY_BOOKING.
- DB booking row changed to requested `2026-05-11 15:00`.
- Booking cancel: CANCEL_BOOKING.
- Demo reset protection: KB preserved `36 -> 36`.

## Runtime Snapshot

Local services currently observed:

```text
Web:        http://localhost:3000
Fresh API:  http://localhost:3002
Old API:    http://localhost:3001
```

Important:
- Use `http://localhost:3002` when validating the latest AI engine behavior.
- `apps/web/.env.local` points to `NEXT_PUBLIC_API_URL=http://localhost:3002`.
- `http://localhost:3000` loads and redirects to `/login`.
- A `401 /api/auth/me` on `/login` is expected when not logged in.

## KB Snapshot

Read-only KB backup created:

```text
JSON: C:\Users\wongt\AI TOP SALES\artifacts\kb-backups\demo-tenant-2026-04-29T14-52-35-447Z-mvp-snapshot-2026-04-29.json
MD:   C:\Users\wongt\AI TOP SALES\artifacts\kb-backups\demo-tenant-2026-04-29T14-52-35-447Z-mvp-snapshot-2026-04-29.md
```

Backup checksum:

```text
idTitle SHA-256: c97f97a1530f38d81b725e612fb5cac8fdd06a3752f67636aa3c26e3ab288638
```

Recovery commands:

```text
pnpm run kb:backup
pnpm run kb:restore-missing
pnpm run kb:restore-snapshot
```

Use `kb:restore-snapshot` carefully because it is a replace-style restore.

## What Changed In This MVP Pass

KB protection:
- Added timestamped KB backup script.
- Added missing-title KB restore script.
- Added full snapshot restore script.
- Added KB recovery runbook.
- Protected demo reset from wiping KB unless `resetKnowledgeBase: true`.

AI cost and quality:
- Added KB final top-k in API retriever.
- Added current booking service pinning.
- Compact prompt v3 reduced KB/prompt footprint.
- Added strict reply limits in prompt.
- Added deterministic booking reply compaction in engine.
- Added emoji stripping in engine.
- Added modify/cancel confirmation summary guard.
- Fixed modify flow where model reply had new date/time but `newSlots` was empty.

Verification:
- Added `pnpm run smoke:mvp`.
- Smoke now checks no emoji, compact booking confirmations, booking side effects, and real DB modify time.

## Remaining Risks

Sellable but keep these in mind:

- Frontend/dashboard is not the product anchor yet; the sellable value is the chat + booking flow.
- 3001 is an old API process in this session; validate against 3002 or restart API cleanly.
- Top-k has no strict doc-type quota, so future large KBs may still clip global FAQ/policy docs.
- Booking availability is rule-based, not a real external calendar integration.
- Auth/dashboard/onboarding changes are in the worktree and should be reviewed before a clean commit.
- Web build previously had a Next root lockfile warning because another lockfile exists at `C:\Users\wongt\pnpm-lock.yaml`.

## Sell Checklist

Before each customer demo:

```text
pnpm --filter @ats/ai-engine test
pnpm --filter @ats/api build
API_BASE=http://localhost:3002 pnpm run smoke:mvp
```

Demo flow:
- Ask price/effect: "HIFU 幾錢？效果維持幾耐？"
- Ask FAQ: "地址喺邊？可以點付款？"
- Ask recommendation: "我面有啲鬆，想提升輪廓，有咩推介？"
- Unknown service: "有冇牙齒美白？幾錢？"
- Booking: "我想預約深層清潔 Facial"
- Details: "5月9號11點，我叫陳小明，電話91234567"
- Confirm: "確認"
- Modify: "我想改去5月11號下晝3點"
- Confirm modify: "確認"
- Cancel: "取消呢個booking"
- Confirm cancel: "確認取消"

## Next Best Step

Freeze features for now.

Next work should be:
1. Clean branch / commit this MVP state.
2. Do one frontend pass to ensure dashboard/login/demo preview is not confusing.
3. Prepare a 1-page sales script and pricing offer.
4. Start pilot outreach.
