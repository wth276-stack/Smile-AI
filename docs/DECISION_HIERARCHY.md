# Decision Hierarchy Documentation (P0)

**Status**: Draft
**Created**: 2026-03-29
**Purpose**: Document actual decision flow and clarify authoritative vs advisory systems

---

## Current Call Path Analysis

### Entry Point: `runAiEngine()` (orchestrator.ts)

```
Step 1: classifyQuestion()                    [Line 127]
        ↓
Step 2: Phase 1.5A - Hardcoded FAQ            [Lines 129-138]
        → Returns early if matched
        ↓
Step 3: Phase 1.5C/1.5D - Service Detail       [Lines 140-162]
        → Returns early if matched
        ↓
Step 4: Phase 1.5D - KB FAQ matching           [Lines 164-179]
        → Returns early if matched
        ↓
Step 5: Decision Engine (early)               [Lines 183-190]
        → Computes signals, stage, strategy
        → **ADVISORY** - used for LLM context only
        ↓
Step 6: LLM Pipeline                           [Line 193]
        → tryLlmPlannerPipeline()
        → Returns early if matched
        ↓
Step 7: processMessage() - Rule Fallback       [Line 194]
        → If LLM returns null
```

### Inside `processMessage()`:

```
Step 1: Intent detection                      [Lines 398-404]
        ↓
Step 2: Slot extraction                       [Lines 408-442]
        ↓
Step 3: Service matching                      [Lines 445-462]
        ↓
Step 4: Mode transition (resolveNextMode)     [Lines 465-476]
        ↓
Step 5: Decision Engine (again)               [Lines 477-492]
        → Computes signals for routeByMode
        ↓
Step 6: routeByMode()                         [Line 495]
```

### Inside `routeByMode()`:

```
Step 1: Strategy escalation check             [Lines 541-552]
        → If shouldEscalate, return handoff reply
        ↓
Step 2: Mode-based routing:
        ├── HANDOFF → return handoff reply           [Lines 554-563]
        ├── POST_BOOKING → create booking             [Lines 565-599]
        ├── CONFIRMATION_PENDING →                    [Lines 601-691]
        │   ├── Handoff trigger check                 [Lines 628-645]
        │   │   └── checkHandoffTrigger()             ← **AUTHORITATIVE**
        │   └── Business rules validation             [Lines 647-666]
        │       └── validateBookingRules()            ← **AUTHORITATIVE**
        ├── BOOKING_DRAFT                            [Lines 693-699]
        ├── GREETING                                  [Lines 701-704]
        └── INQUIRY / default                         [Lines 706-757]
```

---

## Critical Findings

### 1. Business Rules Gap

**Problem**: Business rules (`validateBookingRules`) only execute inside `CONFIRMATION_PENDING` mode.

**Evidence**:
```typescript
// orchestrator.ts Line 647-666
if (mode === 'CONFIRMATION_PENDING') {
  // ...
  const validation = validateBookingRules(draft, businessConfig);
  if (!validation.valid && validation.reason) {
    // Business rules enforced
  }
}
```

**Gap**: If a booking is attempted outside `CONFIRMATION_PENDING` mode (e.g., in `BOOKING_DRAFT` or via LLM response), business rules are **NOT** checked.

### 2. Handoff Trigger Gap

**Problem**: Handoff triggers (`checkHandoffTrigger`) only execute inside `CONFIRMATION_PENDING` mode.

**Evidence**:
```typescript
// orchestrator.ts Lines 627-645
if (mode === 'CONFIRMATION_PENDING') {
  // ...
  const handoffResult = checkHandoffTrigger({
    message: msg,
    draft,
    serviceMatch,
    correctionCount,
    conversationMode: mode,
  });
}
```

**Gap**: High-risk signals detected by Decision Engine can trigger `shouldEscalate`, but correction-based handoff triggers only work in `CONFIRMATION_PENDING`.

### 3. LLM Bypass

**Problem**: If LLM Pipeline returns a response, it completely bypasses `processMessage()` and `routeByMode()`.

**Evidence**:
```typescript
// orchestrator.ts Line 193-194
const llmResult = await tryLlmPlannerPipeline(input, priorMode, priorConfirmationPending, strategyContext);
const response = llmResult?.response ?? processMessage(...);
// If llmResult is truthy, processMessage is NEVER called
```

**Gap**: LLM can return booking-related responses without any business rule validation.

### 4. Decision Engine Runs Twice

**Problem**: Decision Engine runs in two places with potentially different inputs.

**Evidence**:
```typescript
// orchestrator.ts Line 183-190 (first call)
const earlyDecisionInput = buildEarlyDecisionInput(input, priorMode);
const earlyDecisionOutput = runDecisionEngine(earlyDecisionInput);

// orchestrator.ts Line 477-492 (inside processMessage)
const decisionInput: DecisionEngineInput = { ... };
const decisionOutput = runDecisionEngine(decisionInput);
```

**Gap**: The early Decision Engine uses estimated intent, while the later one uses detected intent. They can produce different strategies.

### 5. Strategy Can Override Handoff

