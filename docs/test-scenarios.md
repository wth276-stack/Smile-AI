# Test Scenarios — Phase 1 Reliability Cycle

> Version: 2026-03-28
> Related: `docs/acceptance-notes.md`, `docs/demo-script.md`

This document provides concrete test cases for validating Priority A/B/C work.

---

## Priority A: Service Matching

### A1: Exact Match

| # | Input | KB Service | Expected |
|---|-------|------------|----------|
| A1.1 | "HIFU" | "HIFU 緊緻" (alias: ["HIFU", "超聲波刀"]) | `type: 'exact'`, confidence ≥ 0.95 |
| A1.2 | "Eye Treatment" | "Eye Treatment" | `type: 'exact'` |
| A1.3 | "facial treatment" | "Facial Treatment" | `type: 'close'` or `'exact'` |
| A1.4 | "美白 Facial" | "美白 Facial" | `type: 'exact'` |
| A1.5 | "ＨＩＦＵ" (full-width) | "HIFU 緊緻" | `type: 'exact'` (normalized) |

### A2: Alias Match

| # | Input | KB Service + Aliases | Expected |
|---|-------|---------------------|----------|
| A2.1 | "超聲波刀" | "HIFU 緊緻", aliases: ["HIFU", "超聲波刀"] | `type: 'exact'` |
| A2.2 | "HIFU treatment" | "HIFU 緊緻", aliases: ["HIFU"] | `type: 'exact'` or `'close'` |
| A2.3 | "緊緻療程" | "HIFU 緊緻", aliases: ["緊緻療程"] | `type: 'exact'` |

### A3: Ambiguous Match

| # | Input | KB Services | Expected |
|---|-------|-------------|----------|
| A3.1 | "激光" | "激光祛斑", "激光嫩膚" | `type: 'ambiguous'`, both listed |
| A3.2 | "anti aging" | "Anti-aging Treatment", "Anti-aging Facial" | `type: 'ambiguous'` |
| A3.3 | "美白療程" | "皇室美白療程", "晶鑽美白療程" | `type: 'ambiguous'` |

### A4: No Match

| # | Input | KB Services | Expected |
|---|-------|-------------|----------|
| A4.1 | "火星療程" | (any services) | `type: 'none'` |
| A4.2 | "今日天氣" | (any services) | `type: 'none'` |
| A4.3 | "療程" | (any services) | `type: 'none'` (generic) |
| A4.4 | "asdfghjkl" | (any services) | `type: 'none'` |

### A5: Cross-Service Context (Draft Fallback)

| # | Prior Context | Input | Expected |
|---|---------------|-------|----------|
| A5.1 | Draft: "Eye Treatment" | "咁幾錢呀" | Price for Eye Treatment |
| A5.2 | Draft: "HIFU 緊緻" | "有咩功效" | Effect for HIFU 緊緻 |
| A5.3 | Draft: "Eye Treatment" | "Facial 幾錢" | Price for **Facial** (new service wins) |
| A5.4 | Draft: "Eye Treatment" | "激光幾錢" | Ambiguity prompt (do NOT use Eye price) |

---

## Priority B: Slot Filling

### B1: Multi-Turn Slot Collection

| Turn | Input | Extracted | Draft State |
|------|-------|-----------|-------------|
| 1 | "我想預約 HIFU" | service: "HIFU" | `{ serviceName: "hifu", ... }` |
| 2 | "明天下午三點" | date: tomorrow, time: "15:00" | `{ ..., date: "2026-03-29", time: "15:00" }` |
| 3 | "我叫陳大文電話91234567" | name: "陳大文", phone: "91234567" | `{ ..., customerName: "陳大文", phone: "91234567" }` |
| — | — | — | `isBookingComplete() === true` |

### B2: Slot Persistence

| # | Sequence | Expected |
|---|----------|----------|
| B2.1 | "我想預約 HIFU" → "功效係咩" → "咁幾錢" | Service persists for price question |
| B2.2 | "明天下午三點" → "我想改後天" | Date SHOULD NOT change (confirmed slot) |
| B2.3 | "我叫陳大文" → "電話91234567" | Name persists, phone added |

### B3: Missing Slot Detection

| Draft State | `getMissingSlots()` |
|-------------|---------------------|
| `{ serviceName: "HIFU", date: null, time: null, ... }` | `['date', 'time', 'customerName', 'phone']` |
| `{ serviceName: "HIFU", date: "2026-03-29", time: "15:00", ... }` | `['customerName', 'phone']` |
| All filled | `[]` |

### B4: Date Extraction

| Input | Reference Date | Expected Output |
|-------|----------------|-----------------|
| "今天" | 2026-03-28 | "2026-03-28" |
| "明天" | 2026-03-28 | "2026-03-29" |
| "後天" | 2026-03-28 | "2026-03-30" |
| "星期三" | 2026-03-28 (Sat) | "2026-04-01" |
| "下星期三" | 2026-03-28 (Sat) | "2026-04-08" |
| "3月15日" | 2026-03-28 | "2026-03-15" (next year) |

