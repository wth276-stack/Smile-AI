# AI Top Sales - AI Sales Engine Architecture Spec

> Version: 0.1 | Date: 2026-03-19
> This is NOT a chatbot. This is a sales engine that happens to communicate via chat.

---

## 0. Core Philosophy

A human top sales person does 6 things in every conversation:

1. **Read the room** — detect intent, emotion, urgency, buying signals, objections
2. **Know the customer** — recall history, preferences, decision style, relationship context
3. **Choose a play** — decide the best strategy for this exact moment
4. **Execute the play** — say the right thing, in the right tone, at the right time
5. **Record everything** — update CRM, note follow-ups, log outcome
6. **Know when to escalate** — hand off to manager when deal is too big, too complex, or too sensitive

Our AI engine replicates this as a **15-layer pipeline**. Each layer has a single job. Layers compose. Layers can be swapped, upgraded, or disabled per phase / per tenant / per plan tier.

---

## 1. AI Engine — 15-Layer Pipeline Architecture

```
  INBOUND MESSAGE
        │
        ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L1  CONTEXT ASSEMBLER                                      │
  │      Gather everything the AI needs to make a decision      │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L2  KNOWLEDGE RETRIEVER (RAG)                              │
  │      Find relevant FAQ / product / pricing docs             │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L3  SIGNAL EXTRACTOR                            [LLM CALL] │
  │      Intent, sentiment, entities, buying signals, objections│
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L4  INTENT CLASSIFIER                              [CODE]  │
  │      Map extracted signals to canonical intent enum         │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L5  OBJECTION CLASSIFIER                           [CODE]  │
  │      Match objection signals against tenant's objection rules│
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L6  LEAD STATE ENGINE                              [CODE]  │
  │      FSM: evaluate state transition based on signals        │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L7  DECISION ENGINE                                [CODE]  │
  │      Choose strategy: FAQ? collect info? handle objection?  │
  │      push CTA? book? order? handoff? upsell?               │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L8  STRATEGY EXECUTOR                                      │
  │      Run the selected strategy (each is a focused module)   │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L9  RESPONSE GENERATOR                          [LLM CALL] │
  │      Generate natural language response for chosen strategy │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L10 TONE & PERSONA LAYER                           [CODE]  │
  │      Apply tenant tone profile + customer decision identity │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L11 CLOSING REINFORCEMENT LAYER                 [LLM CALL] │
  │      (Phase 3) Emotional closing, urgency, social proof     │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L12 UPSELL / CROSS-SELL LAYER                      [CODE]  │
  │      (Phase 3) Check upsell rules, inject upsell offer     │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L13 GUARDRAILS                                     [CODE]  │
  │      Validate: no hallucination, pricing accuracy,          │
  │      length, language, brand safety                         │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L14 HANDOFF EVALUATOR                              [CODE]  │
  │      Final check: should this go to a human instead?        │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  L15 SIDE EFFECT COLLECTOR                          [CODE]  │
  │      Collect all CRM updates, follow-ups, reminders,        │
  │      score changes, analytics events as structured data     │
  └──────────────────────────┬──────────────────────────────────┘
                             ▼
                       AiEngineResult
                    (response + side effects)
```

### Layer Details

---

#### L1: Context Assembler

**Job**: Build a complete, structured `AiContext` object from raw inputs. This is the ONLY layer that touches external data. All downstream layers receive pre-assembled data.

**How it works** (code, no LLM):

```typescript
function assembleContext(input: RawInput): AiContext {
  return {
    tenant: {
      businessName, businessDescription, language, timezone,
      businessHours, currency, aiTone, collectFields, plan,
    },
    contact: {
      id, name, phone, email, tags, customFields,
      status, totalOrders, totalSpent, firstContactAt,
    },
    conversation: {
      id, status, leadState, leadScore, summary,
      messageCount, activePlaybookId, activePlaybookStep,
      assignedUserId,  // null = AI handling
    },
    messages: [
      // Last N messages (sliding window)
      { direction, senderType, content, contentType, createdAt }
    ],
    currentMessage: {
      content, contentType, // the message we're responding to
    },
    channel: {
      type, // WHATSAPP | WEB_CHAT | ...
    },
    // Below are populated by L2 (Knowledge Retriever)
    knowledgeDocs: [],
    // Below are populated by L6+ (Phase 2+)
    activePlaybook: null,
    currentPlaybookStep: null,
    contactDecisionProfile: null,
    contactLeadScore: null,
  };
}
```

**Conversation window strategy**:

| Total messages | Strategy |
|---------------|----------|
| ≤ 20 | Include all messages |
| 21–50 | Include last 20 messages + AI-generated summary of older messages |
| > 50 | Include last 15 messages + summary. Summarize in batches of 30. |

Summary generation is a **separate background job** (not in the real-time pipeline). Updated every 10 messages or when conversation is closed.

---

#### L2: Knowledge Retriever (RAG)

**Job**: Find the most relevant knowledge documents for this conversation turn.

**Phase 1 — Keyword matching** (code, no LLM):

```typescript
function retrieveKnowledge(
  currentMessage: string,
  knowledgeDocs: KnowledgeDocument[],
  maxTokenBudget: number
): RetrievedDoc[] {
  // 1. Tokenize message into keywords (Chinese + English word segmentation)
  // 2. Score each active doc by keyword overlap (TF-IDF-like)
  // 3. Sort by score descending
  // 4. Pack docs into result until token budget is exhausted
  // 5. Return matched docs with relevance scores
}
```

**Phase 2 — Vector search** (code + pgvector, no LLM at retrieval time):

```typescript
function retrieveKnowledge(
  currentMessage: string,
  tenantId: string,
  maxTokenBudget: number
): RetrievedDoc[] {
  // 1. Generate embedding for currentMessage (OpenAI embedding API)
  // 2. Query pgvector: SELECT * FROM knowledge_documents
  //    WHERE tenant_id = $1 AND is_active = true
  //    ORDER BY embedding <=> $2 LIMIT 10
  // 3. Pack into result respecting token budget
}
```

**Phase 3 — Hybrid retrieval**:
- Vector search (semantic match)
- Keyword search (exact match for product names, codes, prices)
- Merge + deduplicate + rank

**Output**: `RetrievedDoc[]` — injected into `AiContext.knowledgeDocs`

---

#### L3: Signal Extractor

**Job**: Analyze the current message (in context of conversation) and extract structured signals. This is the AI's "eyes and ears".

**Execution**: Single LLM call with structured output (JSON mode).

**Prompt structure**:

```
System: You are a sales signal analyzer. Extract structured signals from
the customer message. Consider the conversation context.

Context:
- Business: {{businessName}} ({{businessDescription}})
- Conversation so far: {{recentMessages}}
- Customer profile: {{contactSummary}}

Current customer message: "{{currentMessage}}"

Extract the following as JSON:
{
  "intent": one of ["greeting", "inquiry", "booking_request", "order_request",
                     "complaint", "follow_up", "price_check", "negotiation",
                     "cancellation", "confirmation", "gratitude", "farewell",
                     "off_topic", "unknown"],
  "sentiment": one of ["very_positive", "positive", "neutral", "negative", "very_negative"],
  "urgency": one of ["low", "medium", "high", "immediate"],
  "topics": [array of discussed topics],
  "entities": {
    "personName": extracted name or null,
    "phone": extracted phone or null,
    "email": extracted email or null,
    "date": extracted date or null,
    "time": extracted time or null,
    "productOrService": mentioned product/service or null,
    "quantity": extracted quantity or null,
    "budget": mentioned budget/price range or null,
    "location": mentioned location or null
  },
  "buyingSignals": [array of buying signal phrases detected],       // Phase 2+
  "objectionSignals": [array of objection phrases detected],        // Phase 2+
  "customerEmotionalState": one of ["excited", "interested",        // Phase 3
    "neutral", "hesitant", "frustrated", "angry", "confused"],
  "decisionStyleIndicators": [evidence of decision style]           // Phase 3
}
```

**LLM model**: `gpt-4o-mini` (fast, cheap, good enough for extraction)

**Output type**:

```typescript
interface ExtractedSignals {
  // Phase 1 (always present)
  intent: IntentType;
  sentiment: SentimentLevel;
  urgency: UrgencyLevel;
  topics: string[];
  entities: ExtractedEntities;

  // Phase 2 (empty arrays in Phase 1)
  buyingSignals: string[];
  objectionSignals: string[];

  // Phase 3 (null in Phase 1-2)
  customerEmotionalState: EmotionalState | null;
  decisionStyleIndicators: string[];
}
```

---

#### L4: Intent Classifier

**Job**: Map the LLM's free-form intent string to a canonical `IntentType` enum and enrich with rule-based heuristics.

**Execution**: Pure code, no LLM.

```typescript
function classifyIntent(
  signals: ExtractedSignals,
  context: AiContext
): ClassifiedIntent {
  const llmIntent = signals.intent;

  // Rule-based overrides / enrichments:

  // 1. If conversation is HANDED_OFF → intent is HUMAN_ACTIVE (don't respond)
  if (context.conversation.assignedUserId) {
    return { type: 'HUMAN_ACTIVE', confidence: 1.0, source: 'rule' };
  }

  // 2. If entities contain date+time+service → upgrade to BOOKING_REQUEST
  if (signals.entities.date && signals.entities.time && signals.entities.productOrService) {
    return { type: 'BOOKING_REQUEST', confidence: 0.95, source: 'entity_combination' };
  }

  // 3. If message is very short greeting ("hi", "hello", "你好")
  //    and it's the first message → GREETING
  if (context.conversation.messageCount === 0 && isGreeting(signals)) {
    return { type: 'GREETING', confidence: 1.0, source: 'rule' };
  }

  // 4. If message matches any configured "off-hours" patterns
  //    and it's outside business hours → OFF_HOURS_INQUIRY

  // 5. Default: trust LLM classification
  return { type: llmIntent, confidence: 0.8, source: 'llm' };
}
```

