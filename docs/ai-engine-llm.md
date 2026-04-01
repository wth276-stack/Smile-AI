# AI Engine — LLM-assisted path (v1)

For the **full end-to-end process** (API → `runAiEngine` → LLM vs rule, every fallback, semantic reasons, debug logs), see [`ai-engine-process.md`](./ai-engine-process.md).

## v1 constraints (approved)

### Tightening (usable v1)

- **No free-text override** of deterministic composers: LLM `replyText` is **not** used for customer-facing copy in v1. Intent + extractions drive routing; **PRICE / DETAIL / INQUIRY / GREETING / CONTACT / OTHER / BOOKING** all use existing template composers.
- **Semantic cross-checks** (after JSON schema pass): planner vs **rule intent** (`resolveRepairedRuleIntent`); `serviceMention` vs **catalog resolution**; **slot-fill without prior draft** rejected; **non-booking** intents must not introduce date/time from merge/JSON without deterministic message support; planner JSON must not carry **both** `extracted.date` and `extracted.time` on non-booking intents. Any failure → **full rule fallback**.

1. **Feature flag** — Default in code is **`auto`**: if **`OPENAI_API_KEY`** is set, the LLM planner is attempted; if the key is empty, behaviour matches **`rule`**. Set **`AI_ENGINE_MODE=rule`** to **force** deterministic-only (never call OpenAI).
   - `rule`: deterministic engine only (`shouldAttemptLlmPlanner` = false).
   - `llm` / `auto`: attempt OpenAI when key is non-empty; on planner failure → full **`processMessage`** fallback.

2. **Booking copy** — Booking slot + submission wording always from **`composeBookingResponse`**. Same for **PRICE / DETAIL / INQUIRY** (`compose*`); LLM supplies **structured** understanding only.

3. **Fallback** — Driven by **deterministic checks**, not model-reported confidence:
   - valid JSON, schema pass, service resolution rules, contradiction checks (e.g. date/time vs `extractSlots`), booking safety (no premature complete booking).

4. **Scope** — Inquiry, price, detail, booking + slot-fill only. No broader sales-agent behavior.

## Architecture

| Deterministic | LLM (when enabled) |
|---------------|-------------------|
| **All** customer `reply` strings: `compose*` (booking, price, detail, inquiry, greeting, contact, fallback) | Intent + extractions + `serviceMention` + flags (`usesDraftContext`, `switchedAwayFromDraftService`, `needsClarification`, `nextExpectedSlot`) — **not** final wording |
| `collectSideEffects`, merge + `extractSlots` cross-check, `matchService`, semantic cross-check vs rule intent | JSON planner only; invalid / inconsistent → rule fallback |

## Env

| Variable | Description |
|----------|-------------|
| `AI_ENGINE_MODE` | `rule` \| `llm` \| `auto` — code default **`auto`** (unset env → `auto`) |
| `OPENAI_API_KEY` | Non-empty key required for LLM path when mode is `llm` or `auto` |
| `OPENAI_DEFAULT_MODEL` | Optional; default `gpt-4o-mini` |
| `AI_ENGINE_LLM_TIMEOUT_MS` | Optional timeout (e.g. `15000`) |

## Known limitations (v1)

- Latency/cost per message when LLM is on.
- Model may mis-label intent; validation + fallback reduce but do not eliminate errors.
- v1 does **not** surface model `replyText` to users; wording is always from composers so facts align with knowledge snippets.