### B5: Time Extraction

| Input | Expected |
|-------|----------|
| "下午7點" | "19:00" |
| "上午7點" | "07:00" |
| "7:30pm" | "19:30" |
| "19:30" | "19:30" |
| "晚上7點半" | "19:30" |
| "7點" | `null` (ambiguous) |
| "凌晨3點" | "03:00" |

### B6: Name Extraction

| Input | Expected Name |
|-------|---------------|
| "我叫陳大文" | "陳大文" |
| "我係王小明電話91234567" | "王小明" |
| "name is John Chan" | "John Chan" |
| "我姓李" | "李" |

### B7: Phone Extraction

| Input | Expected Phone |
|-------|----------------|
| "電話91234567" | "91234567" |
| "手機 98765432" | "98765432" |
| "聯絡 6123 4567" | "61234567" |

---

## Priority C: Natural Conversation

### C1: Response Length

| Intent | Input | Max Length Check |
|--------|-------|------------------|
| GREETING | "你好" | Reply < 80 chars |
| PRICE_INQUIRY | "HIFU 幾錢" | Reply < 150 chars |
| PRODUCT_INQUIRY | "HIFU 有咩功效" | Reply < 200 chars |

### C2: Relevant Facts Only

| # | Input | KB Content | Expected |
|---|-------|------------|----------|
| C2.1 | "HIFU 幾錢" | effect, suitable, price, duration | Reply contains price, NOT full FAQ dump |
| C2.2 | "HIFU 功效" | effect, suitable, price, duration | Reply contains effect, NOT price or duration |
| C2.3 | "HIFU 適合邊類人" | effect, suitable, price | Reply contains suitable field only |

### C3: Ambiguity Response

| # | Input | Expected Response Pattern |
|---|-------|--------------------------|
| C3.1 | "激光" (ambiguous) | "你想了解邊個服務？\n1. 激光祛斑\n2. 激光嫩膚" |
| C3.2 | "美白療程" (ambiguous) | Lists 2-3 matching services |
| C3.3 | "火星療程" (none) | "抱歉，我唔太清楚你指邊個服務。你可以講多啲細節嗎？" |

### C4: Confirmation Flow

| Turn | Input | Mode | Expected Behavior |
|------|-------|------|-------------------|
| 1 | "我想預約 HIFU 明天下午三點 叫陳大文電話91234567" | BOOKING_DRAFT → CONFIRMATION_PENDING | Show summary, ask for "確認預約" |
| 2 | "好的" | CONFIRMATION_PENDING | Re-show summary, still waiting |
| 3 | "確認預約" | CONFIRMATION_PENDING → POST_BOOKING | Submit booking, show confirmation |

### C5: Follow-Up Questions

| # | Context | Input | Expected |
|---|---------|-------|----------|
| C5.1 | Draft: HIFU | "咁幾錢" | Price for HIFU |
| C5.2 | Draft: HIFU | "有咩功效" | Effect for HIFU |
| C5.3 | Draft: HIFU | "適合孕婦嗎" | Unsuitable field (if exists) or general answer |

---

## Clarification & Confirmation Safety

### D1: No Guessing on Ambiguity

| # | Input | Expected |
|---|-------|----------|
| D1.1 | "激光" (ambiguous) | List options, NOT single guess |
| D1.2 | "療程" (generic) | Ask for clarification, NOT first service |

### D2: Explicit Confirmation Required

| # | Input | Expected |
|---|-------|----------|
| D2.1 | All slots filled + "好的" | Stay in CONFIRMATION_PENDING |
| D2.2 | All slots filled + "ok" | Stay in CONFIRMATION_PENDING |
| D2.3 | All slots filled + "確認預約" | Transition to POST_BOOKING |

---

## Test Execution Commands

### Service Matcher Regression

```bash
cd packages/ai-engine && node -e "
const m = require('./dist/service-matcher.js');
const r = m.verifyServiceMatcherRegression();
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
"
```

### Booking State Regression

```bash
cd packages/ai-engine && node -e "
const b = require('./dist/booking-state.js');
const r = b.verifyBookingDateTimeRegression();
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
"
```

### Orchestrator Context Regression

```bash
cd packages/ai-engine && node -e "
const o = require('./dist/orchestrator.js');
const r = o.verifyServiceContextRegression();
console.log(JSON.stringify(r, null, 2));
process.exit(r.ok ? 0 : 1);
"
```

### E2E Chat Test

```bash
cd packages/database && npx tsx prisma/seed-demo.ts
curl -X POST http://localhost:3001/api/chat/message \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"demo-tenant","channel":"WEBCHAT","externalContactId":"test-1","message":"HIFU 幾錢"}'
```

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-28 | Initial version | frontend-docs-status |