**Why code, not LLM**: Intent classification is a routing decision. It must be deterministic, fast, and debuggable. The LLM's raw extraction feeds into code-based rules that make the final classification.

---

#### L5: Objection Classifier

**Job**: Detect if the customer is raising an objection, match it against tenant-configured objection rules, and determine the objection category + strategy.

**Execution**: Pure code, no LLM. (The objection text was already extracted by L3.)

```typescript
function classifyObjection(
  signals: ExtractedSignals,
  objectionRules: ObjectionRule[],  // tenant-configured
  context: AiContext
): ObjectionClassification | null {
  if (signals.objectionSignals.length === 0) return null;

  // 1. Iterate objection rules sorted by priority (highest first)
  for (const rule of objectionRules) {
    for (const pattern of rule.patterns) {
      if (matchesPattern(signals.objectionSignals, pattern)) {
        return {
          ruleId: rule.id,
          category: rule.category,        // PRICE | TIMING | TRUST | ...
          strategy: rule.strategy,        // REFRAME | SOCIAL_PROOF | ...
          responseTemplate: rule.responseTemplate,
          matchedSignal: pattern,
          confidence: 0.85,
        };
      }
    }
  }

  // 2. No rule matched but objection signals exist → generic objection
  return {
    ruleId: null,
    category: inferCategory(signals.objectionSignals),
    strategy: 'ACKNOWLEDGE',  // default safe strategy
    responseTemplate: null,   // LLM will generate response
    matchedSignal: signals.objectionSignals[0],
    confidence: 0.6,
  };
}
```

**Phase 1**: Skipped (returns null always). Objection signals exist in extraction but are not acted on.

**Phase 2**: Active. Matches against tenant-configured rules.

**Phase 3**: Enhanced with multi-turn tracking ("customer objected on price 3 times → escalate strategy from ACKNOWLEDGE to VALUE_STACK to FEEL_FELT_FOUND") + chained strategies.

---

#### L6: Lead State Engine

**Job**: Evaluate whether the conversation's lead state should transition based on current signals + conversation history.

**Execution**: Pure code. Finite state machine.

```
State Transition Diagram:

  NEW ──────────────► ENGAGED
  (first meaningful     (customer asked a real question,
   reply received)       or responded to AI)

  ENGAGED ──────────► QUALIFIED
  (contact info          (has name + phone/email,
   collected,             expressed specific need)
   need identified)

  QUALIFIED ─────────► PROPOSING
  (AI presented          (sent quote, booking offer,
   an offer)              or product recommendation)

  PROPOSING ─────────► NEGOTIATING           (Phase 2+)
  (customer pushes       (objection or
   back on offer)         counter-offer)

  NEGOTIATING ────────► CLOSING              (Phase 2+)
  (objection resolved,   (agreement in principle,
   positive signals)      asking about payment/logistics)

  CLOSING ────────────► WON
  (order/booking          (confirmed, paid, booked)
   confirmed)

  Any state ──────────► LOST
  (explicit rejection, no response for X days, cancellation)
```

```typescript
interface StateTransition {
  from: LeadState;
  to: LeadState;
  conditions: TransitionCondition[];
  // ALL conditions must be true for transition to fire
}

interface TransitionCondition {
  type: 'signal' | 'entity' | 'count' | 'time' | 'status';
  field: string;
  operator: 'eq' | 'in' | 'gte' | 'exists' | 'not_null';
  value: any;
}

// Example transition rules:
const defaultTransitions: StateTransition[] = [
  {
    from: 'NEW', to: 'ENGAGED',
    conditions: [
      { type: 'count', field: 'customerMessages', operator: 'gte', value: 1 },
      { type: 'signal', field: 'intent', operator: 'in',
        value: ['inquiry', 'booking_request', 'order_request', 'price_check'] },
    ]
  },
  {
    from: 'ENGAGED', to: 'QUALIFIED',
    conditions: [
      { type: 'entity', field: 'personName', operator: 'not_null', value: null },
      // AND at least phone or email
      { type: 'entity', field: 'phone_or_email', operator: 'exists', value: null },
    ]
  },
  {
    from: 'QUALIFIED', to: 'PROPOSING',
    conditions: [
      { type: 'signal', field: 'intent', operator: 'in',
        value: ['booking_request', 'order_request', 'price_check'] },
    ]
  },
  // ... more transitions
];
```

**Phase 1**: FSM exists but only does `NEW → ENGAGED`. Simple. No tenant-configurable rules.

**Phase 2**: Full FSM. Tenant can customize transition conditions. Transitions trigger side effects (notifications, playbook activation).

**Phase 3**: Adds `NEGOTIATING` state. Transition history is tracked for analytics ("average turns to reach QUALIFIED").

---

#### L7: Decision Engine

**Job**: Given everything above (intent, objection, lead state, context), choose the ONE strategy to execute this turn.

**Execution**: Pure code. Priority-ordered rule evaluation.

```typescript
function decide(
  intent: ClassifiedIntent,
  objection: ObjectionClassification | null,
  leadState: LeadState,
  context: AiContext,
  config: TenantSettings
): SelectedStrategy {

  // ── Priority 1: System overrides ──────────────────────────

  // 1a. Conversation is handed off → do nothing, human is handling
  if (context.conversation.status === 'HANDED_OFF') {
    return { strategy: 'NOOP', reason: 'Human agent is handling' };
  }

  // 1b. Outside business hours
  if (!isBusinessHours(config.businessHours, config.timezone)) {
    return {
      strategy: 'OFF_HOURS_AUTO_REPLY',
      reason: 'Outside business hours',
      params: { nextOpenTime: getNextOpenTime(config) },
    };
  }

  // ── Priority 2: Greeting (first message) ──────────────────

  if (intent.type === 'GREETING' && context.conversation.messageCount <= 1) {
    return { strategy: 'GREETING', reason: 'First interaction' };
  }

  // ── Priority 3: Customer providing requested info ─────────

  if (hasInfoWeAskedFor(context, intent)) {
    return {
      strategy: 'PROCESS_INFO',
      reason: 'Customer provided requested information',
      params: { collectedEntities: intent.entities },
    };
  }

  // ── Priority 4: Objection detected ────────────────────────
  //    (Phase 2+; skipped in Phase 1)

  if (objection && config.plan !== 'STARTER') {
    return {
      strategy: 'HANDLE_OBJECTION',
      reason: `Objection detected: ${objection.category}`,
      params: { objection },
    };
  }

  // ── Priority 5: Booking / Order request ───────────────────

  if (intent.type === 'BOOKING_REQUEST') {
    return {
      strategy: 'GUIDE_BOOKING',
      reason: 'Customer wants to book',
      params: { extractedEntities: intent.entities },
    };
  }

  if (intent.type === 'ORDER_REQUEST') {
    return {
      strategy: 'GUIDE_ORDER',
      reason: 'Customer wants to order',
      params: { extractedEntities: intent.entities },
    };
  }

  // ── Priority 6: FAQ / Knowledge match ─────────────────────

  if (context.knowledgeDocs.length > 0 &&
      ['inquiry', 'price_check'].includes(intent.type)) {
    return {
      strategy: 'FAQ_ANSWER',
      reason: 'Matched knowledge base',
      params: { docs: context.knowledgeDocs },
    };
  }

  // ── Priority 7: Buying signal → CTA push ──────────────────
  //    (Phase 2+)

  if (signals.buyingSignals.length > 0 && config.plan !== 'STARTER') {
    return {
      strategy: 'PUSH_CTA',
      reason: 'Buying signals detected',
      params: { signals: signals.buyingSignals },
    };
  }

  // ── Priority 8: Playbook step ─────────────────────────────
  //    (Phase 2+)

  if (context.activePlaybook && context.currentPlaybookStep) {
    return {
      strategy: 'EXECUTE_PLAYBOOK_STEP',
      reason: `Playbook: ${context.activePlaybook.name}, step ${context.currentPlaybookStep.stepOrder}`,
      params: { step: context.currentPlaybookStep },
    };
  }

  // ── Priority 9: Missing required info → collect ───────────

  const missingFields = getMissingCollectFields(config.collectFields, context.contact);
  if (missingFields.length > 0) {
    return {
      strategy: 'COLLECT_INFO',
      reason: `Missing: ${missingFields.join(', ')}`,
      params: { missingFields },
    };
  }

  // ── Priority 10: General conversation ─────────────────────

  return {
    strategy: 'GENERAL_CHAT',
    reason: 'Default conversational response',
  };
}
```

**Why pure code**: The decision engine is the "brain" that must be:
- **Deterministic** — same inputs always produce same strategy
- **Debuggable** — can log "decision: HANDLE_OBJECTION because objection.category=PRICE"
- **Testable** — unit test every decision path without calling LLM
- **Configurable** — tenant plan level controls which strategies are available
- **Fast** — no latency; runs in < 1ms

The LLM was already used in L3 to extract signals. From L4 to L7, everything is code.

---

#### L8: Strategy Executor

**Job**: Execute the selected strategy. Each strategy is a focused module that knows how to handle one type of situation.

**Strategy interface**:

