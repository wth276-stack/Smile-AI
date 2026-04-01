# Acceptance Notes — Phase 1 Reliability Cycle

> Version: 2026-03-28
> Scope: Priority A/B/C per `project_priorities.md`

This document defines **done** for each priority work item. All criteria must pass for acceptance.

---

## Priority A: Service Matching

**Files:** `packages/ai-engine/src/service-matcher.ts`

### Acceptance Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| A1 | Exact match returns `type: 'exact'` with confidence ≥ 0.95 | Run `verifyServiceMatcherRegression()` — must pass all baseline tests |
| A2 | Alias match works for user-defined aliases from KB | Create doc with alias `["HIFU", "超聲波刀"]`, query "超聲波刀" → exact match |
| A3 | Ambiguous match returns `type: 'ambiguous'` with top 2 candidates | Query "激光" when KB has "激光祛斑" and "激光嫩膚" → both listed |
| A4 | No match returns `type: 'none'` without dumping all services | Query "火星療程" → `type: 'none'`, matches empty or low confidence |
| A5 | Confidence-based ranking prevents low-confidence false positives | Query "療程" alone → `type: 'none'` (generic term) |
| A6 | Chinese character overlap works for partial matches | Query "美白" matches "美白 Facial" or similar |
| A7 | Full-width Latin normalization works | Query "ＨＩＦＵ" (full-width) matches "HIFU" |
| A8 | Plural/singular English matching works | Query "eye treatments" matches "Eye Treatment" |

### Regression Test Command

```bash
cd packages/ai-engine && node -e "
const m = require('./dist/service-matcher.js');
const r = m.verifyServiceMatcherRegression();
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
"
```

### Known Behaviors (Do Not Change)

- "7點" without AM/PM returns `null` time (intentional safety)
- Generic tokens ("treatment", "facial") are filtered and don't cause matches
- Ambiguity detection uses confidence gap threshold (see `isAmbiguousPair`)

---

## Priority B: Slot Filling / Booking State Machine

**Files:** `packages/ai-engine/src/booking-state.ts`, `orchestrator.ts`, `conversation-mode.ts`

### Acceptance Criteria

| # | Criterion | How to Verify |
|---|-----------|---------------|
| B1 | Draft slots persist across messages | Multi-turn: "我想預約 HIFU" → "明天下午三點" → "我叫陳大文電話91234567" → all slots filled |
| B2 | Confirmed slots cannot be overwritten by new messages | After "明天" extracted, subsequent "後天" in same conversation does NOT overwrite |
| B3 | Missing slots are detected | `getMissingSlots()` returns exactly the missing required fields |
| B4 | Booking complete detection works | When all 5 slots filled (service, date, time, name, phone) → `isBookingComplete()` returns `true` |
| B5 | Reset after booking submission | After `REQUEST_BOOKING` → draft resets to empty, mode → `POST_BOOKING` |
| B6 | Draft is NOT cleared mid-flow | Service context persists for follow-up questions (price, effect) |
| B7 | Date extraction handles relative dates | "今天" → today, "明天" → tomorrow, "星期三" → next Wednesday |
| B8 | Time extraction requires AM/PM context | "7點" → `null`; "下午7點" → "19:00"; "19:30" → "19:30" |
| B9 | Name extraction stops before phone/contact keywords | "我叫陳大文電話91234567" → name="陳大文", phone="91234567" (not "陳大文電話") |

### Regression Test Command

```bash
cd packages/ai-engine && node -e "
const b = require('./dist/booking-state.js');
const r = b.verifyBookingDateTimeRegression();
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
"
```

### State Machine Flow

```
GREETING → INQUIRY → BOOKING_DRAFT → CONFIRMATION_PENDING → POST_BOOKING
                ↓           ↓              ↓
            (inquiry)   (slot fill)   (explicit confirmation)
```

---

## Priority C: Natural Conversation

**Files:** `packages/ai-engine/src/response-composer.ts`, `service-detail-handler.ts`, `faq-matcher.ts`

### Acceptance Criteria

| # | Criterion | Example |
|---|-----------|---------|
| C1 | Replies are concise for simple questions | Price answer < 150 chars for single-service query |
| C2 | Only relevant facts included | "HIFU 幾錢" → price only, not full FAQ dump |
| C3 | Follow-up questions are natural | "你想知功效、適合邊類人、價格，定係想直接預約？" |
| C4 | Ambiguity prompts list options clearly | "激光" → "你想了解邊個服務？\n1. 激光祛斑\n2. 激光嫩膚" |
| C5 | Booking confirmation shows summary | Lists service, date, time, contact before "確認預約" request |
| C6 | FAQ matching uses KB-stored items | Match stored FAQ question "做完會唔會紅？" → stored answer |
| C7 | Service detail uses structured fields | "HIFU 功效" → uses `effect` field, not full content |

### Response Length Guidelines

| Intent | Max Length | Notes |
|--------|------------|-------|
| GREETING | 80 chars | Welcome + offer help |
| PRICE_INQUIRY | 150 chars | Price + optional discount |
| PRODUCT_INQUIRY | 200 chars | Brief summary + follow-up |
| BOOKING_DRAFT | 120 chars | Ask for missing slots |
| CONFIRMATION_PENDING | 180 chars | Summary + confirmation request |
| AMBIGUOUS | 200 chars | List 2-3 options |

---

## Clarification & Confirmation Safety

### Clarification (Ambiguity)

**When:** Service match returns `type: 'ambiguous'` OR `type: 'none'` with low confidence

**Behavior:**
- Never guess a single service
- List 2-3 candidate services
- Ask user to clarify: "你想了解邊個服務？"

**Do NOT:**
- Return first match silently
- Return "no service found" with no suggestions
- Use draft service context for ambiguous input

### Confirmation (Booking)

**When:** All slots filled, entering `CONFIRMATION_PENDING` mode

**Behavior:**
- Show summary: service, date, time, contact
- Ask for EXPLICIT confirmation phrase: "請回覆「確認預約」"
- Only proceed to `POST_BOOKING` on explicit confirmation

**Do NOT:**
- Auto-submit booking on slot completion
- Accept vague confirmations ("好的", "ok") as final
- Skip confirmation step

---

## Test Scenarios

See `docs/test-scenarios.md` for detailed test cases covering all priorities.

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-28 | Initial version | frontend-docs-status |