**Problem**: Strategy's `shouldEscalate` can trigger handoff BEFORE business rules.

**Evidence**:
```typescript
// orchestrator.ts Lines 541-552 (inside routeByMode)
if (strategy?.shouldEscalate) {
  return withMode({
    reply: `明白，我幫你轉交同事跟進...`,
    // Handoff triggered by strategy
  });
}
```

This runs BEFORE business rules check (which is at Line 647).

---

## Current System Classification

### AUTHORITATIVE (Cannot be bypassed)

| System | Location | When Active | Can Override |
|--------|----------|-------------|--------------|
| Phase 1.5A FAQ | orchestrator.ts:129-138 | Entry point | All downstream |
| Phase 1.5C/D Service Detail | orchestrator.ts:140-162 | Entry point | All downstream |
| Phase 1.5D KB FAQ | orchestrator.ts:164-179 | Entry point | All downstream |
| Handoff Trigger (correction count) | orchestrator.ts:627-645 | CONFIRMATION_PENDING mode | Strategy, LLM |
| Business Rules | orchestrator.ts:647-666 | CONFIRMATION_PENDING mode | Strategy, LLM |

**Note**: Business rules and correction-based handoff are **ONLY** authoritative inside `CONFIRMATION_PENDING` mode.

### ADVISORY (Can be overridden)

| System | Location | What It Affects | Overridden By |
|--------|----------|-----------------|----------------|
| Decision Engine (early) | orchestrator.ts:183-190 | LLM context | All downstream |
| Decision Engine (inside processMessage) | orchestrator.ts:477-492 | routeByMode context | Business rules, Handoff |
| Strategy shouldEscalate | orchestrator.ts:541-552 | Handoff trigger | Nothing (advisory→authoritative) |
| LLM Pipeline | orchestrator.ts:193 | Response generation | Phase 1.5 rules |

---

## Decision Authority Questions

### Q1: Who decides `mode`?

**Answer**: `resolveNextMode()` function (conversation-mode.ts)

```typescript
// orchestrator.ts Line 465-476
const nextMode = resolveNextMode({
  currentMode: priorMode ?? 'INQUIRY',
  intent,
  message: msg,
  bookingDraft: draft,
  allSlotsPresent,
});
```

**Called from**: `processMessage()` only (not in LLM pipeline)

**Authority Level**: Advisory - Mode is computed but `HANDOFF` mode and business rules can override the flow.

### Q2: Who decides `stage`?

**Answer**: `detectStage()` function (conversation-stage.ts)

**Called from**: Decision Engine (both early and inside processMessage)

**Authority Level**: Advisory - Stage informs strategy but doesn't directly control flow.

### Q3: Who decides if booking can be submitted?

**Answer**: Currently **nobody at entry point**. Only enforced inside `CONFIRMATION_PENDING` mode.

```typescript
// Only runs in CONFIRMATION_PENDING mode:
if (mode === 'CONFIRMATION_PENDING') {
  const validation = validateBookingRules(draft, businessConfig);
  if (!validation.valid) { /* reject */ }
}
```

**Gap**: If LLM returns a `CREATE_BOOKING` side effect directly, business rules are bypassed.

### Q4: Who can override whom?

```
Phase 1.5 Rules (FAQ, Service Detail, KB FAQ)
    ↓ (cannot be overridden by anything)

LLM Pipeline
    ↓ (returns early, skips processMessage)

processMessage()
    ↓

Decision Engine (strategy)
    ↓ (can set shouldEscalate → handoff)

Mode-based routing
    ↓

[Inside CONFIRMATION_PENDING only:]
    Handoff Trigger → override strategy
    Business Rules → override everything
```

---

## Recommended Hierarchy (Not Yet Implemented)

```
Level 1: AUTHORITATIVE (must run first, cannot bypass)
├── Booking Safety Gate (all booking attempts)
├── Business Rules (operating hours, lead time)
├── Handoff Triggers (correction count, risk score)
└── Critical Safety Checks

Level 2: DETERMINISTIC (rule-based, bypass AI)
├── Phase 1.5A Hardcoded FAQ
├── Phase 1.5C/D Service Detail
└── Phase 1.5D KB FAQ

Level 3: ADVISORY (inform AI, don't mandate)
├── Decision Engine (signals, stage, strategy)
└── Mode Detection

Level 4: AI GENERATION (last resort)
├── LLM Pipeline
└── Rule-based Fallback
```

---

## Test Coverage Gaps

### Currently Tested:
- Unit tests for individual modules (verify*Regression)

### NOT Tested:
- End-to-end flow from `runAiEngine()` to response
- Business rules enforcement when LLM returns booking
- Handoff trigger when mode is not CONFIRMATION_PENDING
- Strategy override vs business rules interaction

---

## Next Steps

1. ✅ Document this hierarchy (this file)
2. ⏳ Add integration tests for:
   - Business rules override signals
   - Handoff override strategy
   - Booking safety cannot be bypassed
   - FAQ/Booking path verification
3. ⏳ Fix gaps by moving business rules to entry point