```typescript
interface Strategy {
  name: string;
  execute(context: AiContext, params: StrategyParams): Promise<StrategyResult>;
}

interface StrategyResult {
  responseInstruction: string;   // Instruction for L9 (Response Generator)
  suggestedResponseText?: string; // Pre-built text (for template-based responses)
  sideEffects: SideEffect[];     // CRM updates, bookings, follow-ups to create
  metadata: Record<string, any>; // Strategy-specific data for analytics
}
```

**Strategies (by phase)**:

| Strategy | Phase | Description |
|----------|-------|-------------|
| `GreetingStrategy` | 1 | Send configured greeting, introduce business |
| `FaqAnswerStrategy` | 1 | Answer from knowledge base docs |
| `CollectInfoStrategy` | 1 | Naturally ask for missing contact fields |
| `GuideBookingStrategy` | 1 | Walk customer through booking (date, time, service) |
| `GuideOrderStrategy` | 1 | Walk customer through order (product, quantity, confirm) |
| `ProcessInfoStrategy` | 1 | Acknowledge received info, update contact, proceed |
| `OffHoursAutoReplyStrategy` | 1 | "We're closed, will reply tomorrow at X" |
| `GeneralChatStrategy` | 1 | Friendly catch-all with gentle info gathering |
| `HandleObjectionStrategy` | 2 | Apply objection rule's strategy + template |
| `PushCtaStrategy` | 2 | Push call-to-action (book now, order now, schedule call) |
| `ExecutePlaybookStepStrategy` | 2 | Execute current playbook step action |
| `InitiateHandoffStrategy` | 2 | Prepare context summary, transfer to human |
| `UpsellStrategy` | 3 | Present upsell/cross-sell offer |
| `TrustRepairStrategy` | 3 | Detect trust erosion, switch to empathy mode |
| `ClosingReinforcementStrategy` | 3 | Emotional close, urgency, scarcity, social proof |
| `ChallengerReframeStrategy` | 3 | Reframe customer's mental model (Challenger Sale method) |

**Example — CollectInfoStrategy**:

```typescript
class CollectInfoStrategy implements Strategy {
  name = 'COLLECT_INFO';

  async execute(context: AiContext, params: { missingFields: string[] }): Promise<StrategyResult> {
    const { missingFields } = params;
    const priority = this.prioritizeFields(missingFields);
    // Ask for the highest-priority missing field
    // Don't ask for all at once — one at a time, conversationally

    return {
      responseInstruction:
        `The customer hasn't provided their ${priority[0]} yet. ` +
        `Naturally work a request for their ${priority[0]} into your response. ` +
        `Don't make it feel like a form. Be conversational.`,
      sideEffects: [],
      metadata: { targetField: priority[0], totalMissing: missingFields.length },
    };
  }

  private prioritizeFields(fields: string[]): string[] {
    const order = ['name', 'phone', 'email', 'company'];
    return fields.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
}
```

**Example — HandleObjectionStrategy**:

```typescript
class HandleObjectionStrategy implements Strategy {
  name = 'HANDLE_OBJECTION';

  async execute(
    context: AiContext,
    params: { objection: ObjectionClassification }
  ): Promise<StrategyResult> {
    const { objection } = params;

    let responseInstruction: string;

    if (objection.responseTemplate) {
      // Tenant has a pre-configured response template
      responseInstruction =
        `Customer raised a ${objection.category} objection. ` +
        `Use the ${objection.strategy} strategy. ` +
        `Base your response on this template, but adapt it naturally: ` +
        `"${objection.responseTemplate}"`;
    } else {
      // No template — give LLM the strategy to follow
      responseInstruction =
        `Customer raised a ${objection.category} objection: "${objection.matchedSignal}". ` +
        `Handle it using the ${objection.strategy} strategy. ` +
        `${STRATEGY_GUIDANCE[objection.strategy]}`;
    }

    return {
      responseInstruction,
      sideEffects: [
        {
          type: 'LOG_OBJECTION_EVENT',
          data: {
            category: objection.category,
            strategy: objection.strategy,
            ruleId: objection.ruleId,
            detectedText: objection.matchedSignal,
          },
        },
      ],
      metadata: { objectionCategory: objection.category, strategy: objection.strategy },
    };
  }
}

const STRATEGY_GUIDANCE: Record<ObjectionStrategy, string> = {
  ACKNOWLEDGE:    'First acknowledge the concern is valid. Show empathy. Then gently redirect.',
  REFRAME:        'Reframe the concern from a different angle. Change the comparison or perspective.',
  SOCIAL_PROOF:   'Share that many customers had the same concern but were satisfied after trying.',
  SCARCITY:       'Gently mention limited availability or time-sensitive aspects.',
  EMPATHY:        'Show deep understanding. Share that you understand why they feel this way.',
  COMPARISON:     'Compare value vs alternatives. Highlight what makes this offering unique.',
  VALUE_STACK:    'Stack up all the value included. Make the total value feel much larger than the price.',
  FEEL_FELT_FOUND:'Use the Feel-Felt-Found framework: "I understand how you feel. Others have felt the same. What they found was..."',
};
```

---

#### L9: Response Generator

**Job**: Take the strategy instruction + full context and generate the actual message text.

**Execution**: LLM call. This is the main LLM call that produces the customer-facing message.

**Prompt assembly** (code composing prompt, then LLM generates response):

```typescript
function buildResponsePrompt(
  context: AiContext,
  strategyResult: StrategyResult,
  toneConfig: ToneConfig
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: buildSystemPrompt(context.tenant, toneConfig),
    },
    {
      role: 'user',
      content: [
        buildKnowledgeContext(context.knowledgeDocs),
        buildConversationHistory(context.messages),
        buildStrategyInstruction(strategyResult),
        buildFormatConstraints(context.channel.type),
      ].filter(Boolean).join('\n\n'),
    },
  ];
}
```

**System prompt structure** (composable, NOT monolithic):

```
You are {{roleName}}, a {{roleDescription}} for {{businessName}}.

{{businessDescription}}

## Your communication style
{{toneInstructions}}

