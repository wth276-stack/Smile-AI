# Phase 1 V2 cleanup — implementation pack

**Status:** This document contains the full rule inventory, file diffs, and verification steps. If changes are not yet in the repo, apply the patches below (or switch Cursor to **Agent** mode and re-run the implementation task so edits + tests can run).

---

## A. Files to change

| File | Action |
|------|--------|
| [packages/ai-engine/src/v2/prompt.ts](packages/ai-engine/src/v2/prompt.ts) | Replace `buildSystemPrompt` with compressed prompt + JSDoc rule inventory |
| [packages/ai-engine/src/v2/index.ts](packages/ai-engine/src/v2/index.ts) | Re-export `isConfirmationMessage` from `./validator` |
| [packages/ai-engine/src/index.ts](packages/ai-engine/src/index.ts) | Re-export `isConfirmationMessage` (optional; for `@ats/ai-engine` barrel) |
| [apps/api/src/modules/chat/stale-confirmation-escape.ts](apps/api/src/modules/chat/stale-confirmation-escape.ts) | Remove duplicate; import from `@ats/ai-engine` |
| [packages/ai-engine/src/v2/engine.ts](packages/ai-engine/src/v2/engine.ts) | Add `isV2DebugLog()`; gate verbose logs behind `AI_ENGINE_V2_DEBUG` |
| [`.env.example`](.env.example) (optional) | Document `AI_ENGINE_V2_DEBUG` |

---

## B. Rule inventory (bucket assignment)

| Rule | Bucket | Reason |
|------|--------|--------|
| Single role + default Cantonese + mirror user language | Keep (compressed) | Task/role boundary; removed duplicate Lang line |
| KB-only facts; no fabrication | Compress and keep | Safety / grounding |
| Service align to [SVC]; removed typos/80%/no-catalog essay | Delete now + **move later** (retrieval) | One line: “Align to KB [SVC]; draft/retrieval bias” — engine has `inferMissingService` + `matchService` |
| `duration` vs `effect_duration` / months | Compress and keep | Business correctness |
| Package: includes before price | Compress and keep | KB structure |
| One missing field per turn unless many | Keep for now | Not fully replaced by determinism everywhere |
| CONFIRM / affirm → SUBMIT\|MODIFY\|CANCEL; reject → COLLECT | Compress and keep | Contract |
| Modify/cancel + list bookings | Compress and keep | Uses injected section |
| [系統日期解析] + Today HK | Compress and keep + engine (unchanged) | Pairs with `resolveRelativeDates` |
| 9號 vs 11點, don’t swap | Keep for now | `validator` has swap correct; edge cases |
| newSlots = delta / schema | Compress and keep | Output contract |
| “Voice, emoji, friendly” / Style bullets | **Delete now** | Obvious; micromanagement |
| `fill any known ✗ slots you can infer` at end | **Delete now** (in prompt) | Over-instructs the model; engine has `deterministicSlotFallback` |

---

## C–E. Before/after; removed; kept

**Before:** ~45 lines in the rules/output block with repeated Role/Lang, long catalog-matching line, per-action bullet list, voice/emoji, persona as `- Style` / `- Language`.

**After:** Sections `Grounding` / `Booking flow` / `Dates and times` / compact `Actions` + single JSON schema; rule inventory in JSDoc on `buildSystemPrompt`.

**Intentionally kept (brief):** grounding, duration vs effect_duration, flow contract, system date block + day vs time, one field per turn, modify/cancel behavior.

**Risks:** Slightly less explicit “intent enum” per action — still in JSON line; e2e / smoke recommended.

---

## D. Deduplicate `isConfirmationMessage`

1. `packages/ai-engine/src/v2/index.ts` add to exports from `validator`:

```ts
export { isConfirmationMessage } from './validator';
```

2. `packages/ai-engine/src/index.ts` add:

```ts
export { isConfirmationMessage } from './v2/validator';
```

3. `stale-confirmation-escape.ts` — remove local `isConfirmationMessage` (lines 6–30), add:

```ts
import { isConfirmationMessage } from '@ats/ai-engine';
```

Update file header comment: single source in `v2/validator.ts`.

---

## F. Gated logging (`AI_ENGINE_V2_DEBUG`)

In `v2/engine.ts` top (after imports):

```ts
function isV2DebugEnabled(): boolean {
  const v = (process.env.AI_ENGINE_V2_DEBUG ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
```

