# AI Top Sales - System Architecture Proposal

> Version: 0.1 | Date: 2026-03-19
> Status: Design Phase - Pre-Implementation

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Monorepo & Repo Structure](#2-monorepo--repo-structure)
3. [Core Domain Modules](#3-core-domain-modules)
4. [Core Data Model](#4-core-data-model)
5. [AI Engine Architecture](#5-ai-engine-architecture)
6. [Phase-based Implementation Roadmap](#6-phase-based-implementation-roadmap)
7. [Design Principles](#7-design-principles)

---

## 1. System Overview

### 1.1 High-Level Architecture

```
+-------------------------------------------------------------+
|                       CLIENTS / CHANNELS                     |
|  WhatsApp | Instagram | Facebook | Website Chat | Dashboard  |
+------------------------------+------------------------------+
                               |
                    +----------v-----------+
                    |   Channel Gateway    |  (Webhook receivers,
                    |   (Ingress Layer)    |   message normalizer)
                    +----------+-----------+
                               |
              +----------------v-----------------+
              |         API  GATEWAY             |
              |  (NestJS - REST + WebSocket)     |
              |  Auth / Tenant Resolution /      |
              |  Rate Limit / Request Routing    |
              +-------+----------------+--------+
                      |                |
         +------------v---+    +------v-----------+
         |  CORE BUSINESS |    |   AI ENGINE      |
         |  SERVICES      |    |   (Orchestrator) |
         |                |    |                  |
         | - Contacts     |    | - Signal Extract |
         | - Conversations|    | - Lead State     |
         | - Orders       |    | - Objection      |
         | - Bookings     |    | - Decision       |
         | - Follow-ups   |    | - Response Gen   |
         | - Reminders    |    | - Guardrails     |
         | - Knowledge    |    | - CRM Updater    |
         | - Notifications|    | - Handoff Logic  |
         +-------+--------+    +-------+----------+
                 |                      |
         +-------v----------------------v--------+
         |           DATA  LAYER                  |
         |  PostgreSQL (Prisma) | Redis (Cache +  |
         |  Multi-tenant data)  | Queue + PubSub) |
         +-----------------------+----------------+
                                 |
                    +------------v-----------+
                    |   BACKGROUND WORKERS   |
                    |  (BullMQ on Redis)     |
                    |                        |
                    | - Reminder scheduler   |
                    | - Follow-up checker    |
                    | - Analytics aggregator |
                    | - Channel sync jobs    |
                    +------------------------+
```

### 1.2 Architecture Layers

The system is divided into **four conceptual layers**, each with clear responsibilities:

| Layer | Purpose | Examples |
|-------|---------|---------|
| **Platform Layer** (shared) | Multi-tenant infra, auth, billing, config | Tenant resolution, JWT auth, rate limiting, feature flags |
| **Core Business Layer** (shared) | Domain logic reusable across all industries | Contacts, conversations, orders, bookings, reminders, notifications |
| **AI Engine Layer** (shared) | AI orchestration, modular and configurable | Signal extraction, lead scoring, objection handling, response generation |
| **Industry Template Layer** (configurable per tenant) | Industry-specific configs loaded at runtime | Knowledge bases, sales playbooks, objection rules, FAQ templates, tone configs |

**Key insight**: The code is shared; the **behavior** is customized through configuration, templates, and knowledge documents per tenant. We never fork code for a specific customer.

### 1.3 Multi-Tenant Strategy

We use a **shared database, tenant-scoped rows** approach:

- Every core table has a `tenantId` column
- Prisma middleware / NestJS guard automatically injects `tenantId` into every query
- Row-Level Security (RLS) in PostgreSQL as an additional safety net
- Tenant config (features, plan tier, AI settings) is cached in Redis
- **Why not schema-per-tenant?** Too much operational overhead at early stage. We can migrate later if a whale customer requires data isolation.

### 1.4 Request Flow (Example: Incoming WhatsApp Message)

```
1. WhatsApp sends webhook to Channel Gateway
2. Gateway normalizes message format into internal MessageEvent
3. Gateway resolves tenant by phone number / channel config
4. MessageEvent is published to message processing queue (BullMQ)
5. Worker picks up event:
   a. Upsert contact (if new)
   b. Find or create conversation
   c. Store inbound message
   d. Call AI Engine with conversation context
   e. AI Engine returns: response text + side effects (CRM updates, reminders, handoff signal)
   f. Execute side effects (update lead state, create reminder, etc.)
   g. Store outbound message
   h. Send reply via WhatsApp API
6. If handoff triggered: notify human via dashboard + push notification
```

---

## 2. Monorepo & Repo Structure

We use a **Turborepo monorepo** with clear package boundaries.

```
ai-top-sales/
├── apps/
│   ├── web/                    # Next.js - Dashboard / Admin UI
│   │   ├── app/                # App Router
│   │   ├── components/
│   │   ├── lib/
│   │   └── ...
│   ├── api/                    # NestJS - Main API server
│   │   ├── src/
│   │   │   ├── modules/        # Feature modules (NestJS style)
│   │   │   ├── common/         # Guards, interceptors, filters, decorators
│   │   │   ├── config/
│   │   │   └── main.ts
│   │   └── ...
│   └── worker/                 # BullMQ worker process (shares code with api)
│       ├── src/
│       │   ├── jobs/           # Job handlers
│       │   ├── processors/
│       │   └── main.ts
│       └── ...
│
├── packages/
│   ├── database/               # Prisma schema + client + migrations
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── migrations/
│   │   └── index.ts
│   ├── ai-engine/              # AI orchestration logic (pure TypeScript)
│   │   ├── src/
│   │   │   ├── orchestrator.ts
│   │   │   ├── layers/         # signal, lead-state, objection, decision, response, guardrails
│   │   │   ├── prompts/        # Prompt templates (Handlebars / string templates)
│   │   │   └── types.ts
│   │   └── index.ts
│   ├── channel-gateway/        # Channel adapters (WhatsApp, IG, FB, web chat)
│   │   ├── src/
│   │   │   ├── adapters/       # One adapter per channel
│   │   │   ├── normalizer.ts   # Common message format
│   │   │   └── types.ts
│   │   └── index.ts
│   ├── shared/                 # Shared types, utils, constants, enums
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   ├── enums/
│   │   │   └── constants.ts
│   │   └── index.ts
│   └── ui/                     # Shared UI components (if needed)
│       ├── src/
│       └── index.ts
│
├── templates/                  # Industry templates (loaded at runtime, not compiled)
│   ├── beauty-salon/
│   │   ├── knowledge.json
│   │   ├── playbook.json
│   │   ├── objections.json
│   │   └── faq.json
│   ├── restaurant/
│   ├── fitness/
│   └── ...
│
├── docs/                       # Architecture docs, ADRs, API docs
│   ├── ARCHITECTURE.md         # This file
│   └── adr/                    # Architecture Decision Records
│
├── turbo.json
├── package.json
├── tsconfig.base.json
├── .env.example
└── docker-compose.yml          # Local dev: PostgreSQL + Redis
```

### Why this structure?

| Decision | Reasoning |
|----------|-----------|
| **Monorepo (Turborepo)** | Shared types, single lint/test config, atomic PRs across packages |
| **`ai-engine` as separate package** | Can be tested in isolation; no NestJS dependency; portable |
| **`channel-gateway` as separate package** | Channel adapters are swappable; keeps API server clean |
| **`database` as separate package** | Prisma client shared between api, worker, ai-engine |
| **`worker` as separate app** | Can scale independently; long-running jobs don't block API |
| **`templates/` outside packages** | Data, not code; loaded dynamically; easy for non-engineers to edit |

---

## 3. Core Domain Modules

### Module Map

Organized by domain concern. Each NestJS module is self-contained with its own controller, service, and DTOs.

```
apps/api/src/modules/
├── auth/                # Login, register, JWT, API keys
├── tenants/             # Tenant CRUD, settings, plan management
├── users/               # Team members within a tenant
├── contacts/            # Customer/lead records
├── conversations/       # Conversation threads (per contact per channel)
├── messages/            # Individual messages within conversations
├── inquiries/           # Product/service inquiries linked to conversations
├── orders/              # Order records (simple order tracking)
├── bookings/            # Appointment / reservation records
├── follow-ups/          # Scheduled follow-up tasks
├── reminders/           # Automated reminders (for boss / team)
├── notifications/       # Push / email / in-app notifications
├── knowledge-base/      # FAQ docs, product info, uploaded documents
├── sales-playbooks/     # Configurable sales scripts / flows
├── objection-rules/     # Objection patterns + responses (configurable)
├── scoring/             # Lead scoring rules + computed scores
├── ai-runs/             # AI execution logs (input, output, latency, cost)
├── handoffs/            # Human handoff records + status
├── channels/            # Channel configurations (WhatsApp number, IG page, etc.)
├── dashboard/           # Aggregated stats, KPIs, charts data
├── webhooks/            # Inbound webhook receivers (channel messages)
└── settings/            # Tenant-level AI config, tone, language, business hours
```

### Module Dependency Overview

```
auth ──> tenants ──> users
                       │
         channels ─────┤
                       v
contacts <──> conversations <──> messages
    │              │
    v              v
 orders        inquiries
 bookings      follow-ups ──> reminders ──> notifications
    │
    v
 scoring ──> ai-runs ──> handoffs
    ^
    │
knowledge-base + sales-playbooks + objection-rules
```

### Phase Mapping

| Module | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| auth, tenants, users | Yes | | |
| contacts, conversations, messages | Yes | | |
| orders, bookings | Yes | | |
| follow-ups, reminders, notifications | Yes | | |
| knowledge-base | Yes | | |
| channels (WhatsApp, web) | Yes | +IG, FB | |
| dashboard (basic) | Yes | Enhanced | Advanced |
| scoring | | Yes | |
| sales-playbooks | | Yes | Yes |
| objection-rules | | Basic | Advanced |
| handoffs | | Yes | |
| ai-runs (logging) | Basic | Enhanced | Full analytics |

---

## 4. Core Data Model

### Entity Relationship Diagram (High Level)

```
Tenant 1──* User
Tenant 1──* Contact
Tenant 1──* Channel
Tenant 1──* KnowledgeDocument
Tenant 1──* SalesPlaybook
Tenant 1──* ObjectionRule
Tenant 1──* UpsellRule
Tenant 1──* TenantSettings (1:1)

Contact 1──* Conversation
Contact 1──* Order
Contact 1──* Booking
Contact 0..1── LeadScore

Conversation 1──* Message
Conversation 0..1── ConversationSummary
Conversation 0..* FollowUp
Conversation 0..* HandoffLog
Conversation *──1 Channel

FollowUp 0..* Reminder

Message 0..1── AiRun (the AI processing record for that message)

SalesPlaybook 1──* PlaybookStep
```

### Entity Definitions

```
Tenant
├── id                  UUID
├── name                string
├── slug                string (unique, URL-safe)
├── plan                enum: STARTER | GROWTH | ELITE
├── industry            string (e.g., "beauty", "restaurant", "fitness")
├── status              enum: ACTIVE | SUSPENDED | TRIAL
├── trialEndsAt         datetime?
├── createdAt           datetime
└── updatedAt           datetime

TenantSettings (1:1 with Tenant)
├── id                  UUID
├── tenantId            UUID (FK)
├── businessName        string
├── businessDescription text
├── language            string (default: "zh-HK")
├── timezone            string (default: "Asia/Hong_Kong")
├── businessHours       json  (e.g., { mon: "09:00-18:00", ... })
├── aiTone              enum: FRIENDLY | PROFESSIONAL | CASUAL | LUXURY
├── aiGreeting          text
├── aiModel             string (default: "gpt-4o-mini")
├── maxAiTokensPerTurn  int
├── autoHandoffEnabled  boolean
├── handoffMessage      text
└── ...config fields

User
├── id                  UUID
├── tenantId            UUID (FK)
├── email               string
├── name                string
├── role                enum: OWNER | ADMIN | AGENT
├── passwordHash        string
├── isActive            boolean
├── lastLoginAt         datetime?
└── ...

Channel
├── id                  UUID
├── tenantId            UUID (FK)
├── type                enum: WHATSAPP | INSTAGRAM | FACEBOOK | WEB_CHAT
├── config              json  (API keys, phone number, page ID, etc. - encrypted)
├── isActive            boolean
└── ...

Contact
├── id                  UUID
├── tenantId            UUID (FK)
├── externalId          string? (WhatsApp phone, IG user ID, etc.)
├── channelType         enum
├── name                string?
├── phone               string?
├── email               string?
├── tags                string[]
├── customFields        json
├── firstContactAt      datetime
├── lastContactAt       datetime
├── status              enum: NEW | ACTIVE | INACTIVE | CONVERTED | LOST
└── ...

Conversation
├── id                  UUID
├── tenantId            UUID (FK)
├── contactId           UUID (FK)
├── channelId           UUID (FK)
├── status              enum: OPEN | WAITING | HANDED_OFF | CLOSED | ARCHIVED
├── assignedUserId      UUID? (FK, for human handoff)
├── leadState           enum: NEW | ENGAGED | QUALIFIED | PROPOSING | CLOSING | WON | LOST
│                       (Phase 2+, default NEW in Phase 1)
├── leadScore           int? (Phase 2+)
├── summary             text? (AI-generated conversation summary)
├── lastMessageAt       datetime
├── messageCount        int
├── metadata            json
└── ...

Message
├── id                  UUID
├── tenantId            UUID (FK)
├── conversationId      UUID (FK)
├── direction           enum: INBOUND | OUTBOUND
├── sender              enum: CUSTOMER | AI | HUMAN_AGENT
├── content             text
├── contentType         enum: TEXT | IMAGE | AUDIO | FILE | TEMPLATE
├── channelMessageId    string? (external message ID)
├── replyToId           UUID? (FK, self-ref)
├── metadata            json
├── createdAt           datetime
└── ...

Order
├── id                  UUID
├── tenantId            UUID (FK)
├── contactId           UUID (FK)
├── conversationId      UUID? (FK)
├── orderNumber         string
├── status              enum: DRAFT | CONFIRMED | PROCESSING | COMPLETED | CANCELLED
├── items               json (line items)
├── totalAmount         decimal?
├── currency            string (default: "HKD")
├── notes               text?
├── createdAt           datetime
└── ...

Booking
├── id                  UUID
├── tenantId            UUID (FK)
├── contactId           UUID (FK)
├── conversationId      UUID? (FK)
├── title               string
├── startAt             datetime
├── endAt               datetime?
├── status              enum: PENDING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW
├── location            string?
├── notes               text?
├── reminderSentAt      datetime?
└── ...

FollowUp
├── id                  UUID
├── tenantId            UUID (FK)
├── conversationId      UUID (FK)
├── contactId           UUID (FK)
├── assignedUserId      UUID? (FK)
├── type                enum: CALL | MESSAGE | EMAIL | TASK
├── reason              text
├── dueAt               datetime
├── status              enum: PENDING | COMPLETED | OVERDUE | CANCELLED
├── completedAt         datetime?
└── ...

Reminder
├── id                  UUID
├── tenantId            UUID (FK)
├── targetType          enum: BOOKING | FOLLOW_UP | ORDER | CUSTOM
├── targetId            UUID
├── recipientUserId     UUID (FK)
├── channel             enum: PUSH | EMAIL | SMS | IN_APP
├── message             text
├── scheduledAt         datetime
├── sentAt              datetime?
├── status              enum: SCHEDULED | SENT | FAILED | CANCELLED
└── ...

KnowledgeDocument
├── id                  UUID
├── tenantId            UUID (FK)
├── title               string
├── content             text
├── category            string? (e.g., "FAQ", "product", "policy")
├── embedding           vector? (for semantic search, Phase 2+)
├── isActive            boolean
├── sortOrder           int
└── ...

SalesPlaybook (Phase 2+)
├── id                  UUID
├── tenantId            UUID (FK)
├── name                string
├── description         text?
├── triggerCondition    json (when to activate)
├── steps               PlaybookStep[]
├── isActive            boolean
└── ...

PlaybookStep (Phase 2+)
├── id                  UUID
├── playbookId          UUID (FK)
├── stepOrder           int
├── action              enum: ASK_QUESTION | PRESENT_OFFER | HANDLE_OBJECTION | CTA | HANDOFF
├── config              json (prompt template, options, etc.)
└── ...

ObjectionRule (Phase 2-3)
├── id                  UUID
├── tenantId            UUID (FK)
├── pattern             string (trigger pattern / keyword)
├── category            enum: PRICE | TIMING | TRUST | COMPETITOR | NEED | AUTHORITY
├── response            text (template with variables)
├── strategy            enum: ACKNOWLEDGE | REFRAME | SOCIAL_PROOF | SCARCITY | EMPATHY
├── priority            int
├── isActive            boolean
└── ...

UpsellRule (Phase 3)
├── id                  UUID
├── tenantId            UUID (FK)
├── type                enum: UPSELL | CROSS_SELL | QUANTITY
├── triggerCondition    json
├── offerTemplate       text
├── isActive            boolean
└── ...

AiRun (Audit / Analytics log)
├── id                  UUID
├── tenantId            UUID (FK)
├── conversationId      UUID (FK)
├── messageId           UUID? (FK)
├── model               string
├── promptTokens        int
├── completionTokens    int
├── latencyMs           int
├── totalCost           decimal
├── inputSnapshot       json (sanitized context sent to LLM)
├── outputSnapshot      json (raw LLM response)
├── extractedSignals    json? (Phase 2+)
├── appliedRules        string[]? (which rules fired)
├── createdAt           datetime
└── ...

HandoffLog (Phase 2+)
├── id                  UUID
├── tenantId            UUID (FK)
├── conversationId      UUID (FK)
├── reason              enum: CUSTOMER_REQUEST | AI_UNCERTAIN | ESCALATION | COMPLEX_INQUIRY
├── aiSummary           text (AI-generated context for human agent)
├── assignedUserId      UUID? (FK)
├── handoffAt           datetime
├── resolvedAt          datetime?
├── resolution          text?
└── ...

DecisionIdentityProfile (Phase 3)
├── id                  UUID
├── tenantId            UUID (FK)
├── contactId           UUID (FK)
├── type                enum: ANALYTICAL | DRIVER | EXPRESSIVE | AMIABLE
├── confidence          float
├── signals             json (evidence from conversations)
├── updatedAt           datetime
└── ...
```

---

## 5. AI Engine Architecture

The AI engine is the brain of the system. It is implemented as a **pipeline of composable layers**, not a single monolithic prompt.

### 5.1 Pipeline Architecture

```
Incoming Message
       │
       v
┌──────────────────┐
│ Context Assembler │  Gather: conversation history, contact profile,
│                   │  tenant config, knowledge base, playbook state
└────────┬─────────┘
         v
┌──────────────────┐
│ Signal Extractor  │  Detect: intent, sentiment, urgency, topic,
│                   │  objection signals, buying signals, entities
└────────┬─────────┘
         v
┌──────────────────┐
│ Lead State Engine │  Evaluate current state, determine if state
│                   │  transition should occur (NEW -> ENGAGED -> ...)
└────────┬─────────┘
         v
┌──────────────────┐
│ Decision Engine   │  Choose strategy: answer FAQ? ask question?
│  (Router)         │  handle objection? push CTA? handoff?
└────────┬─────────┘
         v
┌──────────────────┐
│ Strategy Executor │  Load appropriate handler:
│                   │  - FAQ Responder
│                   │  - Question Asker (collect info)
│                   │  - Objection Handler
│                   │  - CTA / Next Step Pusher
│                   │  - Booking / Order Creator
│                   │  - Handoff Initiator
│                   │  - Upsell Engine (Phase 3)
│                   │  - Trust Repair (Phase 3)
└────────┬─────────┘
         v
┌──────────────────┐
│ Response Generator│  Compose final message using:
│                   │  - Tone config (per tenant)
│                   │  - Language (zh-HK, en, etc.)
│                   │  - Template + dynamic content
└────────┬─────────┘
         v
┌──────────────────┐
│ Guardrails        │  Check: no hallucination, no off-topic,
│                   │  no sensitive info leak, length limit,
│                   │  brand safety, pricing accuracy
└────────┬─────────┘
         v
┌──────────────────┐
│ Side Effect       │  Execute: CRM updates, create booking,
│  Executor         │  create reminder, update lead score,
│                   │  log AI run, trigger notification
└────────┬─────────┘
         v
  Final Response + Side Effects
```

### 5.2 Layer Details

#### Context Assembler
- Loads recent N messages from conversation (configurable window, e.g., last 20)
- Loads contact profile (name, history, tags, custom fields)
- Loads tenant settings (tone, language, business hours, greeting)
- Loads relevant knowledge documents (keyword match in Phase 1, vector search in Phase 2)
- Loads active playbook state (Phase 2+)
- Assembles into a structured context object (NOT a giant string)

#### Signal Extractor (Phase 1: basic, Phase 2-3: advanced)
```typescript
interface ExtractedSignals {
  intent: 'inquiry' | 'booking' | 'order' | 'complaint' | 'followup' | 'greeting' | 'unknown';
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'low' | 'medium' | 'high';
  topics: string[];                    // detected topics
  entities: {                          // extracted structured data
    name?: string;
    phone?: string;
    email?: string;
    date?: string;
    time?: string;
    productMention?: string;
    quantity?: number;
  };
  buyingSignals: string[];             // Phase 2+
  objectionSignals: string[];          // Phase 2+
  decisionStyle?: string;             // Phase 3
}
```
- Phase 1: Use a focused LLM call with structured output (JSON mode) to extract basic intent + entities
- Phase 2: Add buying signal detection, objection pattern matching
- Phase 3: Add decision identity profiling, emotional state detection

#### Lead State Engine (Phase 2+)
- Finite state machine: `NEW -> ENGAGED -> QUALIFIED -> PROPOSING -> CLOSING -> WON/LOST`
- Transition rules are configurable per tenant
- Each transition can trigger side effects (notifications, playbook activation)
- Phase 1: All conversations default to `NEW` state; no transitions

#### Decision Engine (Router)
- Rule-based routing with LLM fallback
- Priority order:
  1. Is handoff active? -> Route to human
  2. Is it outside business hours + urgent? -> Auto-reply with promise
  3. Does FAQ / knowledge base match? -> FAQ Responder
  4. Is customer providing requested info? -> Process & acknowledge
  5. Is there an objection signal? -> Objection Handler (Phase 2+)
  6. Is there a buying signal? -> CTA Pusher (Phase 2+)
  7. Default -> General conversational response with gentle info gathering

#### Response Generator
- Uses **composable prompt templates**, not a single mega-prompt
- Template structure:
  ```
  [System: Role + Tone + Constraints]
  [Context: Business info + relevant knowledge]
  [Conversation: Recent messages]
  [Instruction: What to do this turn, based on Decision Engine output]
  [Format: Output format constraints]
  ```
- Templates are stored as versioned files, not hardcoded strings
- Each strategy (FAQ, objection, CTA, etc.) has its own instruction template

#### Guardrails
- Output validation before sending:
  - No pricing hallucination (cross-check with knowledge base)
  - No promises outside business capability
  - No sensitive data leakage
  - Response length within limits
  - Language consistency
- Phase 1: Basic checks (length, language)
- Phase 2+: Pricing verification, claim validation

#### CRM Updater (Side Effect Executor)
- After AI generates response, execute side effects:
  - Update contact fields (name, phone, email extracted from conversation)
  - Update conversation summary
  - Update lead state (Phase 2+)
  - Create order / booking records
  - Schedule follow-up / reminder
  - Log AI run for analytics
- Side effects are returned as a typed array from the pipeline, not executed inline

### 5.3 LLM Call Strategy

| Concern | Approach |
|---------|----------|
| **Cost control** | Use `gpt-4o-mini` for most turns; reserve `gpt-4o` for complex objections (Phase 3) |
| **Latency** | Signal extraction + response generation can be a single LLM call in Phase 1; split into 2 calls in Phase 2+ for better accuracy |
| **Structured output** | Use JSON mode / function calling for signal extraction; free text for response |
| **Token management** | Sliding window for conversation history; summarize older messages |
| **Caching** | Cache FAQ-matching responses in Redis (same question = same answer within TTL) |

---

## 6. Phase-based Implementation Roadmap

### Phase 1: AI Receptionist (Starter) - MVP

**Goal**: A working AI that can receive messages, answer FAQs, collect customer info, create basic records, and remind the boss.

**Duration estimate**: 6-8 weeks

#### Sprint 1-2: Foundation (Weeks 1-4)
- [ ] Monorepo setup (Turborepo + TypeScript + ESLint + Prettier)
- [ ] Docker Compose (PostgreSQL + Redis)
- [ ] Prisma schema: Tenant, User, Contact, Conversation, Message, Order, Booking, FollowUp, Reminder, KnowledgeDocument, Channel, TenantSettings, AiRun
- [ ] NestJS app scaffold with module structure
- [ ] Auth module (JWT, login, register)
- [ ] Tenant module (CRUD, settings)
- [ ] Multi-tenant middleware (tenant resolution from JWT / API key)
- [ ] Contact module (CRUD + auto-create from messages)
- [ ] Conversation + Message modules

#### Sprint 3-4: AI Engine v1 + Channels (Weeks 5-8)
- [ ] AI Engine v1: Context Assembler + basic Signal Extractor + simple Decision Engine + Response Generator + basic Guardrails
- [ ] Knowledge Base module (CRUD, simple keyword matching)
- [ ] Channel Gateway: Web Chat adapter (easiest to start with)
- [ ] Channel Gateway: WhatsApp Cloud API adapter
- [ ] Order + Booking modules (basic CRUD, AI can create via side effects)
- [ ] Follow-up + Reminder modules
- [ ] BullMQ worker: reminder scheduler, follow-up checker
- [ ] Notification module (in-app + email basics)
- [ ] Next.js dashboard: login, conversation list, conversation detail, contact list, knowledge base editor, basic stats
- [ ] Settings page (business info, AI tone, greeting, business hours)

#### Phase 1 Deliverables
- Working web chat widget embeddable on customer's website
- WhatsApp integration (receive + reply)
- AI answers FAQs from knowledge base
- AI collects customer name, phone, email
- AI creates orders / bookings from conversation
- Boss gets reminders for upcoming bookings / follow-ups
- Basic dashboard showing conversations, contacts, bookings

---

### Phase 2: AI Sales Assistant (Growth)

**Goal**: AI becomes proactive - qualifies leads, handles objections, pushes next steps, supports human handoff.

**Duration estimate**: 6-8 weeks (after Phase 1)

#### Module Additions
- [ ] Lead scoring module (configurable rules + computed scores)
- [ ] Sales playbook module (configurable multi-step flows)
- [ ] Objection rules module (pattern + strategy + response)
- [ ] Handoff module (trigger, assign, context transfer, resolve)
- [ ] Conversation summary (AI-generated, auto-updated)
- [ ] Channel: Instagram DM adapter
- [ ] Channel: Facebook Messenger adapter

#### AI Engine Upgrades
- [ ] Signal Extractor v2: buying signals, objection detection, advanced entity extraction
- [ ] Lead State Engine: FSM with configurable transitions
- [ ] Decision Engine v2: playbook-aware routing, objection routing
- [ ] Objection Handler strategy
- [ ] CTA / Next Step pusher strategy
- [ ] Handoff logic (confidence threshold, customer request detection)
- [ ] CRM Updater v2: lead score updates, conversation summary

#### Dashboard Upgrades
- [ ] Sales pipeline view (lead states)
- [ ] Lead scoring display
- [ ] Handoff queue for human agents
- [ ] Conversation timeline with AI annotations
- [ ] Playbook editor (visual flow builder, stretch goal)

---

### Phase 3: AI Top Sales Agent (Elite)

**Goal**: AI becomes a sophisticated sales agent with advanced persuasion, personalization, and continuous learning.

**Duration estimate**: 8-12 weeks (after Phase 2)

#### Module Additions
- [ ] Decision Identity Profiles (per contact)
- [ ] Upsell / cross-sell rules module
- [ ] Advanced objection engine (multi-turn, strategy chaining)
- [ ] Analytics / learning loop module

#### AI Engine Upgrades
- [ ] Challenger / Reframing engine (advanced objection reframing)
- [ ] Emotional closing reinforcement
- [ ] Decision identity detection + tone adaptation
- [ ] Upsell / cross-sell / quantity upsell engine
- [ ] Trust repair mode (detect trust erosion, switch strategy)
- [ ] Advanced guardrails (claim verification, competitive positioning)
- [ ] Prompt / playbook optimization (A/B testing framework)

#### Analytics & Learning
- [ ] Conversation outcome tracking (conversion rate by playbook, by objection strategy)
- [ ] Response quality scoring (human feedback loop)
- [ ] Automated prompt refinement suggestions
- [ ] Dashboard: conversion funnels, AI performance metrics, revenue attribution

---

## 7. Design Principles

### 7.1 Guiding Principles

1. **Configuration over Code**
   Sales logic, objection responses, playbook steps, knowledge, and tone are all **data/config**, not hardcoded. Adding a new industry or customizing for a new tenant should require zero code changes.

2. **Layered AI, Not Monolithic Prompts**
   The AI engine is a pipeline of focused steps. Each step has a single responsibility. This makes the system debuggable, testable, and incrementally improvable.

3. **Phase-Compatible Architecture**
   Every module built in Phase 1 has clear extension points for Phase 2 and 3. For example:
   - `Conversation.leadState` exists from day 1 (defaults to NEW)
   - Signal Extractor returns a typed interface that can grow
   - Decision Engine is a prioritized rule list that can have rules added

4. **Tenant Isolation by Default**
   Every query, every cache key, every queue job is tenant-scoped. This is enforced at the framework level (NestJS guards + Prisma middleware), not left to individual developers.

5. **Async by Design**
   Message processing is queue-based from the start. This means:
   - API server stays fast (webhook receives + ack in <200ms)
   - AI processing happens in workers (can scale horizontally)
   - Retries and dead-letter queues are built in

6. **Observable**
   Every AI run is logged (AiRun table). Every state transition is recorded. This creates the data foundation for Phase 3's analytics and learning loop.

7. **Human-in-the-Loop Ready**
   Even in Phase 1, the architecture supports human takeover. Phase 2 makes it seamless with context summaries and assignment.

### 7.2 What We Deliberately Defer

| Concern | Deferred Until | Reason |
|---------|---------------|--------|
| Vector embeddings / RAG | Phase 2 | Keyword matching is sufficient for small knowledge bases |
| Real-time WebSocket for dashboard | Phase 1 late / Phase 2 | Polling is fine initially |
| Billing / subscription management | Post-Phase 1 | Use manual billing or Stripe later |
| Multi-language AI | Phase 2 | Start with zh-HK + en |
| Voice / audio messages | Phase 2 | Text first |
| Mobile app | Phase 3 | Web dashboard is sufficient |
| Kubernetes / cloud-native deploy | Phase 2 | Docker Compose for dev + single VM for early production |
| Schema-per-tenant DB isolation | Only if needed | Shared DB with row-level scoping is simpler |

### 7.3 Anti-Patterns We Avoid

- **No God Prompt**: We never create a single 5000-token system prompt that tries to handle every scenario. Instead, the Decision Engine selects a focused strategy, and only the relevant instruction template is injected.

- **No Hardcoded Industry Logic**: Industry-specific knowledge is loaded from templates/config, never from `if (industry === 'beauty')` branches.

- **No Synchronous AI Calls in Request Path**: The API server never blocks on LLM calls. All AI processing goes through the message queue.

- **No Direct Database Access from AI Engine**: The AI engine package returns side effects as data. The worker/API layer executes them. This keeps the AI engine testable and portable.

- **No Feature Flags via Code Comments**: Use a proper feature flag system (tenant plan-based) from the start.

---

## Appendix A: Technology Stack Summary

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Frontend | Next.js 14+ (App Router) | RSC, great DX, Vercel-deployable |
| Backend API | NestJS | Modular, TypeScript-native, great for multi-module SaaS |
| ORM | Prisma | Type-safe, great migration story, good with PostgreSQL |
| Database | PostgreSQL | Robust, JSON support, RLS support, vector extension (pgvector) for Phase 2 |
| Cache / Queue | Redis + BullMQ | Battle-tested, low latency, pub/sub for real-time |
| AI / LLM | OpenAI API (gpt-4o-mini / gpt-4o) | Best balance of quality / cost / speed for structured tasks |
| Monorepo | Turborepo | Fast builds, good TypeScript support |
| Auth | JWT (access + refresh tokens) | Simple, stateless, sufficient for Phase 1 |
| File Storage | S3-compatible (R2 / MinIO) | For knowledge base documents, images |
| Deployment (Phase 1) | Docker Compose on VPS | Simple, low cost, sufficient for early customers |

## Appendix B: Key API Endpoints (Phase 1)

```
POST   /auth/login
POST   /auth/register
GET    /auth/me

GET    /tenants/current
PATCH  /tenants/current/settings

GET    /contacts
GET    /contacts/:id
POST   /contacts
PATCH  /contacts/:id

GET    /conversations
GET    /conversations/:id
GET    /conversations/:id/messages
POST   /conversations/:id/messages          (human agent sending a message)

GET    /orders
POST   /orders
PATCH  /orders/:id

GET    /bookings
POST   /bookings
PATCH  /bookings/:id

GET    /follow-ups
POST   /follow-ups
PATCH  /follow-ups/:id

GET    /reminders
PATCH  /reminders/:id

GET    /knowledge-base
POST   /knowledge-base
PATCH  /knowledge-base/:id
DELETE /knowledge-base/:id

GET    /channels
POST   /channels
PATCH  /channels/:id

GET    /dashboard/stats

POST   /webhooks/whatsapp          (inbound from WhatsApp)
POST   /webhooks/web-chat          (inbound from web widget)
```

## Appendix C: Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_top_sales

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=<random-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o-mini

# WhatsApp Cloud API
WHATSAPP_API_URL=https://graph.facebook.com/v18.0
WHATSAPP_VERIFY_TOKEN=<webhook-verify-token>

# App
APP_URL=http://localhost:3000
API_URL=http://localhost:3001
NODE_ENV=development
```
