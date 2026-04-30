# Cursor Prompt - Multi-Industry MVP Sell-Ready Phase

Paste this into Cursor when starting the next implementation pass.

```text
You are working on the AI TOP SALES / Smile AI monorepo.

Goal:
Move the product into MVP Sell-Ready Phase by validating a generic appointment AI engine across three demo industries:
1. beauty
2. cleaning
3. yoga / fitness

Important product boundary:
Do NOT build new major features.
Do NOT build PWA.
Do NOT build self-serve onboarding.
Do NOT redesign the dashboard.
Do NOT create separate AI engines per industry.
Do NOT make beauty-specific logic in the core engine.

Positioning:
This is a generic "Appointment AI for service businesses":
- answers service questions
- answers price and FAQ from KB only
- collects booking details
- confirms before booking mutation
- creates bookings
- modifies bookings
- cancels bookings
- hands off when needed

Core required booking slots remain:
- service
- date
- time
- customerName
- phone

Current known good state:
- Beauty MVP smoke passes.
- V2 engine is default.
- Prompt v3 compact exists.
- KB top-k retrieval exists.
- Current booking service KB pinning exists.
- Booking create/modify/cancel works for beauty.
- Demo reset preserves KB by default unless resetKnowledgeBase=true.
- KB backup/restore scripts exist.
- Engine strips emoji and compacts booking replies.
- `pnpm run smoke:mvp` exists.

Your tasks:

1. Inspect existing industry seeds.
Files likely:
- packages/database/src/industry-seeds.ts
- packages/database/src/demo-industry-tenants.ts
- packages/database/src/apply-industry-seed.ts
- apps/api/src/modules/chat/chat.service.ts
- scripts/mvp-smoke.ts

2. Keep only these industries in Phase 2A validation:
- beauty
- cleaning
- yoga

Do not delete consulting/renovation data unless explicitly asked.
If there is a public demo selector, hide or mark consulting/renovation as not MVP-ready.

3. Create a parameterized multi-industry smoke runner.
Preferred script:
- scripts/multi-industry-smoke.ts

Preferred package script:
- "smoke:industries": "tsx scripts/multi-industry-smoke.ts"

It should call the real API:
- default API_BASE=http://localhost:3002
- use /api/chat/public with industryId

4. Smoke coverage per industry.

For each industry, test:
- price question
- FAQ question
- service recommendation / service detail
- unknown service does not invent price
- booking request enters booking flow
- collect required slots
- confirmation happens before create
- create booking side effect fires
- modify booking side effect fires
- DB row actually changes to requested date/time
- cancel booking side effect fires
- no emoji in replies
- booking confirmation reply has <= 5 non-empty lines
- booking success/modify/cancel reply has <= 2 non-empty lines

5. Use industry-specific test phrases, but keep assertions generic.

Beauty examples:
- service: 深層清潔 Facial or HIFU 緊緻療程
- price: HIFU 幾錢？
- booking: 我想預約深層清潔 Facial

Cleaning examples:
- service: 全屋深層清潔 or 冷氣機清洗
- price: 全屋深層清潔幾錢？
- booking: 我想預約全屋深層清潔
- FAQ: 你哋包唔包清潔用品？服務範圍去邊？

Yoga examples:
- service: 私人瑜珈課 or 私人瑜伽課
- price: 私人瑜珈課幾錢？
- booking: 我想預約私人瑜珈課
- FAQ: 第一堂有冇體驗價？要帶咩？

6. Seed quality check.

Verify cleaning and yoga tenants have active KB rows after seeding:
- cleaning should have enough SERVICE and FAQ rows for demo.
- yoga should have enough SERVICE and FAQ rows for demo.

If seed is missing, use the existing seed mechanism.
Do not overwrite the restored beauty KB unless explicitly requested.

7. Protect KB.

Before any destructive seed/reset:
- run a backup for affected tenant
- never call resetKnowledgeBase=true unless explicitly needed
- preserve the current demo-tenant beauty KB

8. Tests/build to run:

pnpm --filter @ats/ai-engine test
pnpm --filter @ats/ai-engine build
pnpm --filter @ats/api build
API_BASE=http://localhost:3002 pnpm run smoke:mvp
API_BASE=http://localhost:3002 pnpm run smoke:industries

9. Output:
Return:
- files changed
- exact smoke results by industry
- whether all three demos are sell-ready
- any vertical-specific risks
- any recommended copy changes for sales positioning

Acceptance:
The task is done only when Beauty, Cleaning, and Yoga pass multi-industry smoke against a fresh API process.
```