## Rules you MUST follow
- Always respond in {{language}}
- Keep messages under {{maxLength}} characters
- Never reveal you are AI unless directly asked
- Never make up information not in the knowledge base
- Never discuss competitors by name
- If you don't know something, say you'll check and get back
{{#if businessHours}}
- Current business hours: {{businessHours}}
{{/if}}

## Customer context
- Name: {{contact.name || "unknown"}}
- Status: {{contact.status}}
- Previous orders: {{contact.totalOrders}}
{{#if leadState}}
- Lead stage: {{leadState}}
{{/if}}
```

**Strategy instruction** is injected separately:

```
## What you should do in this response
{{strategyResult.responseInstruction}}

{{#if strategyResult.suggestedResponseText}}
## Reference template (adapt naturally, don't copy verbatim)
{{strategyResult.suggestedResponseText}}
{{/if}}
```

**Format constraints** (channel-specific):

```
## Format rules
{{#if channel === 'WHATSAPP'}}
- Use short paragraphs (2-3 sentences max)
- Use emoji sparingly (1-2 per message)
- Don't use markdown formatting (WhatsApp has its own)
{{/if}}
{{#if channel === 'WEB_CHAT'}}
- Keep messages concise (under 200 characters if possible)
- Can use basic markdown
{{/if}}
```

---

#### L10: Tone & Persona Layer

**Job**: Validate and adjust the generated response to match the tenant's configured tone and, in Phase 3, the customer's decision identity.

**Phase 1** (code, no LLM):
- Tone is already embedded in the system prompt (L9), so this layer just validates:
  - Response language matches `config.language`
  - No informal language if tone is `PROFESSIONAL`
  - No overly formal language if tone is `CASUAL`
- Light regex/keyword checks, not a full LLM re-evaluation.

**Phase 3** (code + optional LLM micro-call):
- If customer's `DecisionIdentityProfile` exists, adjust:

```typescript
const PERSONA_ADJUSTMENTS: Record<DecisionType, ToneAdjustment> = {
  ANALYTICAL: {
    instruction: 'Include specific numbers, comparisons, or data points. Be structured.',
    avoid: 'vague claims, emotional appeals',
    messageStyle: 'logical, detail-oriented, fact-heavy',
  },
  DRIVER: {
    instruction: 'Be direct. Lead with the result/outcome. Skip unnecessary details.',
    avoid: 'long explanations, excessive pleasantries',
    messageStyle: 'concise, action-oriented, result-focused',
  },
  EXPRESSIVE: {
    instruction: 'Be enthusiastic. Use vivid language. Share stories/examples.',
    avoid: 'dry facts, bullet points, cold tone',
    messageStyle: 'warm, story-driven, emotionally resonant',
  },
  AMIABLE: {
    instruction: 'Be warm and reassuring. Emphasize support and low risk.',
    avoid: 'pressure tactics, urgency, aggressive CTAs',
    messageStyle: 'gentle, supportive, trust-building',
  },
};
```

---

#### L11: Closing Reinforcement Layer (Phase 3)

**Job**: When the lead is in `CLOSING` or `NEGOTIATING` state, inject closing techniques into the response.

**Execution**: Code decides whether to activate. If yes, adds closing instructions to the response (may trigger a micro LLM call to refine).

```typescript
function shouldReinforceClose(leadState: LeadState, signals: ExtractedSignals): boolean {
  return (
    ['CLOSING', 'NEGOTIATING'].includes(leadState) &&
    signals.sentiment !== 'very_negative' &&
    signals.buyingSignals.length > 0
  );
}

const CLOSING_TECHNIQUES = {
  ASSUMPTIVE:     'Speak as if the decision is already made. "When would you like to start?"',
  SCARCITY:       'Mention limited availability or time-sensitive offer.',
  SOCIAL_PROOF:   'Share that many similar customers chose this option.',
  SUMMARY:        'Summarize all agreed points and value, then ask for confirmation.',
  EMOTIONAL:      'Connect to their deeper motivation. Why did they start looking?',
  ALTERNATIVE:    'Present two options (both are positive outcomes) instead of yes/no.',
};

function selectClosingTechnique(
  profile: DecisionIdentityProfile | null,
  objectionHistory: ObjectionEvent[]
): string {
  if (profile?.primaryType === 'ANALYTICAL') return 'SUMMARY';
  if (profile?.primaryType === 'DRIVER') return 'ASSUMPTIVE';
  if (profile?.primaryType === 'EXPRESSIVE') return 'EMOTIONAL';
  if (profile?.primaryType === 'AMIABLE') return 'SOCIAL_PROOF';
  if (objectionHistory.some(o => o.category === 'PRICE')) return 'SUMMARY';
  return 'ALTERNATIVE'; // safe default
}
```

---

#### L12: Upsell / Cross-sell Layer (Phase 3)

**Job**: Check if upsell rules fire for the current context. If yes, inject an upsell offer.

**Execution**: Pure code. Rule evaluation.

```typescript
function evaluateUpsellRules(
  rules: UpsellRule[],
  context: AiContext,
  signals: ExtractedSignals
): UpsellOffer | null {
  // Only fire in positive-sentiment, closing or post-order contexts
  if (['very_negative', 'negative'].includes(signals.sentiment)) return null;
  if (!['PROPOSING', 'CLOSING', 'WON'].includes(context.conversation.leadState)) return null;

  for (const rule of rules.filter(r => r.isActive).sort((a, b) => b.priority - a.priority)) {
    if (evaluateConditions(rule.triggerConditions, context, signals)) {
      return {
        ruleId: rule.id,
        type: rule.type,          // UPSELL | CROSS_SELL | QUANTITY | BUNDLE
        offerText: interpolateTemplate(rule.offerTemplate, context),
        discountType: rule.discountType,
        discountValue: rule.discountValue,
      };
    }
  }
  return null;
}
```

The upsell offer is appended to the response as a soft suggestion, never overriding the primary strategy.

---

#### L13: Guardrails

**Job**: Validate the final response before it leaves the engine. Catch hallucinations, policy violations, and quality issues.

**Execution**: Pure code. No LLM. Fast.

```typescript
interface GuardrailCheck {
  name: string;
  check(response: string, context: AiContext): GuardrailResult;
}

interface GuardrailResult {
  passed: boolean;
  violation?: string;
  suggestion?: string;
}

const GUARDRAILS: GuardrailCheck[] = [
  {
    name: 'MAX_LENGTH',
    check: (response, ctx) => ({
      passed: response.length <= ctx.tenant.maxResponseLength,
      violation: response.length > ctx.tenant.maxResponseLength
        ? `Response too long: ${response.length} > ${ctx.tenant.maxResponseLength}` : undefined,
    }),
  },
  {
    name: 'LANGUAGE_CONSISTENCY',
    check: (response, ctx) => ({
      passed: detectLanguage(response) === ctx.tenant.language,
      violation: 'Response language does not match tenant language',
    }),
  },
  {
    name: 'PRICING_ACCURACY',
    check: (response, ctx) => {
      // Extract any prices mentioned in response
      const mentionedPrices = extractPrices(response);
      // Cross-reference with knowledge base
      for (const price of mentionedPrices) {
        if (!isPriceInKnowledgeBase(price, ctx.knowledgeDocs)) {
          return { passed: false, violation: `Price ${price} not found in knowledge base` };
        }
      }
      return { passed: true };
    },
  },
  {
    name: 'NO_COMPETITOR_MENTION',
    check: (response, ctx) => ({
      passed: !containsCompetitorNames(response, ctx.tenant.competitors),
    }),
  },
  {
    name: 'NO_SENSITIVE_DISCLOSURE',
    check: (response, _ctx) => ({
      passed: !containsSensitivePatterns(response),
      // Checks for: internal pricing formulas, cost margins, employee names,
      // system prompts, etc.
    }),
  },
  {
    name: 'NO_EMPTY_RESPONSE',
    check: (response, _ctx) => ({
      passed: response.trim().length > 0,
    }),
  },
];

function runGuardrails(response: string, context: AiContext): {
  passed: boolean;
  violations: string[];
  finalResponse: string;
} {
  const violations: string[] = [];
  let finalResponse = response;

  for (const guard of GUARDRAILS) {
    const result = guard.check(finalResponse, context);
    if (!result.passed) {
      violations.push(`[${guard.name}] ${result.violation}`);
      if (result.suggestion) {
        finalResponse = result.suggestion; // auto-fix if possible
      }
    }
  }

  // If critical violation → replace with safe fallback
  if (violations.length > 0 && hasCriticalViolation(violations)) {
    finalResponse = context.tenant.safeFallbackMessage
      || '多謝你嘅查詢！我哋會盡快回覆你。';
  }

  return { passed: violations.length === 0, violations, finalResponse };
}
```

---

#### L14: Handoff Evaluator

**Job**: Final check — should this conversation be transferred to a human?

**Execution**: Pure code. Rule-based.

```typescript
interface HandoffDecision {
  shouldHandoff: boolean;
  reason: HandoffReason | null;
  urgency: 'normal' | 'urgent';
  suggestedMessage: string | null;
}

function evaluateHandoff(
  context: AiContext,
  signals: ExtractedSignals,
  strategyResult: StrategyResult,
  guardrailResult: GuardrailResult,
  config: TenantSettings
): HandoffDecision {
  if (!config.autoHandoffEnabled) {
    return { shouldHandoff: false, reason: null, urgency: 'normal', suggestedMessage: null };
  }

  // Rule 1: Customer explicitly asks for human
  const humanRequestPhrases = ['想同真人傾', 'speak to a person', 'real person',
    '轉人工', 'human agent', '找人', '客服'];
  if (humanRequestPhrases.some(p => context.currentMessage.content.toLowerCase().includes(p))) {
    return {
      shouldHandoff: true,
      reason: 'CUSTOMER_REQUEST',
      urgency: 'urgent',
      suggestedMessage: config.handoffMessage || '好的，我幫你轉接真人客服，請稍等！',
    };
  }

  // Rule 2: AI confidence too low (Phase 2+)
  if (signals.intent === 'unknown' && context.conversation.messageCount > 3) {
    return {
      shouldHandoff: true,
      reason: 'AI_LOW_CONFIDENCE',
      urgency: 'normal',
      suggestedMessage: '呢個問題我需要同事幫你跟進，我幫你轉接，請稍等！',
    };
  }

  // Rule 3: Guardrails failed critically
  if (!guardrailResult.passed && hasCriticalViolation(guardrailResult.violations)) {
    return {
      shouldHandoff: true,
      reason: 'GUARDRAIL_FAILURE',
      urgency: 'urgent',
      suggestedMessage: null,
    };
  }

  // Rule 4: Customer sentiment is very negative for 3+ consecutive messages
  if (signals.sentiment === 'very_negative' &&
      getConsecutiveNegativeCount(context.messages) >= 3) {
    return {
      shouldHandoff: true,
      reason: 'ESCALATION',
      urgency: 'urgent',
      suggestedMessage: '我理解你嘅唔滿意，我幫你轉接主管跟進！',
    };
  }

  // Rule 5: Repeated objection on same topic (Phase 2+)
  // Rule 6: Sensitive topics (legal, medical, financial) (Phase 2+)
  // Rule 7: High-value deal above threshold (Phase 3)

  return { shouldHandoff: false, reason: null, urgency: 'normal', suggestedMessage: null };
}
```

---

#### L15: Side Effect Collector

**Job**: Aggregate all side effects from the entire pipeline into a single, structured output. The worker (caller) will execute them.

**Execution**: Pure code. Data assembly.

```typescript
type SideEffect =
  | { type: 'UPDATE_CONTACT'; data: Partial<Contact> }
  | { type: 'UPDATE_CONVERSATION'; data: Partial<Conversation> }
  | { type: 'UPDATE_LEAD_STATE'; data: { from: LeadState; to: LeadState } }
  | { type: 'UPDATE_LEAD_SCORE'; data: { delta: number; reason: string } }
  | { type: 'CREATE_ORDER'; data: { items: OrderItemInput[]; notes?: string } }
  | { type: 'CREATE_BOOKING'; data: { startAt: string; serviceName?: string; notes?: string } }
  | { type: 'CREATE_FOLLOW_UP'; data: { type: FollowUpType; reason: string; dueAt: string } }
  | { type: 'CREATE_REMINDER'; data: { message: string; scheduledAt: string } }
  | { type: 'LOG_OBJECTION_EVENT'; data: ObjectionEventInput }
  | { type: 'TRIGGER_HANDOFF'; data: HandoffInput }
  | { type: 'ACTIVATE_PLAYBOOK'; data: { playbookId: string } }
  | { type: 'ADVANCE_PLAYBOOK'; data: { nextStep: number } }
  | { type: 'LOG_UPSELL_ATTEMPT'; data: { ruleId: string; accepted: boolean } };

function collectSideEffects(
  signals: ExtractedSignals,
  strategyResult: StrategyResult,
  leadStateChange: StateTransitionResult | null,
  handoffDecision: HandoffDecision,
  upsellOffer: UpsellOffer | null
): SideEffect[] {
  const effects: SideEffect[] = [];

  // 1. Contact updates from extracted entities
  const contactUpdates = buildContactUpdates(signals.entities);
  if (Object.keys(contactUpdates).length > 0) {
    effects.push({ type: 'UPDATE_CONTACT', data: contactUpdates });
  }

  // 2. Strategy-produced side effects
  effects.push(...strategyResult.sideEffects);

  // 3. Lead state transition
  if (leadStateChange) {
    effects.push({ type: 'UPDATE_LEAD_STATE', data: leadStateChange });
  }

  // 4. Handoff
  if (handoffDecision.shouldHandoff) {
    effects.push({ type: 'TRIGGER_HANDOFF', data: {
      reason: handoffDecision.reason,
      urgency: handoffDecision.urgency,
    }});
  }

  // 5. Upsell attempt log
  if (upsellOffer) {
    effects.push({ type: 'LOG_UPSELL_ATTEMPT', data: {
      ruleId: upsellOffer.ruleId, accepted: false, // tracked on next turn
    }});
  }

  // 6. Conversation summary update (every 5 messages)
  if (shouldUpdateSummary(context)) {
    effects.push({ type: 'UPDATE_CONVERSATION', data: { summary: 'RECALCULATE' } });
  }

  return effects;
}
```

---

## 2. Code vs LLM vs RAG — Responsibility Matrix

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  ┌─── LLM CALLS (2-3 per turn) ───────────────────────────────────┐     │
│  │                                                                 │     │
│  │  L3  Signal Extraction                                          │     │
│  │      → Structured JSON output                                   │     │
│  │      → Extract: intent, sentiment, entities, objection signals  │     │
│  │                                                                 │     │
│  │  L9  Response Generation                                        │     │
│  │      → Natural language response                                │     │
│  │      → Uses: strategy instruction + context + tone config       │     │
│  │                                                                 │     │
│  │  L11 Closing Reinforcement (Phase 3, optional)                  │     │
│  │      → Refine closing message with emotional technique          │     │
│  │                                                                 │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌─── CODE (DETERMINISTIC, NO LLM) ───────────────────────────────┐     │
│  │                                                                 │     │
│  │  L1  Context Assembly         gather data, build struct         │     │
│  │  L4  Intent Classification    enum mapping + rule overrides     │     │
│  │  L5  Objection Classification pattern matching against rules    │     │
│  │  L6  Lead State Engine        FSM transitions                   │     │
│  │  L7  Decision Engine          priority-based strategy selection  │     │
│  │  L8  Strategy Executor        strategy-specific logic + params  │     │
│  │  L10 Tone Adjustment          keyword validation, persona map   │     │
│  │  L12 Upsell Evaluation        rule condition matching           │     │
│  │  L13 Guardrails               regex, price check, length check  │     │
│  │  L14 Handoff Evaluator        threshold + pattern checks        │     │
│  │  L15 Side Effect Collector    aggregate typed side effects      │     │
│  │                                                                 │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌─── RAG (RETRIEVAL, NO GENERATION) ─────────────────────────────┐     │
│  │                                                                 │     │
│  │  L2  Knowledge Retriever                                        │     │
│  │      Phase 1: keyword matching (code)                           │     │
│  │      Phase 2: vector similarity search (pgvector)               │     │
│  │      Phase 3: hybrid keyword + vector + reranking               │     │
│  │                                                                 │     │
│  │  Output is injected into L9's prompt as context                 │     │
│  │  RAG retrieves; LLM generates from retrieved context            │     │
│  │                                                                 │     │
│  └─────────────────────────────────────────────────────────────────┘     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why This Split?

| Concern | LLM? | Why |
|---------|------|-----|
| Understanding human language nuance | Yes | LLM excels at NLU — intent, sentiment, entity extraction from messy customer messages |
| Generating natural conversation | Yes | LLM generates fluent, contextual responses humans can't tell from a person |
| Choosing what to do | **No** | Routing decisions must be deterministic, auditable, testable. "Why did AI do X?" must have a clear log trail. |
| Pattern matching objections | **No** | Keyword/regex matching against configured rules is faster, cheaper, and more controllable than asking LLM "is this an objection?" |
| Lead state transitions | **No** | FSM must be deterministic. "Customer is now QUALIFIED because they provided name + phone + specific need" — not an LLM judgment call. |
| Pricing validation | **No** | Price accuracy is a hard constraint. Code cross-checks against knowledge base. No hallucination allowed. |
| Handoff decision | **No** | Business-critical routing. Must be rule-based with clear thresholds. |
| Knowledge retrieval | No (search) | Vector/keyword search finds docs. LLM doesn't do retrieval — it reads the retrieved docs. |

### LLM Call Budget Per Turn

| Phase | LLM Calls | Total Latency Target | Cost Target |
|-------|-----------|---------------------|-------------|
| Phase 1 | 1 (combined extraction + response) | < 3s | < $0.005 per turn |
| Phase 2 | 2 (extraction + response) | < 4s | < $0.008 per turn |
| Phase 3 | 2-3 (extraction + response + optional closing) | < 5s | < $0.015 per turn |

**Phase 1 optimization**: Combine signal extraction and response generation into a single LLM call. The prompt asks the LLM to output both structured signals AND the response text in one call. This halves latency and cost.

```typescript
// Phase 1: Single combined call
const combinedPrompt = `
${systemPrompt}
${contextBlock}

Analyze the customer message and respond. Output EXACTLY this JSON format:
{
  "signals": { intent, sentiment, urgency, entities, topics },
  "response": "your response to the customer here"
}
`;

// Phase 2+: Split into two calls for better quality
// Call 1: Signal extraction (structured output, gpt-4o-mini)
// Call 2: Response generation (free text, gpt-4o-mini or gpt-4o for complex objections)
```

---

## 3. Configurable Design — Multi-Tenant Configuration Matrix

Everything below is per-tenant, stored in the database, and loaded at runtime. **Zero code changes** to customize for a new industry or customer.

### 3.1 Configuration Categories

```
┌─────────────────────────────────────────────────────────────────┐
│                    TENANT CONFIGURATION                         │
│                                                                 │
│  ┌─── Identity & Tone ──────────────────────────────────────┐   │
│  │  businessName          "美麗髮廊"                         │   │
│  │  businessDescription   "位於旺角的專業髮型屋..."           │   │
│  │  aiTone                FRIENDLY | PROFESSIONAL | CASUAL    │   │
│  │  language              "zh-HK"                             │   │
│  │  aiGreeting            "你好！歡迎嚟到美麗髮廊..."         │   │
│  │  aiFarewell            "多謝你嘅查詢！期待見到你！"         │   │
│  │  roleName              "小美" (AI's name)                  │   │
│  │  roleDescription       "美麗髮廊的專業顧問"               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Knowledge Base ───────────────────────────────────────┐   │
│  │  FAQ documents         "剪髮價錢？"→"男士 $180, 女士 $280"│   │
│  │  Product catalog       Services, prices, descriptions      │   │
│  │  Policies              Cancellation policy, refund policy  │   │
│  │  Business info         Address, parking, opening hours     │   │
│  │  ─── Stored as KnowledgeDocument rows, CRUD via API ───   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Collection Rules ─────────────────────────────────────┐   │
│  │  collectFields         ["name", "phone"]                   │   │
│  │  requiredForBooking    ["name", "phone", "date", "time"]   │   │
│  │  requiredForOrder      ["name", "phone"]                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Business Rules ───────────────────────────────────────┐   │
│  │  businessHours         { mon: "09:00-18:00", ... }        │   │
│  │  timezone              "Asia/Hong_Kong"                    │   │
│  │  currency              "HKD"                               │   │
│  │  bookingSlotDuration   60 (minutes)                        │   │
│  │  bookingLeadTime       24 (hours in advance)               │   │
│  │  maxBookingsPerDay     20                                  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── AI Behavior ──────────────────────────────────────────┐   │
│  │  aiModel               "gpt-4o-mini"                       │   │
│  │  aiTemperature         0.7                                 │   │
│  │  maxAiTokensPerTurn    1000                                │   │
│  │  maxResponseLength     500 (chars)                         │   │
│  │  conversationWindowSize 20 (messages in context)           │   │
│  │  enableSmallTalk       true                                │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Handoff Rules ────────────────────────────────────────┐   │
│  │  autoHandoffEnabled    true                                │   │
│  │  handoffMessage        "我幫你轉接真人客服..."             │   │
│  │  handoffThreshold      0.3 (AI confidence below this)      │   │
│  │  maxConsecutiveNeg     3 (negative messages before handoff)│   │
│  │  handoffKeywords       ["真人", "客服", "manager"]         │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Objection Rules (Phase 2+) ───────────────────────────┐   │
│  │  ObjectionRule[]       Per-tenant list of objection rules  │   │
│  │  Each rule has:        patterns, category, strategy,       │   │
│  │                        responseTemplate, priority          │   │
│  │  ─── Stored as ObjectionRule rows, CRUD via API ────────  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Sales Playbooks (Phase 2+) ───────────────────────────┐   │
│  │  SalesPlaybook[]       Per-tenant multi-step sales flows   │   │
│  │  Each playbook has:    triggerConditions, ordered steps,    │   │
│  │                        actions per step                    │   │
│  │  ─── Stored as SalesPlaybook + PlaybookStep rows ────────  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Lead Scoring Rules (Phase 2+) ────────────────────────┐   │
│  │  ScoringRule[]         Per-tenant scoring dimensions        │   │
│  │  Each rule:            dimension, condition, scoreImpact    │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Lead State Transitions (Phase 2+) ────────────────────┐   │
│  │  StateTransition[]     Per-tenant FSM rules                │   │
│  │  Each transition:      from, to, conditions[]              │   │
│  │  Default rules used if tenant doesn't customize            │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Upsell Rules (Phase 3) ───────────────────────────────┐   │
│  │  UpsellRule[]          Per-tenant upsell/cross-sell rules  │   │
│  │  Each rule:            triggerConditions, offerTemplate,    │   │
│  │                        type (upsell/cross-sell/bundle)     │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Decision Identity Mapping (Phase 3) ──────────────────┐   │
│  │  Per tenant: which closing technique to use for each type  │   │
│  │  Custom tone adjustments per decision type                 │   │
│  │  Stored as JSON config in TenantSettings                   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─── Channel Rules ────────────────────────────────────────┐   │
│  │  Per channel:          response format constraints         │   │
│  │                        max message length                  │   │
│  │                        emoji policy                        │   │
│  │                        media support (image, audio)        │   │
│  │  Stored as JSON in Channel.config                          │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Configuration Loading Strategy

```typescript
// Loaded ONCE per message processing (cached in Redis, TTL 5 min)
interface TenantAiConfig {
  settings: TenantSettings;           // from TenantSettings table
  knowledgeDocs: KnowledgeDocument[];  // active docs
  objectionRules: ObjectionRule[];     // active rules, sorted by priority
  upsellRules: UpsellRule[];           // active rules (Phase 3)
  scoringRules: ScoringRule[];         // active rules (Phase 2)
  playbooks: SalesPlaybook[];          // active playbooks with steps (Phase 2)
  stateTransitions: StateTransition[]; // custom or default (Phase 2)
}

// Redis cache key: `tenant:ai-config:${tenantId}`
// Invalidated on: settings update, knowledge doc CRUD, rule CRUD
```

---

## 4. Runtime Input Contract

The AI engine function signature and complete input contract:

```typescript
/**
 * Main entry point for the AI engine.
 * Called by the worker for every inbound message.
 *
 * ZERO database dependency — all data is passed in.
 * Returns structured output — caller executes side effects.
 */
async function processMessage(input: AiEngineInput): Promise<AiEngineResult>;
```

### `AiEngineInput`

```typescript
interface AiEngineInput {
  // ── Tenant Configuration ──
  tenant: {
    id: string;
    plan: 'STARTER' | 'GROWTH' | 'ELITE';
    businessName: string;
    businessDescription: string;
    language: string;                   // "zh-HK"
    timezone: string;                   // "Asia/Hong_Kong"
    currency: string;                   // "HKD"
    businessHours: Record<string, string>;  // { mon: "09:00-18:00", ... }
    aiTone: 'FRIENDLY' | 'PROFESSIONAL' | 'CASUAL' | 'LUXURY';
    aiGreeting: string;
    aiFarewell: string;
    roleName: string;                   // "小美"
    roleDescription: string;            // "美麗髮廊的專業顧問"
    aiModel: string;                    // "gpt-4o-mini"
    aiTemperature: number;              // 0.7
    maxAiTokensPerTurn: number;
    maxResponseLength: number;
    conversationWindowSize: number;     // 20
    collectFields: string[];            // ["name", "phone", "email"]
    requiredForBooking: string[];       // ["name", "phone", "date", "time"]
    requiredForOrder: string[];         // ["name", "phone"]
    enableSmallTalk: boolean;
  };

  // ── Handoff Configuration ──
  handoff: {
    enabled: boolean;
    message: string;
    confidenceThreshold: number;        // 0.3
    maxConsecutiveNegative: number;      // 3
    keywords: string[];                 // ["真人", "客服"]
  };

  // ── Contact Profile ──
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    company: string | null;
    tags: string[];
    customFields: Record<string, any>;
    status: ContactStatus;
    firstContactAt: string;
    lastContactAt: string;
    totalConversations: number;
    totalOrders: number;
    totalSpent: number | null;
  };

  // ── Conversation State ──
  conversation: {
    id: string;
    status: ConversationStatus;
    leadState: LeadState;
    leadScore: number | null;
    summary: string | null;
    messageCount: number;
    assignedUserId: string | null;
    activePlaybookId: string | null;
    activePlaybookStep: number | null;
    closedAt: string | null;
  };

  // ── Message History (sliding window, oldest first) ──
  messages: Array<{
    direction: 'INBOUND' | 'OUTBOUND';
    senderType: 'CUSTOMER' | 'AI' | 'HUMAN_AGENT' | 'SYSTEM';
    content: string;
    contentType: 'TEXT' | 'IMAGE' | 'AUDIO';
    createdAt: string;
  }>;

  // ── Current Inbound Message ──
  currentMessage: {
    id: string;
    content: string;
    contentType: 'TEXT' | 'IMAGE' | 'AUDIO';
    createdAt: string;
  };

  // ── Channel Info ──
  channel: {
    type: 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'WEB_CHAT';
    maxMessageLength: number;
    supportsMedia: boolean;
    supportsEmoji: boolean;
  };

  // ── Knowledge Base (pre-retrieved or passed for L2 to search) ──
  knowledgeDocs: Array<{
    id: string;
    title: string;
    content: string;
    category: string | null;
    tokenCount: number;
  }>;

  // ── Objection Rules (Phase 2+, empty in Phase 1) ──
  objectionRules: Array<{
    id: string;
    patterns: string[];
    category: ObjectionCategory;
    strategy: ObjectionStrategy;
    responseTemplate: string;
    priority: number;
  }>;

  // ── Active Playbook (Phase 2+, null in Phase 1) ──
  activePlaybook: {
    id: string;
    name: string;
    currentStep: {
      stepOrder: number;
      action: PlaybookAction;
      config: Record<string, any>;
    };
  } | null;

  // ── Upsell Rules (Phase 3, empty in Phase 1-2) ──
  upsellRules: Array<{
    id: string;
    type: UpsellType;
    triggerConditions: Record<string, any>;
    offerTemplate: string;
    priority: number;
  }>;

  // ── Decision Profile (Phase 3, null in Phase 1-2) ──
  decisionProfile: {
    primaryType: DecisionType;
    confidence: number;
    preferredTone: string | null;
    preferredPace: string | null;
  } | null;

  // ── Lead Score Details (Phase 2+, null in Phase 1) ──
  leadScoreDetails: {
    overallScore: number;
    engagementScore: number;
    intentScore: number;
    fitScore: number;
    recencyScore: number;
  } | null;

  // ── Objection History (Phase 2+, empty in Phase 1) ──
  recentObjectionEvents: Array<{
    category: ObjectionCategory;
    strategy: ObjectionStrategy;
    outcome: ObjectionOutcome;
    turnsAgo: number;
  }>;

  // ── Scoring Rules (Phase 2+, empty in Phase 1) ──
  scoringRules: Array<{
    id: string;
    dimension: string;
    condition: Record<string, any>;
    scoreImpact: number;
  }>;
}
```

---

## 5. Output Contract

```typescript
interface AiEngineResult {
  // ── Primary Response ──
  responseText: string;                 // The message to send to the customer
  responseMetadata: {
    strategy: string;                   // Which strategy produced this response
    isHandoff: boolean;                 // Whether this is a handoff message
    isFallback: boolean;               // Whether guardrails triggered fallback
  };

  // ── Extracted Signals ──
  signals: {
    intent: IntentType;
    sentiment: SentimentLevel;
    urgency: UrgencyLevel;
    topics: string[];
    entities: ExtractedEntities;
    buyingSignals: string[];            // Phase 2+
    objectionSignals: string[];         // Phase 2+
    customerEmotionalState: string | null;  // Phase 3
    decisionStyleIndicators: string[];  // Phase 3
  };

  // ── Objection Detection ──
  objection: {
    detected: boolean;
    category: ObjectionCategory | null;
    strategy: ObjectionStrategy | null;
    ruleId: string | null;
    matchedText: string | null;
  };

  // ── Lead State ──
  leadStateUpdate: {
    changed: boolean;
    previousState: LeadState;
    newState: LeadState;
    reason: string;                     // "Provided name + phone + specific inquiry"
  };

  // ── Decision Engine Trace ──
  decisionTrace: {
    evaluatedRules: string[];           // Which rules were checked
    selectedStrategy: string;           // Which strategy was selected
    reason: string;                     // Why this strategy was chosen
    confidence: number;                 // 0-1, how confident the engine is
  };

  // ── Recommended Next Actions ──
  nextActions: Array<{
    type: 'COLLECT_FIELD' | 'SEND_OFFER' | 'SCHEDULE_FOLLOWUP' |
          'SEND_REMINDER' | 'HANDOFF' | 'CLOSE' | 'UPSELL' | 'NONE';
    description: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    data?: Record<string, any>;
  }>;

  // ── Follow-Up Recommendation ──
  followUp: {
    recommended: boolean;
    type: FollowUpType | null;          // CALL | MESSAGE | EMAIL
    reason: string | null;              // "Customer interested but undecided"
    suggestedDueAt: string | null;      // ISO datetime
  } | null;

  // ── Handoff Decision ──
  handoff: {
    shouldHandoff: boolean;
    reason: HandoffReason | null;
    urgency: 'normal' | 'urgent';
    aiSummary: string | null;           // Context summary for human agent
    suggestedMessage: string | null;    // Message to show customer during handoff
  };

  // ── CRM Update Payload ──
  crmUpdates: {
    contact: Partial<{
      name: string;
      phone: string;
      email: string;
      company: string;
      tags: string[];
      customFields: Record<string, any>;
      status: ContactStatus;
      lastContactAt: string;
    }> | null;

    conversation: Partial<{
      status: ConversationStatus;
      leadState: LeadState;
      leadScore: number;
      summary: string;
      lastMessageAt: string;
      activePlaybookId: string | null;
      activePlaybookStep: number | null;
    }> | null;

    newOrder: {
      items: Array<{ name: string; quantity: number; unitPrice?: number }>;
      notes?: string;
    } | null;

    newBooking: {
      title: string;
      serviceName?: string;
      startAt: string;
      duration?: number;
      notes?: string;
    } | null;

    newFollowUp: {
      type: FollowUpType;
      reason: string;
      dueAt: string;
      priority: FollowUpPriority;
    } | null;
  };

  // ── Upsell Attempt (Phase 3) ──
  upsell: {
    attempted: boolean;
    ruleId: string | null;
    type: UpsellType | null;
    offerText: string | null;
  };

  // ── AI Run Metadata (for logging) ──
  aiRunLog: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    llmLatencyMs: number;
    totalPipelineLatencyMs: number;
    estimatedCostUsd: number;
    llmCallCount: number;              // How many LLM calls this turn
    strategyUsed: string;
    guardrailsPassed: boolean;
    guardrailViolations: string[];
  };
}
```

### Output Processing Flow (Worker side)

```
Worker receives AiEngineResult, then:

1. Store outbound message (responseText)
2. If crmUpdates.contact  → contacts.service.update()
3. If crmUpdates.conversation → conversations.service.update()
4. If leadStateUpdate.changed → update conversation + emit event
5. If crmUpdates.newOrder  → orders.service.create()
6. If crmUpdates.newBooking → bookings.service.create() + auto-create reminder
7. If crmUpdates.newFollowUp → follow-ups.service.create()
8. If handoff.shouldHandoff → handoffs.service.create() + notify team
9. If upsell.attempted → log upsell event
10. Always: ai-runs.service.create(aiRunLog)
11. Enqueue channel-send job (send responseText to customer)
```

---

## 6. Phase Roadmap — AI Engine Capabilities

### Phase 1: AI Receptionist Engine (Minimum Viable)

```
ACTIVE LAYERS                           LLM CALLS    STRATEGIES AVAILABLE
───────────────────────────────────────────────────────────────────────────
L1  Context Assembler                   —
L2  Knowledge Retriever (keyword)       —
L3  Signal Extractor                    ─┐
L9  Response Generator                   ├─ 1 combined call
                                        ─┘
L4  Intent Classifier                   —
L7  Decision Engine (basic)             —
L8  Strategy Executor                   —            GreetingStrategy
                                                     FaqAnswerStrategy
                                                     CollectInfoStrategy
                                                     GuideBookingStrategy
                                                     GuideOrderStrategy
                                                     ProcessInfoStrategy
                                                     OffHoursAutoReplyStrategy
                                                     GeneralChatStrategy
L13 Guardrails (basic)                  —
L15 Side Effect Collector               —

INACTIVE / STUB:
L5  Objection Classifier               → returns null
L6  Lead State Engine                   → NEW only, no transitions
L10 Tone Layer                          → basic validation only
L11 Closing Reinforcement              → disabled
L12 Upsell Layer                       → disabled
L14 Handoff Evaluator                  → customer-request keyword check only
```

**Phase 1 delivers**:
- Understands customer intent (inquiry, booking, order, greeting)
- Answers from knowledge base
- Collects customer name, phone, email conversationally
- Guides booking creation (date, time, service)
- Guides order creation (product, quantity, confirm)
- Respects business hours (off-hours auto-reply)
- Basic handoff on explicit customer request ("找真人")
- Logs every AI run for debugging
- Updates CRM (contact info, conversation summary)
- Creates bookings/orders/follow-ups as side effects

---

### Phase 2: AI Sales Assistant Engine

```
ACTIVATED LAYERS                        LLM CALLS    NEW STRATEGIES
───────────────────────────────────────────────────────────────────────────
L3  Signal Extractor v2                 1 call       (enhanced extraction)
    + buying signals
    + objection signal detection

L5  Objection Classifier               —            HandleObjectionStrategy
    pattern matching against rules

L6  Lead State Engine                   —
    full FSM with configurable transitions

L7  Decision Engine v2                  —            PushCtaStrategy
    + objection routing                              ExecutePlaybookStepStrategy
    + buying signal routing                          InitiateHandoffStrategy
    + playbook routing

L9  Response Generator                  1 call       (split from extraction)

L10 Tone Layer v2                       —
    + persona-aware system prompt

L14 Handoff Evaluator v2               —
    + confidence threshold
    + repeated objection detection
    + sentiment escalation

NEW:
L2  Knowledge Retriever v2             —
    vector search (pgvector)

Lead scoring integration               —
    scoring rules evaluated per turn

Conversation summary auto-update       —
    every 10 messages
```

**Phase 2 adds**:
- Detects buying signals → pushes call-to-action
- Detects objections → matches rule → applies strategy (reframe, social proof, etc.)
- Lead state FSM: NEW → ENGAGED → QUALIFIED → PROPOSING → CLOSING → WON/LOST
- Sales playbooks: multi-step guided flows
- Human handoff with AI-generated context summary
- Lead scoring: computed per-contact scores
- Semantic knowledge search (vector embeddings)
- 2 LLM calls per turn (extraction + response) for better quality

---

### Phase 3: AI Top Sales Agent Engine

```
ACTIVATED LAYERS                        LLM CALLS    NEW STRATEGIES
───────────────────────────────────────────────────────────────────────────
L3  Signal Extractor v3                 1 call       (+ emotional state,
    + customer emotional state                         decision style)
    + decision style indicators

L5  Objection Classifier v2            —            ChallengerReframeStrategy
    + multi-turn strategy chaining
    + escalation (acknowledge → reframe → value-stack → feel-felt-found)

L6  Lead State Engine v2               —
    + NEGOTIATING state
    + transition analytics

L10 Tone Layer v3                       —
    + decision identity adaptation
    (ANALYTICAL → data-heavy,
     DRIVER → direct,
     EXPRESSIVE → story-driven,
     AMIABLE → warm)

L11 Closing Reinforcement              0-1 call      ClosingReinforcementStrategy
    technique selection based on                      (emotional, assumptive,
    customer profile                                   summary, scarcity)

L12 Upsell / Cross-sell Layer          —             UpsellStrategy
    rule evaluation + offer injection                 (upsell, cross-sell,
                                                       quantity, bundle)

NEW:
TrustRepairStrategy                                  Trust erosion detection
                                                     → switch to empathy mode

Decision Identity Profiler             —             Profile learning over
    updates profile per conversation                  multiple conversations

Analytics feedback loop                —             Track: which strategy →
    A/B test prompt variants                          which outcome → optimize

Prompt versioning                      —             Version-controlled prompts
    track which version → which outcome               for A/B testing
```

**Phase 3 adds**:
- Decision identity profiling: detect if customer is analytical/driver/expressive/amiable
- Tone adaptation per customer type
- Advanced closing: emotional close, assumptive close, summary close
- Multi-turn objection handling with escalating strategies
- Upsell/cross-sell/bundle offers at the right moment
- Trust repair when customer sentiment deteriorates
- Challenger Sale reframing technique
- Analytics loop: track strategy → outcome → optimize prompts
- 2-3 LLM calls per turn (extraction + response + optional closing)

---

## 7. File Structure in `packages/ai-engine`

```
packages/ai-engine/
├── src/
│   ├── index.ts                              ← export { processMessage, AiEngineInput, AiEngineResult }
│   ├── orchestrator.ts                       ← Main pipeline orchestrator
│   │
│   ├── pipeline/
│   │   ├── L01-context-assembler.ts
│   │   ├── L02-knowledge-retriever.ts
│   │   ├── L03-signal-extractor.ts           ← [LLM]
│   │   ├── L04-intent-classifier.ts
│   │   ├── L05-objection-classifier.ts
│   │   ├── L06-lead-state-engine.ts
│   │   ├── L07-decision-engine.ts
│   │   ├── L08-strategy-executor.ts
│   │   ├── L09-response-generator.ts         ← [LLM]
│   │   ├── L10-tone-persona.ts
│   │   ├── L11-closing-reinforcement.ts      ← [LLM, Phase 3]
│   │   ├── L12-upsell-evaluator.ts
│   │   ├── L13-guardrails.ts
│   │   ├── L14-handoff-evaluator.ts
│   │   └── L15-side-effect-collector.ts
│   │
│   ├── strategies/
│   │   ├── strategy.interface.ts
│   │   ├── greeting.strategy.ts
│   │   ├── faq-answer.strategy.ts
│   │   ├── collect-info.strategy.ts
│   │   ├── guide-booking.strategy.ts
│   │   ├── guide-order.strategy.ts
│   │   ├── process-info.strategy.ts
│   │   ├── off-hours.strategy.ts
│   │   ├── general-chat.strategy.ts
│   │   ├── handle-objection.strategy.ts      ← Phase 2
│   │   ├── push-cta.strategy.ts              ← Phase 2
│   │   ├── execute-playbook.strategy.ts      ← Phase 2
│   │   ├── initiate-handoff.strategy.ts      ← Phase 2
│   │   ├── upsell.strategy.ts                ← Phase 3
│   │   ├── trust-repair.strategy.ts          ← Phase 3
│   │   ├── closing-reinforcement.strategy.ts ← Phase 3
│   │   └── challenger-reframe.strategy.ts    ← Phase 3
│   │
│   ├── prompts/
│   │   ├── system/
│   │   │   ├── base-role.prompt.ts
│   │   │   └── tone-variants.prompt.ts
│   │   ├── extraction/
│   │   │   ├── signal-extraction-v1.prompt.ts    ← Phase 1 (combined)
│   │   │   ├── signal-extraction-v2.prompt.ts    ← Phase 2 (standalone)
│   │   │   └── signal-extraction-v3.prompt.ts    ← Phase 3 (+ emotional + identity)
│   │   ├── instructions/
│   │   │   ├── faq-answer.prompt.ts
│   │   │   ├── collect-info.prompt.ts
│   │   │   ├── guide-booking.prompt.ts
│   │   │   ├── guide-order.prompt.ts
│   │   │   ├── handle-objection.prompt.ts
│   │   │   ├── push-cta.prompt.ts
│   │   │   ├── closing.prompt.ts
│   │   │   └── upsell.prompt.ts
│   │   └── prompt-builder.ts                 ← Compose system + context + instruction
│   │
│   ├── llm/
│   │   ├── llm-client.interface.ts           ← Swappable LLM provider interface
│   │   ├── openai-client.ts                  ← OpenAI implementation
│   │   ├── token-counter.ts
│   │   └── llm-cache.ts                      ← Redis cache for FAQ-like responses
│   │
│   ├── rules/
│   │   ├── lead-state-transitions.ts         ← Default FSM rules
│   │   ├── objection-patterns.ts             ← Built-in objection patterns (fallback)
│   │   └── scoring-defaults.ts               ← Default scoring dimensions
│   │
│   └── types/
│       ├── input.types.ts                    ← AiEngineInput
│       ├── output.types.ts                   ← AiEngineResult
│       ├── signals.types.ts                  ← ExtractedSignals, IntentType, etc.
│       ├── strategy.types.ts                 ← Strategy, StrategyResult, StrategyParams
│       ├── side-effects.types.ts             ← SideEffect union type
│       ├── config.types.ts                   ← ToneConfig, HandoffConfig, etc.
│       └── enums.ts                          ← All AI engine enums
│
├── tests/
│   ├── orchestrator.test.ts
│   ├── pipeline/
│   │   ├── decision-engine.test.ts
│   │   ├── lead-state-engine.test.ts
│   │   ├── objection-classifier.test.ts
│   │   ├── guardrails.test.ts
│   │   └── handoff-evaluator.test.ts
│   ├── strategies/
│   │   ├── faq-answer.test.ts
│   │   ├── collect-info.test.ts
│   │   └── handle-objection.test.ts
│   └── fixtures/
│       ├── tenant-config.fixture.ts
│       ├── conversation.fixture.ts
│       └── signals.fixture.ts
│
├── tsconfig.json
└── package.json
```

---

## 8. Orchestrator — Putting It All Together

```typescript
// packages/ai-engine/src/orchestrator.ts

export async function processMessage(input: AiEngineInput): Promise<AiEngineResult> {
  const startTime = Date.now();
  let llmCallCount = 0;
  let totalTokens = { prompt: 0, completion: 0 };

  // ── L1: Assemble context ──
  const context = assembleContext(input);

  // ── L2: Retrieve knowledge ──
  const knowledgeDocs = retrieveKnowledge(
    input.currentMessage.content,
    input.knowledgeDocs,
    input.tenant.maxAiTokensPerTurn * 0.3  // 30% of token budget for knowledge
  );
  context.knowledgeDocs = knowledgeDocs;

  // ── L3: Extract signals ──
  let signals: ExtractedSignals;
  let responseText: string;

  if (input.tenant.plan === 'STARTER') {
    // Phase 1: Combined extraction + response (1 LLM call)
    const combined = await combinedExtractionAndResponse(context, input);
    signals = combined.signals;
    responseText = combined.responseText;
    llmCallCount = 1;
    totalTokens = combined.tokens;
    // Skip L4-L8 strategy selection (response already generated)
    // Still run L13-L15 for guardrails + side effects
  } else {
    // Phase 2+: Separate extraction (1st LLM call)
    const extractionResult = await extractSignals(context, input);
    signals = extractionResult.signals;
    llmCallCount++;
    totalTokens.prompt += extractionResult.tokens.prompt;
    totalTokens.completion += extractionResult.tokens.completion;

    // ── L4: Classify intent ──
    const intent = classifyIntent(signals, context);

    // ── L5: Classify objection ──
    const objection = classifyObjection(signals, input.objectionRules, context);

    // ── L6: Evaluate lead state ──
    const leadStateChange = evaluateLeadState(
      context.conversation.leadState, signals, context, input.scoringRules
    );

    // ── L7: Decide strategy ──
    const decision = decide(intent, objection, context.conversation.leadState, context, input);

    // ── L8: Execute strategy ──
    const strategyResult = await executeStrategy(decision, context, input);

    // ── L9: Generate response (2nd LLM call) ──
    const responseResult = await generateResponse(context, strategyResult, input);
    responseText = responseResult.text;
    llmCallCount++;
    totalTokens.prompt += responseResult.tokens.prompt;
    totalTokens.completion += responseResult.tokens.completion;

    // ── L10: Tone & persona adjustment ──
    responseText = adjustTone(responseText, input.tenant.aiTone, input.decisionProfile);

    // ── L11: Closing reinforcement (Phase 3, conditional) ──
    if (input.tenant.plan === 'ELITE' && shouldReinforceClose(leadStateChange?.newState, signals)) {
      const closingResult = await reinforceClose(responseText, context, input.decisionProfile);
      responseText = closingResult.text;
      llmCallCount++;
      totalTokens.prompt += closingResult.tokens.prompt;
      totalTokens.completion += closingResult.tokens.completion;
    }

    // ── L12: Upsell evaluation (Phase 3) ──
    const upsellOffer = input.tenant.plan === 'ELITE'
      ? evaluateUpsellRules(input.upsellRules, context, signals) : null;
    if (upsellOffer) {
      responseText = appendUpsellOffer(responseText, upsellOffer);
    }
  }

  // ── L13: Guardrails (all phases) ──
  const guardrailResult = runGuardrails(responseText, context);
  responseText = guardrailResult.finalResponse;

  // ── L14: Handoff evaluation (all phases) ──
  const handoffDecision = evaluateHandoff(context, signals, guardrailResult, input.handoff);

  // If handoff triggered, override response
  if (handoffDecision.shouldHandoff && handoffDecision.suggestedMessage) {
    responseText = handoffDecision.suggestedMessage;
  }

  // ── L15: Collect side effects ──
  const sideEffects = collectSideEffects(signals, strategyResult, leadStateChange,
    handoffDecision, upsellOffer);

  // ── Build final result ──
  const totalLatency = Date.now() - startTime;

  return {
    responseText,
    responseMetadata: { ... },
    signals: { ... },
    objection: { ... },
    leadStateUpdate: { ... },
    decisionTrace: { ... },
    nextActions: buildNextActions(signals, context),
    followUp: buildFollowUpRecommendation(signals, context),
    handoff: handoffDecision,
    crmUpdates: buildCrmUpdates(sideEffects),
    upsell: { ... },
    aiRunLog: {
      model: input.tenant.aiModel,
      promptTokens: totalTokens.prompt,
      completionTokens: totalTokens.completion,
      totalTokens: totalTokens.prompt + totalTokens.completion,
      llmLatencyMs: /* tracked per call */,
      totalPipelineLatencyMs: totalLatency,
      estimatedCostUsd: calculateCost(totalTokens, input.tenant.aiModel),
      llmCallCount,
      strategyUsed: decision?.strategy || 'COMBINED_V1',
      guardrailsPassed: guardrailResult.passed,
      guardrailViolations: guardrailResult.violations,
    },
  };
}
```

---

## 9. Analytics & Learning Loop (Phase 3)

```
                    ┌─────────────────────────┐
                    │   CONVERSATION OUTCOME   │
                    │   (WON / LOST / STALE)   │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   OUTCOME ATTRIBUTION    │
                    │                          │
                    │  For this conversation:  │
                    │  - Which strategies used? │
                    │  - Which objection rules? │
                    │  - Which playbook?        │
                    │  - Which closing technique?│
                    │  - Which prompt version?  │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   AGGREGATE ANALYTICS    │
                    │                          │
                    │  Strategy X:             │
                    │    used 150 times        │
                    │    led to WON: 45 (30%)  │
                    │    led to LOST: 20 (13%) │
                    │                          │
                    │  Objection rule Y:       │
                    │    used 80 times         │
                    │    resolved: 52 (65%)    │
                    │                          │
                    │  Prompt version A vs B:  │
                    │    A: 28% conversion     │
                    │    B: 34% conversion ← winner │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   OPTIMIZATION ACTIONS   │
                    │                          │
                    │  - Surface insights in   │
                    │    dashboard             │
                    │  - Suggest rule changes  │
                    │  - Auto-promote winning  │
                    │    prompt variants       │
                    │  - Adjust scoring weights │
                    └──────────────────────────┘
```

The learning loop is NOT AI-driven (no AI optimizing itself). It's analytics-driven:
- Track what happened (every AiRun has strategy + outcome)
- Aggregate results (batch job, daily)
- Surface insights to the tenant in the dashboard
- Tenant decides whether to adjust rules / prompts
- In advanced mode: A/B test prompt variants, auto-promote winners (with human approval)

---

This entire spec is implementation-ready. Every layer has a clear interface, input/output contract, and code-vs-LLM boundary. The orchestrator shows exactly how layers compose. The file structure shows where every piece of code lives.
