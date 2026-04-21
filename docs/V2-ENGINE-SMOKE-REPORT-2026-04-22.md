# V2 engine smoke & token report (2026-04-22)

This run exercises **post–prompt-slimming** `runAiEngineV2` with real OpenAI (`gpt-4o-mini` unless overridden). No **pre-slimming** token baseline exists in-repo; comparison is **not applicable** unless historical logs are added later.

---

## 1. Commands run

| Command | Purpose |
|--------|---------|
| `pnpm test-booking-critical-path` | Multi-turn booking E2E (BEAUTY + CLINIC): `ts-node` + `dotenv` from repo root |
| `node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/test-v2-engine.ts` | Single-call booking-style message with `聽日` (loads API key without relying on script-local `dotenv`) |
| `npx vitest run src/v2/` (in `packages/ai-engine`) | Regression on v2 unit tests |
| `npx tsc --noEmit` (in `packages/ai-engine`) | Typecheck |

**FAQ / HIFU triple question** was run as a **one-off** `tsx` session (same code paths as production `runAiEngineV2`); the ephemeral script was removed after capture to avoid adding lasting harness files. Recorded metrics below.

---

## 2. Scenario summaries

### A) FAQ / product info (HIFU: 維持幾耐、價錢、痛)

- **User message:** `HIFU 維持幾耐？幾多錢？痛唔痛呀？`
- **KB:** HIFU chunk with price/discount, `effect`, `effect_duration`-eligible FAQ, `faq.pain`.
- **Outcome:** `_v2Action`: **REPLY**, intent **FAQ**, legacy **REPLY_ONLY**. Reply covered maintenance window, discount vs list price, and comfort—all grounded in compact KB lines.
- **Date parsing:** N/A (no relative date in user text; no `[系統日期解析]` injection on this turn).

### B) New booking flow (existing harness: `scripts/test-v2-engine.ts` test 2)

- **User message:** `我想book聽日下午3點做補濕亮肌Facial，我叫陳小明，電話98765432`
- **Outcome:** `_v2Action`: **CONFIRM_BOOKING**, draft filled with service, **date 2026-04-23**, **15:00**, name, phone. `confirmationPending`: true.
- **Date parsing:** `[系統日期解析]` appended with **聽日 = 2026-04-23（星期四）**; matches engine expectation for HK “tomorrow” relative to **Today: 2026-04-22 (Wed)** in system prompt.

### C) Collect → confirm → submit (`pnpm test-booking-critical-path`)

Per vertical (BEAUTY = 激光去斑 + `9號11點`; CLINIC = 普通科門診 + same pattern):

| Turn | User intent (summary) | Final `_v2Action` (expected) | Date / time checks |
|------|-------------------------|-------------------------------|-------------------|
| 1 | 我想預約 | COLLECT_BOOKING | — |
| 2 | service + 9號11點 | COLLECT_BOOKING | `date === 2026-05-09`, `time === 11:00`, **not** swapped (day≠11 & hour≠9) |
| 3 | 陳小姐 91234567 | CONFIRM_BOOKING | `confirmationPending === true` |
| 4 | 好 | SUBMIT_BOOKING | — |

- **Date parsing:** Turn 2 uses injected hint `9號 = 2026-05-09（星期六）` from `resolveRelativeDates`; assertions **passed** for both verticals.
- **Result:** **69 PASS**, **1 SOFT WARN**, **0 HARD FAIL**.

---

## 3. Token usage (OpenAI usage object)

### A) FAQ HIFU (single turn)

| Metric | Value |
|--------|------|
| prompt_tokens | 808 |
| completion_tokens | 80 |
| total_tokens | 888 |

### B) `test-v2-engine` test 2 (one-shot booking + 聽日)

From `result.analytics`: **inputTokens 959**, **outputTokens 120** (total **1079**).

### C) `test-booking-critical-path` (per API call)

**BEAUTY**

| Turn | prompt_tokens | completion_tokens | total_tokens |
|------|---------------|-------------------|--------------|
| 1 | 777 | 47 | 824 |
| 2 | 876 | 76 | 952 |
| 3 | 939 | 86 | 1025 |
| 4 | 1028 | 94 | 1122 |
| **Σ** | **3620** | **303** | **3923** |

**CLINIC**

| Turn | prompt_tokens | completion_tokens | total_tokens |
|------|---------------|-------------------|--------------|
| 1 | 760 | 57 | 817 |
| 2 | 921 | 52 | 973 |
| 3 | 926 | 105 | 1031 |
| 4 | 1034 | 79 | 1113 |
| **Σ** | **3641** | **293** | **3934** |

*Notes:* Prompt tokens **rise with conversation length** (more turns in context). Turn 1 system prompt alone logged **~777–808** prompt tokens—useful as a **rough** “slim system + KB” floor for this model and tenant settings.

---

## 4. Token comparison vs baseline

**None.** Repository does not contain stored pre-slimming `prompt_tokens` lines. To compare after future changes, save the same harness stdout (or `analytics` JSON) under `docs/baselines/`.

---

## 5. Action compliance

- **FAQ scenario:** **REPLY** / **FAQ** — matches informational intent; no booking side-effects.
- **test-v2 booking one-shot:** **CONFIRM_BOOKING** when all slots provided — expected for “confirm summary then user affirms” design (pending flag set).
- **Critical path:** **COLLECT → COLLECT → CONFIRM → SUBMIT** satisfied for both tenants; **validator forced SUBMIT** on affirmation in line with `[v2/validator] Forced SUBMIT_BOOKING` log (expected guardrail).

---

## 6. Regressions / anomalies

1. **SOFT WARN (1):** `[BEAUTY Turn 4] raw LLM action differs from final engine action` — raw **CONFIRM_BOOKING**, final **SUBMIT_BOOKING** after affirmation with full draft. This is **intentional post-processing**, not a failure.

2. **`scripts/test-v2-engine.ts`** does not load `.env`; running it **without** `node --env-file=.env` yields missing API key and fallback replies. Documented fix: use the same `--env-file` pattern as in this report (not a product bug).

---

## 7. Staging / production readiness

| Assessment | Notes |
|------------|--------|
| **Automated** | `pnpm test-booking-critical-path` **exit 0**; `vitest` v2 + `tsc` **pass**. |
| **Risk** | Low for prompt-only slimming: actions and date hints behaved as designed in smoke paths. |
| **Recommendation** | **Safe to deploy to staging** with monitoring on booking submission rates, confirmation flows, and OpenAI error rates. **Production:** roll out via existing release process; no code change required from this smoke unless product policy differs on CONFIRM vs SUBMIT boundary messaging. |

---

## 8. Next fix (evidence-based only)

| Finding | Smallest responsible layer | Suggested fix (not implemented here) |
|---------|----------------------------|--------------------------------------|
| Operators may be confused when logs show raw **CONFIRM_BOOKING** on “好” before validator upgrades to **SUBMIT_BOOKING** | Validator / observability | Expose **final** action only in customer-facing analytics, or tag `rawAction` vs `finalAction` in traces — **only if** support tickets cite confusion. |

No prompt, engine, or validator code changes are recommended from this pass unless new failing tests appear.