- **When `isV2DebugEnabled()`:** log full `messages` JSON, `Content preview`, `Raw LLM response`, `Injected date hint` (full), regex extraction lines, `Fallback slots` JSON, etc.
- **Always (minimal, no full payload):** one line e.g. `[v2/engine] openai model=… messages=N …` + `finish_reason` + `usage` (tokens); KB injection warning; errors.

---

## G. Test commands

```bash
cd "c:\Users\wongt\AI TOP SALES\packages\ai-engine"
pnpm exec vitest run
```

If the repo has an api e2e:

```bash
cd "c:\Users\wongt\AI TOP SALES\apps\api"
pnpm exec vitest run
# or: pnpm test
```

Relevant existing tests: `packages/ai-engine/src/v2/prompt.format-kb.test.ts` (if present), `run-ai-engine-route.test.ts`, `prompt` tests in `scripts/test-persona-switch.ts` / `tests/phase1-verify.ts`.

---

## H. `buildSystemPrompt` replacement body

See the agent-applied `prompt.ts` in git once merged; the intended final user-facing string structure is in section **B** and the implementation task description.

---

**Next step for the user:** Switch to **Agent** mode in Cursor and ask: “Apply `docs/PHASE1-V2-CLEANUP-IMPLEMENTATION.md` to the repo and run vitest,” so non-markdown files can be edited and tests executed.

---

## Appendix: `stale-confirmation-escape.ts` (target full file)

```typescript
/**
 * Stale booking-confirmation escape (FAQ / info queries while confirmationPending).
 * isConfirmationMessage: single source in @ats/ai-engine (v2/validator).
 */

import { isConfirmationMessage } from '@ats/ai-engine';

const PRICE_OR_INFO_REDIRECT = /幾錢|價錢|價格|how much|收費|想知道.*價|想問.*價|只係想知|只想問|只係想了解|營業|地址|幾耐|副作用|係咩|有咩|邊度/i;

/**
 * Modification / cancel / correction related to the pending booking — do NOT escape.
 * If the user mixes "唔正確" with a clear price/FAQ ask, treat as FAQ (not modify-only).
 */
export function isModifyOrCancelIntent(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;

  if (PRICE_OR_INFO_REDIRECT.test(t) && !/改時間|改日期|改做|換.*時間|換.*日期|想改.*點|改為.*點/.test(t)) {
    return false;
  }

  if (/cancel|取消預約|唔要預約|唔book|算啦|唔好意思.*取消|唔做|唔預約/i.test(t)) return true;
  if (/改時間|改日期|改做|想改|要改|換時間|換日期|wrong|change|modify|想改做|改為|改成/i.test(t)) return true;
  if (/電話打錯|名打錯|名寫錯|電話寫錯|應該係|打錯咗/i.test(t)) return true;
  if (/唔正確|唔啱|錯咗|錯了|唔係.*資料|資料.*唔啱/.test(t)) return true;

  return false;
}

export function isFaqOrInfoQuery(msg: string): boolean {
  const t = msg.trim();
  if (!t) return false;

  if (/幾錢|價錢|價格|how much|收費|\bfee\b|\bcost\b|\bprice\b/i.test(t)) return true;
  if (/係咩|有咩|營業時間|開幾點|幾點關|邊度|地址|location|有冇副作用|做幾耐|適合|禁忌|效果|原理/i.test(t)) return true;
  if (/^(你好|喂|hi|hello|您好|早晨|午安|晚安|bye|拜拜|再見|多謝|thanks|thank you)[!！。.]?$/i.test(t)) return true;
  if (/[?？]/.test(t) && /(幾|什麼|咩|邊|點|點樣|是否|會唔會|有冇|可以|可唔可以|邊個)/.test(t)) return true;

  return false;
}

export function shouldEscapeStaleConfirmation(message: string): boolean {
  if (isConfirmationMessage(message)) return false;
  if (isModifyOrCancelIntent(message)) return false;
  return isFaqOrInfoQuery(message);
}
```

**Add to** `packages/ai-engine/src/v2/index.ts` exports:
`export { isConfirmationMessage } from './validator';`

**Add to** `packages/ai-engine/src/index.ts` (after other exports, near v2 re-exports if any):
`export { isConfirmationMessage } from './v2/validator';`

---

## Appendix: `engine.ts` debug helper (place after imports / constants)

```typescript
function isV2DebugEnabled(): boolean {
  const v = (process.env.AI_ENGINE_V2_DEBUG ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
```

Gate: `isV2DebugEnabled() &&` before any log that includes full `messages` JSON, raw LLM body, 500-char content preview, `JSON.stringify` of slots with PII. Keep one summary line per request: model, message count, finish_reason, token usage.
