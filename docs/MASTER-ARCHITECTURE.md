# AI Top Sales — Master Architecture Document

> Version: 1.0 | Date: 2026-03-19
> Status: Approved for Implementation
> Audience: Engineering team, technical co-founders, contractors

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Phase Roadmap](#2-phase-roadmap)
3. [High-Level System Architecture](#3-high-level-system-architecture)
4. [Monorepo Structure](#4-monorepo-structure)
5. [Backend Module Architecture](#5-backend-module-architecture)
6. [AI Engine Architecture](#6-ai-engine-architecture)
7. [Data Model Overview](#7-data-model-overview)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Integrations Strategy](#9-integrations-strategy)
10. [Multi-Tenant Strategy](#10-multi-tenant-strategy)
11. [Configuration Strategy](#11-configuration-strategy)
12. [Implementation Plan](#12-implementation-plan)

---

## 1. Product Overview

### 1.1 What We're Building

A **24-hour AI sales employee** as a SaaS product for SMBs in Hong Kong and Asia. The product serves businesses that rely on messaging channels (WhatsApp, Instagram, Facebook, website chat) to receive customer inquiries and book appointments.

This is **not a chatbot**. It is an upgradable AI workforce system:

| Tier | Product Name | What It Does |
|------|-------------|-------------|
| **Starter** | AI Receptionist | Answers FAQs, collects customer info, creates bookings/orders, reminds the boss |
| **Growth** | AI Sales Assistant | Qualifies leads, scores them, handles objections, pushes next steps, hands off to humans |
| **Elite** | AI Top Sales Agent | Adapts tone to customer personality, closes with emotional reinforcement, upsells, learns from outcomes |

### 1.2 Target Customer

- Hair salons, beauty clinics, restaurants, fitness studios, tutoring centers, freelance service providers
- 1-20 employees, owner-operated
- Hong Kong / Taiwan / Southeast Asia
- Receive 20-200 customer messages/day across WhatsApp + Instagram
- Currently respond manually or lose customers to slow response times

### 1.3 Core Value Proposition

> "Your AI employee works 24 hours, never forgets a customer, and gets better at selling over time."

### 1.4 Key User Flows

**Flow 1: Customer sends WhatsApp message → AI responds in seconds**
```
Customer → WhatsApp → Webhook → Queue → AI Pipeline → Reply via WhatsApp
                                          ↓
                              CRM updated, booking created, boss reminded
```

**Flow 2: Boss opens dashboard in the morning → sees everything that happened overnight**
```
Dashboard → New conversations (12), New bookings (3), Follow-ups due (2), AI stats
```

**Flow 3: Boss teaches the AI → updates knowledge base**
```
Knowledge Base → Add "Our cancellation policy is..." → AI immediately uses it
```

---

## 2. Phase Roadmap

### Phase 1: AI Receptionist (Starter) — 6-8 weeks

**Goal**: Working AI that receives messages, answers FAQs, collects info, creates records, reminds the boss.

| Category | Deliverables |
|----------|-------------|
| **Channels** | WhatsApp Cloud API, embeddable web chat widget |
| **AI capabilities** | FAQ answering, entity extraction (name/phone/date), booking/order creation, off-hours auto-reply |
| **CRM** | Contacts, conversations, messages, orders, bookings |
| **Tasks** | Follow-ups, reminders, in-app notifications |
| **Dashboard** | Stats overview, conversation inbox (split view), booking calendar, contact list |
| **Config** | Knowledge base editor, AI tone/greeting settings, channel connections, team management |

### Phase 2: AI Sales Assistant (Growth) — 6-8 weeks after Phase 1

**Goal**: AI proactively qualifies, handles objections, pushes CTA, supports human handoff.

| Category | Deliverables |
|----------|-------------|
| **Channels** | + Instagram DM, + Facebook Messenger |
| **AI capabilities** | Buying signal detection, objection handling, playbook execution, lead state FSM, human handoff with context summary |
| **CRM** | Lead scoring, sales pipeline (Kanban), conversation summaries |
| **Config** | Sales playbook editor, objection rule editor, scoring rule editor, handoff settings |
| **Dashboard** | Pipeline view, handoff queue, AI usage stats |

### Phase 3: AI Top Sales Agent (Elite) — 8-12 weeks after Phase 2

**Goal**: Sophisticated AI with personalization, advanced closing, and learning loop.

| Category | Deliverables |
|----------|-------------|
| **AI capabilities** | Decision identity profiling, tone adaptation per customer type, closing reinforcement (emotional/assumptive/summary), multi-turn objection chaining, upsell/cross-sell, trust repair mode |
| **Analytics** | Conversion funnels, strategy effectiveness, prompt A/B testing, revenue attribution |
| **Config** | Upsell rule editor, decision identity config |

### What We Deliberately Defer

| Concern | When | Reason |
|---------|------|--------|
| Vector embeddings / RAG | Phase 2 | Keyword matching is sufficient for small knowledge bases |
| Billing / subscriptions | Post-Phase 1 | Manual billing or Stripe integration later |
| Mobile app | Phase 3+ | Web dashboard is responsive and sufficient |
| Kubernetes | Phase 2+ | Docker Compose on VPS for early production |
| Voice/audio messages | Phase 2 | Text first |
| Multi-language AI | Phase 2 | Start with zh-HK + en |

---

## 3. High-Level System Architecture

### 3.1 System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENTS / CHANNELS                       │
│   WhatsApp  │  Instagram  │  Facebook  │  Web Chat  │  Dashboard  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │     CHANNEL GATEWAY     │  Webhook receivers,
              │     (Ingress Layer)     │  message normalizer
              └────────────┬────────────┘
                           │
          ┌────────────────▼──────────────────┐
          │          API GATEWAY               │
          │    NestJS — REST + WebSocket       │
          │  Auth / Tenant / Rate Limit        │
          └───────┬──────────────────┬─────────┘
                  │                  │
     ┌────────────▼──────┐  ┌───────▼──────────┐
     │  CORE BUSINESS    │  │   AI ENGINE       │
     │  SERVICES         │  │   (15-layer       │
     │                   │  │    pipeline)       │
     │  Contacts         │  │                   │
     │  Conversations    │  │  Signal Extract   │
     │  Messages         │  │  Lead State FSM   │
     │  Orders           │  │  Decision Engine  │
     │  Bookings         │  │  Response Gen     │
     │  Follow-ups       │  │  Guardrails       │
     │  Knowledge Base   │  │  Side Effects     │
     │  Notifications    │  │                   │
     └────────┬──────────┘  └───────┬──────────┘
              │                     │
     ┌────────▼─────────────────────▼──────────┐
     │              DATA LAYER                  │
     │   PostgreSQL (Prisma)  │  Redis (Cache   │
     │   Multi-tenant rows    │  + BullMQ Queue)│
     └────────────────────────┬────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │      BACKGROUND WORKERS       │
              │         (BullMQ)              │
              │                               │
              │  Message processor (AI flow)  │
              │  Reminder scheduler (cron)    │
              │  Follow-up checker (cron)     │
              │  Channel sender (outbound)    │
              │  Analytics aggregator (P2+)   │
              └───────────────────────────────┘
```

### 3.2 Architecture Layers

| Layer | Purpose | Changes Per Customer? |
|-------|---------|----------------------|
| **Platform** | Auth, tenants, users, channels, rate limiting | Never |
| **Core Business** | Contacts, conversations, orders, bookings, tasks | Never |
| **AI Engine** | 15-layer pipeline: extraction → decision → response | Never (code is shared) |
| **Industry Config** | Knowledge base, playbooks, objection rules, tone | Always (per-tenant config) |

**The code is shared. The behavior is customized via configuration.** Adding a new industry requires zero code changes — only new knowledge documents and rule configurations.

### 3.3 Request Flow: Inbound WhatsApp Message

```
1. WhatsApp → POST /webhooks/whatsapp (API server)
2. Verify signature, normalize message format
3. Resolve tenant by phone number / channel config
4. Enqueue "message.inbound" job → return 200 OK (<200ms)

5. Worker picks up job:
   a. Upsert contact (auto-create if new)
   b. Find/create conversation
   c. Store inbound message
   d. Load tenant AI config from Redis cache
   e. Call AI Engine pipeline (see Section 6)
   f. AI returns: response text + side effects
   g. Execute side effects:
      - Update contact fields (name, phone from extraction)
      - Update conversation summary
      - Create booking (if AI decided)
      - Schedule follow-up (if AI decided)
      - Update lead state (Phase 2+)
   h. Store outbound message
   i. Log AI run (for debugging + analytics)
   j. Enqueue "channel.send" job

6. Channel sender worker sends reply via WhatsApp API
7. If handoff triggered → notify human agent via dashboard
```

### 3.4 Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | **Next.js 15** (App Router) | RSC, fast DX, TypeScript-native |
| Backend API | **NestJS** | Modular, TypeScript, great for multi-module SaaS |
| ORM | **Prisma** | Type-safe, migration story, PostgreSQL support |
| Database | **PostgreSQL 16** | JSON, RLS, pgvector (Phase 2), battle-tested |
| Cache + Queue | **Redis + BullMQ** | Low latency, pub/sub, job processing |
| AI / LLM | **OpenAI API** (gpt-4o-mini / gpt-4o) | Quality-cost-speed balance |
| Monorepo | **pnpm + Turborepo** | Fast builds, shared types, single repo |
| Auth | **JWT** (access + refresh) | Simple, stateless |
| Deployment | **Docker Compose → VPS** | Low cost for early customers |

---

## 4. Monorepo Structure

### 4.1 Top-Level Layout

```
ai-top-sales/
├── apps/
│   ├── web/                  Next.js dashboard (port 3000)
│   ├── api/                  NestJS API server (port 3001)
│   └── worker/               BullMQ background workers (no HTTP)
│
├── packages/
│   ├── database/             Prisma schema + client + tenant-scope middleware
│   ├── shared/               Enums, types, utils, constants — used by all
│   ├── ai-engine/            AI pipeline (pure TypeScript, zero DB dependency)
│   └── channel-adapters/     WhatsApp / IG / FB / web chat adapters
│
├── config/                   Shared ESLint + TSConfig
├── docker/                   Docker Compose + Dockerfiles
├── docs/                     Architecture docs (this file)
│
├── pnpm-workspace.yaml
├── turbo.json
├── package.json
└── .env.example
```

### 4.2 Package Boundaries

| Package | Depends On | Used By | Key Rule |
|---------|-----------|---------|----------|
| `@ats/shared` | nothing | everything | Zero-dependency shared types, enums, utils |
| `@ats/database` | `@ats/shared` | api, worker | Prisma schema + client + NestJS module |
| `@ats/ai-engine` | `@ats/shared` | worker | **Zero DB dependency**. Receives context → returns result. |
| `@ats/channel-adapters` | `@ats/shared` | api, worker | Adapter interface: `normalizeInbound()` + `sendOutbound()` |

| App | Depends On | Key Rule |
|-----|-----------|----------|
| `@ats/api` | database, shared, channel-adapters | REST API, webhook receivers, no direct LLM calls |
| `@ats/worker` | database, shared, ai-engine, channel-adapters | Message processing, AI pipeline, scheduled jobs |
| `@ats/web` | **shared only** | Never imports database or ai-engine. API client + SWR. |

**Rule of Two**: If only one app uses code, keep it in the app. If two+ apps need it, extract to a package.

### 4.3 Internal Package Naming

All packages use `@ats/` scope (AI Top Sales):

```typescript
import { TenantPlan, ContactStatus } from '@ats/shared';
import { PrismaService } from '@ats/database';
import { processMessage } from '@ats/ai-engine';
import { getAdapter } from '@ats/channel-adapters';
```

---

## 5. Backend Module Architecture

### 5.1 NestJS Module Map

23 modules organized by layer. Each module follows the pattern: `module.ts` + `controller.ts` + `service.ts` + `dto/`.

```
apps/api/src/modules/

─── PLATFORM ───────────────────────────────────
auth/              Login, register, JWT, API keys
tenants/           Tenant + TenantSettings CRUD
users/             Team member CRUD
channels/          Channel config CRUD

─── CORE CRM ───────────────────────────────────
contacts/          Customer/lead records
conversations/     Conversation threads
messages/          Message CRUD + human agent send
orders/            Order + line items
bookings/          Bookings + calendar

─── TASKS & NOTIFICATIONS ──────────────────────
follow-ups/        Follow-up task management
reminders/         Reminder scheduling
notifications/     In-app + email notifications

─── KNOWLEDGE & CONFIG ─────────────────────────
knowledge-base/    FAQ / product / pricing docs
sales-playbooks/   Multi-step sales flows            [Phase 2]
objection-rules/   Objection patterns + strategies   [Phase 2]
upsell-rules/      Upsell trigger rules              [Phase 3]

─── AI & ANALYTICS ─────────────────────────────
ai-runs/           AI execution audit logs
scoring/           Lead scoring rules + computation  [Phase 2]
handoffs/          Human handoff lifecycle           [Phase 2]
objection-events/  Objection event logs              [Phase 2]
decision-profiles/ Decision identity profiles        [Phase 3]
analytics/         Advanced analytics                [Phase 3]

─── INGRESS ────────────────────────────────────
webhooks/          Webhook receivers (WhatsApp, web chat, IG, FB)
dashboard/         Aggregated stats queries
```

### 5.2 Module Communication Rules

| Pattern | When | Example |
|---------|------|---------|
| **Direct service call** | Same transaction, tightly related | `conversations` → `contacts` (upsert) |
| **BullMQ event** | Async side effects, cross-cutting | `message.inbound` → worker → AI pipeline |
| **Worker orchestration** | Complex multi-step flows | Full inbound message processing (10 steps) |

**Domains that must NOT know each other**: `channels` ↔ `orders` (transport ≠ business), `auth` ↔ `conversations` (identity ≠ business), `notifications` ↔ `ai-runs` (delivery ≠ observability).

### 5.3 Cross-Cutting Concerns

```
apps/api/src/common/
├── guards/
│   ├── jwt-auth.guard.ts          JWT authentication
│   ├── roles.guard.ts             RBAC (OWNER, ADMIN, AGENT)
│   └── tenant.guard.ts            Inject tenantId into request
├── decorators/
│   ├── @CurrentUser()              Extract user from JWT
│   ├── @CurrentTenant()            Extract tenantId from JWT
│   └── @Roles('OWNER', 'ADMIN')   Role-based access
├── interceptors/
│   ├── logging.interceptor.ts     Request/response logging
│   └── transform.interceptor.ts   Standardize response envelope
├── filters/
│   └── http-exception.filter.ts   Global error formatting
└── middleware/
    └── tenant-resolution.middleware.ts
```

**API Response Envelope** (all endpoints):
```json
{
  "success": true,
  "data": { ... },
  "pagination": { "page": 1, "limit": 20, "total": 156, "totalPages": 8 },
  "error": null
}
```

---

## 6. AI Engine Architecture

### 6.1 Core Philosophy

A human top sales person does 6 things:
1. **Read the room** — detect intent, emotion, urgency, buying signals, objections
2. **Know the customer** — recall history, preferences, decision style
3. **Choose a play** — decide the best strategy for this moment
4. **Execute the play** — say the right thing, in the right tone
5. **Record everything** — update CRM, note follow-ups
6. **Know when to escalate** — hand off when appropriate

Our AI engine replicates this as a **15-layer pipeline**.

### 6.2 Pipeline Overview

```
Inbound Message
      │
      ▼
 L1   Context Assembler          [CODE]     Gather tenant config, contact, history, knowledge
 L2   Knowledge Retriever        [CODE]     Find relevant FAQ / product docs (keyword → vector in P2)
 L3   Signal Extractor           [LLM]      Extract intent, sentiment, entities, objections
 L4   Intent Classifier          [CODE]     Map to canonical intent enum + rule overrides
 L5   Objection Classifier       [CODE]     Match against tenant objection rules (P2+)
 L6   Lead State Engine          [CODE]     FSM: evaluate state transition (P2+)
 L7   Decision Engine            [CODE]     Choose strategy: FAQ? collect info? book? handle objection?
 L8   Strategy Executor          [CODE]     Run selected strategy module
 L9   Response Generator         [LLM]      Generate natural language response
 L10  Tone & Persona             [CODE]     Apply tenant tone + customer identity (P3)
 L11  Closing Reinforcement      [LLM]      Emotional closing techniques (P3, conditional)
 L12  Upsell Evaluator           [CODE]     Check upsell rules, inject offer (P3)
 L13  Guardrails                 [CODE]     Validate: pricing, length, language, safety
 L14  Handoff Evaluator          [CODE]     Should this go to a human?
 L15  Side Effect Collector      [CODE]     Aggregate CRM updates, bookings, follow-ups
      │
      ▼
 AiEngineResult (response text + side effects + analytics data)
```

### 6.3 Code vs LLM Responsibility Split

**Only 2-3 layers call the LLM. The other 12 are deterministic code.**

| LLM (understands language) | Code (makes decisions) |
|---------------------------|----------------------|
| L3: Signal extraction | L4-L8: Classification, routing, strategy selection |
| L9: Response generation | L10, L12-L15: Validation, guardrails, side effects |
| L11: Closing refinement (P3) | L1-L2: Data assembly, knowledge retrieval |

**Why this split?** Routing decisions must be deterministic, auditable, and testable. The LLM extracts signals and generates text. Everything in between is code that can be unit-tested, logged, and debugged without calling an LLM.

### 6.4 LLM Call Budget

| Phase | LLM Calls / Turn | Latency Target | Cost Target |
|-------|-------------------|----------------|-------------|
| Phase 1 | 1 (combined extraction + response) | < 3s | ~$0.005 |
| Phase 2 | 2 (extraction + response) | < 4s | ~$0.008 |
| Phase 3 | 2-3 (+ optional closing) | < 5s | ~$0.015 |

### 6.5 Strategies (16 total across phases)

| Phase | Strategies |
|-------|-----------|
| **Phase 1** (8) | Greeting, FAQ Answer, Collect Info, Guide Booking, Guide Order, Process Info, Off-Hours Reply, General Chat |
| **Phase 2** (+4) | Handle Objection, Push CTA, Execute Playbook Step, Initiate Handoff |
| **Phase 3** (+4) | Upsell, Trust Repair, Closing Reinforcement, Challenger Reframe |

### 6.6 AI Engine Contract

The AI engine is a **pure function** — zero database dependency.

```typescript
async function processMessage(input: AiEngineInput): Promise<AiEngineResult>;
```

**Input**: tenant config, contact profile, conversation history, current message, knowledge docs, objection rules, playbook state, scoring rules, decision profile.

**Output**: response text, extracted signals, lead state update, objection detection, handoff decision, CRM update payload, follow-up recommendation, AI run metrics.

The **worker** assembles the input and executes the output side effects. The AI engine never touches the database.

### 6.7 AI Engine File Structure

```
packages/ai-engine/src/
├── orchestrator.ts                Main entry: processMessage()
├── pipeline/
│   ├── L01-context-assembler.ts through L15-side-effect-collector.ts
├── strategies/
│   ├── greeting.strategy.ts through challenger-reframe.strategy.ts (16 files)
├── prompts/
│   ├── system/                    Base role + tone variant templates
│   ├── extraction/                Signal extraction prompts (v1, v2, v3)
│   └── instructions/              Per-strategy instruction templates
├── llm/
│   ├── llm-client.interface.ts    Swappable LLM provider
│   ├── openai-client.ts           OpenAI implementation
│   └── llm-cache.ts               Redis FAQ response cache
├── rules/                         Default FSM transitions, scoring defaults
└── types/                         Input, output, signal, strategy, side-effect types
```

---

## 7. Data Model Overview

### 7.1 Model Count by Phase

| Phase | New Models | Running Total |
|-------|-----------|---------------|
| Phase 1 | 15 | 15 |
| Phase 2 | +7 | 22 |
| Phase 3 | +2 | 24 |

### 7.2 Entity Relationship Diagram

```
Tenant ─┬─ 1:1 ── TenantSettings
        ├─ 1:N ── User
        ├─ 1:N ── Channel
        ├─ 1:N ── KnowledgeDocument
        ├─ 1:N ── SalesPlaybook ── 1:N ── PlaybookStep        [P2]
        ├─ 1:N ── ObjectionRule                                 [P2]
        ├─ 1:N ── ScoringRule                                   [P2]
        ├─ 1:N ── UpsellRule                                    [P3]
        │
        └─ 1:N ── Contact ─┬─ 1:N ── Conversation ─┬─ 1:N ── Message
                            │           │            ├─ 1:N ── AiRun
                            │           │            ├─ 1:N ── FollowUpTask ── 0:N ── Reminder
                            │           │            ├─ 0:N ── HandoffLog      [P2]
                            │           │            └─ 0:N ── ObjectionEvent  [P2]
                            │           └─ N:1 ── Channel
                            │
                            ├─ 1:N ── Order (── items JSON in P1)
                            ├─ 1:N ── Booking ── 0:N ── Reminder
                            ├─ 0:1 ── LeadScore                [P2]
                            └─ 0:1 ── DecisionIdentityProfile  [P3]

User ── 1:N ── Notification
```

### 7.3 Phase 1 Models (15)

| Model | Key Fields | Notes |
|-------|-----------|-------|
| **Tenant** | name, slug, plan, industry, status | Multi-tenant root |
| **TenantSettings** | businessName, language, aiTone, aiGreeting, businessHours, collectFields | 1:1 with Tenant. AI behavior config. |
| **User** | email, name, role (OWNER/ADMIN/AGENT), passwordHash | Team members |
| **Channel** | type (WHATSAPP/WEB_CHAT/...), credentials (encrypted JSON) | Channel connections |
| **Contact** | name, phone, email, externalIds (JSON), tags, customFields, status | Customer records |
| **Conversation** | contactId, channelId, status, leadState, summary, lastMessageAt | Thread anchor. leadState defaults to NEW in P1. |
| **Message** | conversationId, direction, senderType, content, contentType | Immutable, append-only |
| **Order** | contactId, orderNumber, status, items (JSON in P1), totalAmount | Lightweight order tracking |
| **Booking** | contactId, title, startAt, endAt, status, serviceName, price | Appointment records |
| **FollowUpTask** | contactId, type, title, reason, dueAt, status, priority | Scheduled tasks |
| **Reminder** | targetType, targetId, recipientUserId, scheduledAt, status | Reminder delivery |
| **Notification** | userId, type, title, linkType, linkId, isRead | In-app notifications |
| **KnowledgeDocument** | title, content, category, tags, isActive, tokenCount | AI knowledge source |
| **AiRun** | conversationId, model, tokens, latencyMs, strategy, extractedSignals (JSON) | AI audit log |

### 7.4 Phase 2 Models (+7)

| Model | Purpose |
|-------|---------|
| **SalesPlaybook** + **PlaybookStep** | Configurable multi-step sales flows |
| **ObjectionRule** | Objection patterns + response strategies |
| **ObjectionEvent** | Runtime objection event log with outcome tracking |
| **HandoffLog** | Human handoff lifecycle (trigger → assign → resolve) |
| **LeadScore** | Composite score per contact (engagement, intent, fit, recency) |
| **ScoringRule** | Configurable scoring dimensions |

### 7.5 Phase 3 Models (+2)

| Model | Purpose |
|-------|---------|
| **DecisionIdentityProfile** | Customer decision style (analytical/driver/expressive/amiable) |
| **UpsellRule** | Upsell/cross-sell/bundle trigger conditions + offer templates |

### 7.6 Prisma Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| ID strategy | `cuid()` | Shorter than UUID, sortable, URL-safe |
| Money fields | `Decimal(10,2)` | Precision for currency, not Float |
| Enums | Prisma `enum` | Type-safe, DB-enforced |
| JSON fields | For dynamic/config data | `customFields`, `businessHours`, `credentials`, `extractedSignals` |
| Tenant scoping | `tenantId` on every table | Prisma middleware auto-injects |
| Phase 2/3 fields on P1 models | Present but nullable | Avoids migration later (`leadScore`, `activePlaybookId`) |
| Phase 2/3 tables | Created via migration when code is ready | Don't create unused tables |
| All Phase 2/3 enums | Defined from day 1 | Avoids `ALTER TYPE ADD VALUE` migrations |

---

## 8. Frontend Architecture

### 8.1 Design Philosophy

The dashboard is the **command center** for a business owner managing their AI sales employee. Every screen answers one question:

| Question | Screen |
|----------|--------|
| What's happening right now? | Dashboard, Conversation inbox |
| Who are my customers? | Contacts |
| What has the AI done? | Conversations, AI annotations |
| What needs my attention? | Follow-ups, Handoffs |
| What's coming up? | Bookings calendar |
| How do I teach the AI? | Knowledge base, Playbooks |

### 8.2 Page Map by Phase

**Phase 1 (18 pages)**: login, register, dashboard, conversations (list + detail), contacts (list + detail), orders (list + detail), bookings (list + detail), follow-ups, knowledge base (list + new + edit), settings (general + AI + team + channels)

**Phase 2 (+6)**: pipeline (Kanban), handoff queue, playbooks (list + editor), objection rules, scoring config

**Phase 3 (+4)**: analytics (overview + AI performance + conversions), upsell rules

### 8.3 Core Screen: Conversation Inbox

The conversation inbox is a **split view** (list left, thread right) — the screen the boss uses most.

- Left panel: scrollable conversation list with preview, status badge, time
- Right panel: message thread (customer left, AI right, human-agent right/green)
- Right sidebar: contact card, AI strategy badge, lead state, action buttons (assign, close, handoff)
- Human agent can type a message to take over from AI

### 8.4 Layout Patterns

| Pattern | Pages |
|---------|-------|
| **Split view** | Conversations |
| **Data table** | Contacts, Orders, Follow-ups |
| **Calendar** | Bookings |
| **Card grid** | Dashboard, Knowledge base |
| **Kanban** | Pipeline (Phase 2) |
| **Form** | Settings, Knowledge doc editor |
| **Timeline** | Contact detail activity tab |

### 8.5 Tech Choices

| Concern | Choice |
|---------|--------|
| CSS | Tailwind CSS 4 |
| Components | shadcn/ui (copied, not dependency) |
| Icons | Lucide React |
| Data fetching | SWR (stale-while-revalidate) |
| Client state | Zustand (auth only; server data in SWR) |
| Forms | React Hook Form + Zod |
| Dates | date-fns (zh-HK locale) |
| Toast | Sonner |

### 8.6 Folder Structure

```
apps/web/
├── app/
│   ├── (auth)/              Public: login, register
│   ├── (dashboard)/         Protected: all dashboard pages
│   │   ├── page.tsx         Dashboard home
│   │   ├── conversations/   Inbox
│   │   ├── contacts/        CRM
│   │   ├── orders/
│   │   ├── bookings/
│   │   ├── follow-ups/
│   │   ├── knowledge-base/
│   │   └── settings/
│   └── chat-widget/         Embeddable web chat (standalone)
├── components/
│   ├── ui/                  shadcn/ui primitives
│   ├── layout/              Sidebar, topbar, mobile-nav
│   ├── shared/              Data-table, status-badge, pagination
│   ├── conversations/       Domain components
│   ├── contacts/
│   ├── bookings/
│   ├── dashboard/
│   └── settings/
├── hooks/                   use-api, use-auth, use-conversations, ...
├── lib/                     api-client, auth, utils
├── stores/                  auth-store (Zustand)
└── types/                   API response types (not Prisma types)
```

### 8.7 Feature Gating

Sidebar items and pages check `tenant.plan`:
- **Starter**: 18 pages visible
- **Growth**: +6 pages unlocked
- **Elite**: all pages

Higher-tier items are hidden (not grayed), keeping the UI clean.

---

## 9. Integrations Strategy

### 9.1 Channel Adapters

Each channel implements a common interface:

```typescript
interface ChannelAdapter {
  normalizeInbound(rawPayload: unknown): NormalizedMessage;
  sendOutbound(config: ChannelConfig, message: OutboundMessage): Promise<void>;
  verifyWebhook?(req: unknown): boolean;
}
```

| Channel | Phase | Adapter | Auth Method |
|---------|-------|---------|-------------|
| WhatsApp Cloud API | 1 | `whatsapp.adapter.ts` | Webhook verify token + message signature |
| Web Chat | 1 | `web-chat.adapter.ts` | API key per tenant |
| Instagram DM | 2 | `instagram.adapter.ts` | Facebook Page token |
| Facebook Messenger | 2 | `facebook.adapter.ts` | Facebook Page token |

### 9.2 LLM Integration

```typescript
interface LlmClient {
  chatCompletion(messages: ChatMessage[], options: LlmOptions): Promise<LlmResponse>;
}
```

- Default: OpenAI API (`gpt-4o-mini` for most calls, `gpt-4o` for complex P3 tasks)
- Interface is swappable for Anthropic, local models, or other providers
- Token counting and cost estimation built in

### 9.3 Notification Providers

| Channel | Phase | Provider |
|---------|-------|----------|
| In-app | 1 | Database (Notification table) + polling |
| Email | 1 | Resend or Nodemailer |
| Push notifications | 2 | Web Push API |
| SMS | 2+ | Twilio (if needed) |

### 9.4 Future Integrations (Not in Scope)

- Payment gateway (Stripe) — post-Phase 1 billing
- Calendar sync (Google Calendar) — Phase 2 stretch
- File storage (S3/R2) — when image messages are supported
- Analytics (Mixpanel/PostHog) — Phase 3

---

## 10. Multi-Tenant Strategy

### 10.1 Approach: Shared Database, Tenant-Scoped Rows

Every table (except `Tenant`) has a `tenantId` column. Isolation is enforced at three levels:

| Level | Mechanism | Purpose |
|-------|-----------|---------|
| **Application** | Prisma middleware auto-injects `tenantId` into every query | Developer-proof — forgetting `WHERE tenantId` is impossible |
| **Framework** | NestJS `TenantGuard` extracts tenantId from JWT and sets request context | Every API request is tenant-scoped |
| **Database** | PostgreSQL Row-Level Security (RLS) as safety net | Defense-in-depth, catch any middleware bypass |

### 10.2 Tenant Resolution

```
JWT token → decode → { userId, tenantId, role }
                              ↓
                   Set in request context
                              ↓
           Prisma middleware reads from context
                              ↓
         All queries get: WHERE tenant_id = $tenantId
```

For webhook endpoints (no JWT): resolve tenant from channel config (phone number → channel → tenantId).

### 10.3 Tenant-Scoped Caching

Redis keys include tenantId:
```
tenant:config:{tenantId}        → TenantSettings (TTL 5min)
tenant:knowledge:{tenantId}     → KnowledgeDocument[] (TTL 5min)
tenant:rules:{tenantId}         → ObjectionRule[] (TTL 5min)
```

Cache invalidated on settings/knowledge/rules update via API.

### 10.4 Plan-Based Limits

| Limit | Starter | Growth | Elite |
|-------|---------|--------|-------|
| Team members | 3 | 10 | Unlimited |
| Contacts | 500 | 5,000 | Unlimited |
| Messages/month | 2,000 | 20,000 | Unlimited |
| Knowledge docs | 20 | 100 | Unlimited |
| Channels | 2 | 5 | Unlimited |
| API rate limit | 100/min | 500/min | 2,000/min |

Enforced in NestJS guards + Prisma middleware.

---

## 11. Configuration Strategy

### 11.1 Configuration Layers

```
Code (shared, never changes per customer)
  └── Default Config (built-in defaults)
       └── Tenant Settings (DB, per-tenant)
            └── Knowledge Base (DB, per-tenant, AI reads these)
                 └── Rules (DB, per-tenant: objection, scoring, upsell)
                      └── Playbooks (DB, per-tenant, multi-step flows)
```

### 11.2 What is Configurable (per-tenant)

| Category | Fields | Storage |
|----------|--------|---------|
| **Identity** | businessName, businessDescription, roleName, roleDescription | TenantSettings |
| **Tone** | aiTone (friendly/professional/casual/luxury), aiGreeting, aiFarewell | TenantSettings |
| **Language** | language (zh-HK, en, zh-TW), timezone, currency | TenantSettings |
| **AI Behavior** | aiModel, aiTemperature, maxTokens, conversationWindowSize | TenantSettings |
| **Collection** | collectFields (name, phone, email, ...) | TenantSettings |
| **Business** | businessHours, bookingSlotDuration, bookingLeadTime | TenantSettings |
| **Handoff** | autoHandoffEnabled, handoffThreshold, handoffKeywords | TenantSettings |
| **Knowledge** | FAQ docs, product info, pricing, policies | KnowledgeDocument rows |
| **Objections** | Patterns, categories, strategies, response templates | ObjectionRule rows |
| **Playbooks** | Multi-step sales flows, trigger conditions | SalesPlaybook + PlaybookStep rows |
| **Scoring** | Scoring dimensions, conditions, impact weights | ScoringRule rows |
| **Upsell** | Trigger conditions, offer templates, discount config | UpsellRule rows |
| **Channels** | Per-channel format constraints, max length, emoji policy | Channel.config JSON |

### 11.3 Configuration Loading

All tenant configuration is loaded once per inbound message, cached in Redis (5-minute TTL), and passed into the AI engine as a structured `AiEngineInput` object. Zero database queries during AI pipeline execution.

---

## 12. Implementation Plan

### 12.1 Phase 1 Sprint Plan (6-8 weeks)

#### Sprint 1: Foundation (Weeks 1-2)

| Task | Deliverable |
|------|------------|
| Monorepo scaffold | Turborepo + pnpm + TypeScript + ESLint + Prettier |
| Infrastructure | Docker Compose (PostgreSQL + Redis), .env setup |
| Prisma schema | 15 models, all enums, seed script |
| NestJS scaffold | App structure, common guards/interceptors/filters |
| Auth module | Register (create tenant + owner), login, JWT, /me |
| Tenant module | CRUD + settings |
| Multi-tenant middleware | JWT → tenantId → Prisma scope |
| User module | Team member CRUD |

#### Sprint 2: Core CRM (Weeks 3-4)

| Task | Deliverable |
|------|------------|
| Contact module | CRUD + auto-create from messages |
| Conversation module | CRUD + status management |
| Message module | CRUD + human agent send |
| Channel module | CRUD + WhatsApp/web chat config |
| Order module | Basic CRUD |
| Booking module | CRUD + calendar query |
| Follow-up module | CRUD + status management |
| Reminder module | CRUD + worker scheduler |
| Notification module | In-app notifications |
| Knowledge base module | Document CRUD |

#### Sprint 3: AI Engine + Channels (Weeks 5-6)

| Task | Deliverable |
|------|------------|
| AI Engine v1 | L1 (context), L2 (keyword search), L3+L9 (combined LLM), L7 (basic decision), L13 (guardrails), L15 (side effects) |
| Strategies (8) | Greeting, FAQ, Collect Info, Guide Booking, Guide Order, Process Info, Off-Hours, General Chat |
| Web chat adapter | Inbound + outbound |
| WhatsApp adapter | Webhook + Cloud API send |
| BullMQ worker | Message processor, reminder checker, follow-up checker, channel sender |
| Webhook endpoints | /webhooks/whatsapp, /webhooks/web-chat |
| AiRun logging | Log every AI execution |

#### Sprint 4: Frontend + Polish (Weeks 7-8)

| Task | Deliverable |
|------|------------|
| Next.js scaffold | App Router, Tailwind, shadcn/ui, auth flow |
| Dashboard | Stat cards, recent conversations, upcoming bookings |
| Conversation inbox | Split view, message thread, contact sidebar |
| Contact list + detail | Table, profile, timeline |
| Booking list + calendar | Calendar view, list view, status actions |
| Order list + detail | Table, detail card |
| Follow-up list | Task table with filters |
| Knowledge base | Document list, editor |
| Settings | General, AI config, team, channels |
| Web chat widget | Embeddable iframe |
| Mobile responsive | Key pages work on mobile |
| Demo polish | Loading states, empty states, error handling |

### 12.2 Phase 1 Exit Criteria

- [ ] A tenant can register, configure AI settings, and add knowledge documents
- [ ] A customer can send a WhatsApp message and receive an AI response within 5 seconds
- [ ] AI correctly answers FAQ questions from knowledge base
- [ ] AI collects customer name and phone through natural conversation
- [ ] AI creates a booking when customer requests an appointment
- [ ] Boss sees all conversations in the dashboard with AI-generated summaries
- [ ] Boss receives reminders for upcoming bookings
- [ ] Follow-up tasks are created and tracked
- [ ] System handles 10 concurrent tenants without issues

### 12.3 Phase 2 Sprint Plan (High Level)

| Sprint | Focus |
|--------|-------|
| P2-S1 (Weeks 1-2) | Lead scoring, playbook schema, objection rules schema, handoff schema |
| P2-S2 (Weeks 3-4) | AI Engine v2: split extraction, objection handling, CTA push, playbook execution |
| P2-S3 (Weeks 5-6) | Handoff flow, Instagram adapter, Facebook adapter |
| P2-S4 (Weeks 7-8) | Pipeline Kanban, handoff queue, playbook editor, vector search |

### 12.4 Phase 3 Sprint Plan (High Level)

| Sprint | Focus |
|--------|-------|
| P3-S1 (Weeks 1-3) | Decision identity profiling, tone adaptation, upsell rules |
| P3-S2 (Weeks 4-6) | Closing reinforcement, multi-turn objection, trust repair |
| P3-S3 (Weeks 7-9) | Analytics dashboard, conversion funnels, strategy tracking |
| P3-S4 (Weeks 10-12) | Prompt A/B testing, learning loop, performance optimization |

---

## Appendix A: Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_top_sales

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth
JWT_SECRET=<random-secret>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_DEFAULT_MODEL=gpt-4o-mini

# WhatsApp Cloud API
WHATSAPP_API_URL=https://graph.facebook.com/v21.0
WHATSAPP_VERIFY_TOKEN=<webhook-verify-token>

# App URLs
NEXT_PUBLIC_API_URL=http://localhost:3001
APP_URL=http://localhost:3000
API_PORT=3001
```

## Appendix B: Design Principles

1. **Configuration over Code** — Sales logic is data/config, not hardcoded. Zero code changes to customize per tenant.
2. **Layered AI, Not Monolithic Prompts** — 15-layer pipeline, each with a single job. No God Prompt.
3. **Phase-Compatible Architecture** — Every Phase 1 module has Phase 2/3 extension points.
4. **Tenant Isolation by Default** — Framework-enforced, not developer-dependent.
5. **Async by Design** — All AI processing is queue-based. API server stays fast.
6. **Observable** — Every AI run is logged. Data foundation for analytics and learning.
7. **Human-in-the-Loop** — Architecture supports human takeover from Phase 1.

## Appendix C: Anti-Patterns We Avoid

- **No God Prompt** — Decision Engine selects focused strategy; only relevant template injected.
- **No Hardcoded Industry Logic** — No `if (industry === 'beauty')` branches.
- **No Sync LLM in Request Path** — All AI through message queue.
- **No Direct DB in AI Engine** — Engine returns side effects as data; worker executes.
- **No Feature Flags via Code Comments** — Plan-based feature gating in framework guards.

## Appendix D: Key API Endpoints (Phase 1)

```
POST   /auth/register           POST   /auth/login
POST   /auth/refresh            GET    /auth/me

GET    /tenants/current         PATCH  /tenants/current/settings

GET    /contacts                GET    /contacts/:id
POST   /contacts                PATCH  /contacts/:id

GET    /conversations           GET    /conversations/:id
GET    /conversations/:id/messages
POST   /conversations/:id/messages      (human agent)

GET    /orders                  POST   /orders
PATCH  /orders/:id

GET    /bookings                POST   /bookings
PATCH  /bookings/:id            GET    /bookings/calendar

GET    /follow-ups              POST   /follow-ups
PATCH  /follow-ups/:id

GET    /knowledge-base          POST   /knowledge-base
PATCH  /knowledge-base/:id      DELETE /knowledge-base/:id

GET    /channels                POST   /channels
PATCH  /channels/:id

GET    /notifications           PATCH  /notifications/:id/read
GET    /dashboard/overview

POST   /webhooks/whatsapp       POST   /webhooks/web-chat
```

---

> **This document consolidates**: ARCHITECTURE.md, MONOREPO-STRUCTURE.md, BACKEND-DOMAIN-DESIGN.md, AI-ENGINE-SPEC.md, FRONTEND-SPEC.md, and PRISMA-SCHEMA-PLAN.md into a single engineering-ready reference.
>
> For deep dives into any section, refer to the individual documents in `/docs/`.
