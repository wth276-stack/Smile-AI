# V2 handoff — 2026-04-17

## Completed (this round)

- **KB service recognition (validator):** `validateOutput` no longer relies only on knowledge chunk **titles**. It uses `buildServiceCatalog` + `matchService` (`exact` / `close` / `ambiguous` all count as recognized; ambiguous is **not** treated as not-found). Fallback: chunk `title` + `aliases`, then catalog `displayName` + generated `aliases` substring match.
- **Duplicate-affirm UX:** When the duplicate-affirm guard coerces `SUBMIT_BOOKING` → `REPLY_ONLY` (`DUPLICATE_AFFIRM_GUARD_ISSUE`), `applyConfirmationBoundaryPostProcess` receives `skipDeterministicConfirmationTemplate: true` so **Case 3** (deterministic confirmation template) does not run; the LLM reply is kept as-is.
- **Tests:** `validator.kb-match.test.ts`, `confirmation-boundary.test.ts`; regression `apps/api/test/chat-flow.e2e-spec.ts` with `RUN_CHAT_E2E=1` — **14/14 passed**.

## Deliberately not done

- No canonical service name written back into `bookingDraft` / DB.
- No prompt changes; no broad confirmation-boundary refactor.
- Task 2 limited to duplicate-affirm / Case 3 only.

## Next steps (suggested)

- If logs still show alias gaps for specific tenants, add **document `aliases`** in KB/DB (data), not new rewrite layers.
- Optional: tighten observability for ambiguous `matchService` results (log-only).

## Verification commands

```bash
cd packages/ai-engine && pnpm exec vitest run src/v2/validator.kb-match.test.ts src/v2/confirmation-boundary.test.ts
cd apps/api && set RUN_CHAT_E2E=1 && pnpm exec jest --config jest.integration.config.js test/chat-flow.e2e-spec.ts --runInBand
```

(PowerShell: `$env:RUN_CHAT_E2E='1';` before `jest`.)
