# AI Top Sales - Backend Domain Design

> Version: 0.1 | Date: 2026-03-19
> Depends on: [ARCHITECTURE.md](./ARCHITECTURE.md) / [MONOREPO-STRUCTURE.md](./MONOREPO-STRUCTURE.md)

---

## 1. Core Domains

22 domains, organized by layer. Each domain maps to one NestJS module.

### Platform Layer (system-level, no business logic)

| # | Domain | Responsibility | Key Entity |
|---|--------|---------------|------------|
| 1 | **auth** | Login, register, JWT issue/refresh/revoke, password reset, API key management | — (uses User) |
| 2 | **tenants** | Tenant lifecycle (create, suspend, upgrade plan), tenant settings (business info, AI config, business hours, tone) | Tenant, TenantSettings |
| 3 | **users** | Team member CRUD within a tenant (owner, admin, agent), invite flow, role management | User |
| 4 | **channels** | Channel configuration (connect WhatsApp number, IG page, web chat widget), credentials storage (encrypted), channel health check | Channel |

### Core CRM Layer (customer-facing business data)

| # | Domain | Responsibility | Key Entity |
|---|--------|---------------|------------|
| 5 | **contacts** | Customer/lead master records. Auto-created from channel messages. Merge duplicates. Store tags, custom fields, lifecycle status. Single source of truth for "who is this person?" | Contact |
| 6 | **conversations** | Conversation threads. One per contact-channel pair. Track status (open/closed/handed-off), lead state, AI-generated summary. The anchor for all message-level activity. | Conversation |
| 7 | **messages** | Individual messages within conversations. Inbound (customer), outbound (AI or human). Content type (text, image, audio). Immutable after creation. | Message |
| 8 | **orders** | Simple order records created from conversations. Line items, amount, status tracking. Not a full e-commerce engine — a lightweight record of "customer wants to buy X". | Order, OrderItem |
| 9 | **bookings** | Appointment / reservation records. Date, time, status, location. Linked to contact + conversation. Triggers reminders. | Booking |

### Task & Notification Layer (proactive outreach)

| # | Domain | Responsibility | Key Entity |
|---|--------|---------------|------------|
| 10 | **follow-ups** | Scheduled follow-up tasks (call, message, email). Assigned to a team member. Tracks due date, overdue escalation. AI or human can create them. | FollowUpTask |
| 11 | **reminders** | Automated reminders tied to bookings, follow-ups, orders. Scheduled delivery via email/push/in-app. Worker checks and fires them. | Reminder |
| 12 | **notifications** | In-app notifications, email delivery, push notifications. Generic notification sink consumed by dashboard and email provider. | Notification |

### Knowledge & Config Layer (AI behavior configuration)

| # | Domain | Responsibility | Key Entity |
|---|--------|---------------|------------|
| 13 | **knowledge-base** | FAQ documents, product info, policies, pricing. Tenant-managed. Used by AI engine for context. Phase 2: vector embeddings for semantic search. | KnowledgeDocument |
| 14 | **sales-playbooks** | Multi-step sales flows. Trigger conditions, ordered steps, actions per step. Configurable per tenant. The "script" AI follows for guided selling. | SalesPlaybook, PlaybookStep |
| 15 | **objection-rules** | Objection pattern definitions + response strategies. Category (price/trust/timing), strategy (reframe/social-proof/empathy), response template. | ObjectionRule |
| 16 | **upsell-rules** | Upsell / cross-sell / quantity-upsell trigger conditions + offer templates. | UpsellRule |

### AI & Analytics Layer (intelligence + observability)

| # | Domain | Responsibility | Key Entity |
|---|--------|---------------|------------|
| 17 | **ai-runs** | Audit log of every AI execution. Model used, tokens, latency, cost, input/output snapshot, extracted signals, which rules fired. Essential for debugging, analytics, and cost tracking. | AiRun |
| 18 | **scoring** | Lead scoring engine. Configurable rules (engagement score, recency, intent strength). Computes and stores per-contact scores. | LeadScore, ScoringRule |
| 19 | **decision-profiles** | Decision identity profiling per contact (analytical/driver/expressive/amiable). AI detects from conversation patterns. Used by tone adaptation engine. | DecisionIdentityProfile |
| 20 | **handoffs** | Human handoff lifecycle. Trigger (AI uncertainty, customer request, escalation), context summary for human agent, assignment, resolution tracking. | HandoffLog |
| 21 | **objection-events** | Event log of detected objections and how they were handled. Outcome tracking (resolved / escalated / lost). Feeds analytics + objection rule refinement. | ObjectionEvent |

### Dashboard & Ingress Layer

| # | Domain | Responsibility | Key Entity |
|---|--------|---------------|------------|
| 22 | **dashboard** | Aggregated stats, KPIs, charts. No own entities — queries across domains. | — |
| 23 | **webhooks** | Inbound webhook receivers for channels. Normalizes raw payloads, enqueues for processing. Stateless. | — |

---

## 2. Domain Boundaries

### 2.1 Dependency Map

```
                        ┌─────────────────────────────────────────────┐
                        │              PLATFORM LAYER                 │
                        │                                             │
                        │   auth ──► tenants ──► users                │
                        │                         │                   │
                        │              channels ──┘                   │
                        └────────────────┬────────────────────────────┘
                                         │ tenantId + userId context
                        ┌────────────────▼────────────────────────────┐
                        │             CORE CRM LAYER                  │
                        │                                             │
                        │   contacts ◄──► conversations ◄──► messages │
                        │      │              │                       │
                        │      ▼              ▼                       │
                        │   orders         follow-ups                 │
                        │   bookings          │                       │
                        │                     ▼                       │
                        │                 reminders ──► notifications │
                        └────────────────┬────────────────────────────┘
                                         │ contact + conversation refs
                        ┌────────────────▼────────────────────────────┐
                        │        KNOWLEDGE & CONFIG LAYER             │
                        │                                             │
                        │   knowledge-base                            │
                        │   sales-playbooks                           │
                        │   objection-rules                           │
                        │   upsell-rules                              │
                        └────────────────┬────────────────────────────┘
                                         │ config + rules consumed by AI
                        ┌────────────────▼────────────────────────────┐
                        │         AI & ANALYTICS LAYER                │
                        │                                             │
                        │   scoring ──► decision-profiles              │
                        │   ai-runs                                   │
                        │   objection-events                          │
                        │   handoffs                                  │
                        └─────────────────────────────────────────────┘
```

### 2.2 Coupling Rules

#### Direct Service Injection (tight coupling, OK)

These domains are closely related and may call each other's services synchronously within the same request/transaction:

| Caller | Callee | Why direct is OK |
|--------|--------|-----------------|
| conversations | contacts | Creating a conversation requires finding/creating a contact |
| conversations | messages | Conversation manages its messages |
| messages | conversations | Storing a message updates conversation.lastMessageAt |
| follow-ups | reminders | Creating a follow-up often creates a reminder |
| reminders | notifications | Firing a reminder creates a notification |
| bookings | reminders | Creating a booking auto-creates a reminder |
| tenants | users | Tenant creation creates the owner user |
| webhooks | channels | Webhook handler looks up channel config |

#### Event-Driven (loose coupling, MUST)

These domains should communicate via BullMQ job events, never direct service calls:

| Event | Producer | Consumers | Why async |
|-------|----------|-----------|-----------|
| `message.inbound` | webhooks | **worker** (AI pipeline) | AI processing is slow; must not block webhook response |
| `message.outbound.ready` | worker (AI pipeline) | **channel-send worker** | Sending to WhatsApp/IG is external I/O |
| `ai.run.completed` | worker (AI pipeline) | **ai-runs** (log), **scoring** (update score), **objection-events** (log if objection detected) | Multiple consumers; decoupled analytics |
| `booking.created` | bookings | **reminders** (auto-schedule) | Reminder scheduling is a side effect |
| `followup.overdue` | worker (cron) | **notifications** (alert boss) | Scheduled check, not user-triggered |
| `reminder.due` | worker (cron) | **notifications** (send) | Scheduled delivery |
| `handoff.triggered` | worker (AI pipeline) | **handoffs** (create log), **notifications** (alert team), **conversations** (update status) | Multiple consumers |
| `contact.updated` | worker (AI side effects) | **scoring** (recalculate) | Score is a derived value |
| `conversation.closed` | conversations | **scoring** (finalize outcome), **analytics** | Post-conversation processing |

#### Workflow (multi-step, orchestrated by worker)

The AI message processing flow is orchestrated by the worker, NOT by direct domain-to-domain calls:

```
webhook controller
  → enqueue "message.inbound" job
  → return 200 immediately

worker picks up job:
  1. channels.service  → resolve channel config
  2. contacts.service  → upsert contact
  3. conversations.service → find/create conversation
  4. messages.service  → store inbound message
  5. ai-engine (package) → run pipeline, get AiResult
  6. side-effect executor:
     - contacts.service → update extracted fields
     - conversations.service → update summary, lead state
     - orders.service → create order (if AI decided)
     - bookings.service → create booking (if AI decided)
     - follow-ups.service → create follow-up (if AI decided)
     - scoring.service → update lead score (Phase 2)
     - objection-events.service → log objection (Phase 2)
     - handoffs.service → create handoff (Phase 2)
  7. messages.service → store outbound message
  8. ai-runs.service → log AI execution
  9. enqueue "message.outbound.ready" job
```

### 2.3 Domains That Must NOT Know About Each Other

| Domain A | Domain B | Why isolated |
|----------|----------|-------------|
| knowledge-base | scoring | Knowledge is static content; scoring is computed behavior |
| channels | orders | Channel adapter handles transport only; knows nothing about business entities |
| auth | conversations | Auth handles identity only; conversation logic is business concern |
| objection-rules | bookings | Objection rules are AI config; bookings are CRM records |
| notifications | ai-runs | Notification is a delivery mechanism; ai-runs is observability |
| dashboard | messages | Dashboard reads aggregated views, never individual messages directly — uses dedicated query services |

---

## 3. Entity Design

### 3.1 Platform Layer

#### Tenant

```
Tenant
├── id                  UUID (PK)
├── name                string            "美麗髮廊"
├── slug                string (unique)   "beauty-salon-001"
├── plan                TenantPlan        STARTER | GROWTH | ELITE
├── industry            string?           "beauty" | "restaurant" | "fitness" | ...
├── status              TenantStatus      ACTIVE | SUSPENDED | TRIAL
├── trialEndsAt         datetime?
├── maxUsers            int               Plan-based limit
├── maxContacts         int               Plan-based limit
├── maxMessagesPerMonth int               Plan-based limit
├── createdAt           datetime
└── updatedAt           datetime

TenantSettings (1:1)
├── id                  UUID (PK)
├── tenantId            UUID (FK, unique)
├── businessName        string            Display name for AI
├── businessDescription text              What this business does (fed to AI as context)
├── language            string            "zh-HK" | "en" | "zh-TW"
├── timezone            string            "Asia/Hong_Kong"
├── businessHours       json              { mon: "09:00-18:00", tue: "09:00-18:00", ... }
├── currency            string            "HKD"
├── aiTone              AiTone            FRIENDLY | PROFESSIONAL | CASUAL | LUXURY
├── aiGreeting          text              First message when new conversation starts
├── aiFarewell          text              Message when conversation closes
├── aiModel             string            "gpt-4o-mini"
├── aiTemperature       float             0.7
├── maxAiTokensPerTurn  int               1000
├── autoHandoffEnabled  boolean           Whether AI can trigger human handoff
├── handoffThreshold    float?            AI confidence below this → handoff (Phase 2)
├── handoffMessage      text?             Message shown when handing off
├── collectFields       string[]          ["name","phone","email"] — what AI should try to collect
├── createdAt           datetime
└── updatedAt           datetime
```

**Design note**: `collectFields` tells the AI engine which contact fields to proactively collect from customers. This replaces hardcoding "always ask for name and phone" — each tenant configures what matters to them.

#### User

```
User
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── email               string (unique per tenant)
├── name                string
├── role                UserRole          OWNER | ADMIN | AGENT
├── passwordHash        string
├── avatarUrl           string?
├── isActive            boolean           Soft-disable without delete
├── lastLoginAt         datetime?
├── createdAt           datetime
└── updatedAt           datetime

Unique constraint: (tenantId, email)
```

#### Channel

```
Channel
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── type                ChannelType       WHATSAPP | INSTAGRAM | FACEBOOK | WEB_CHAT
├── name                string            "主要 WhatsApp" (user-facing label)
├── credentials         json (encrypted)  Channel-specific: { phoneNumberId, accessToken, ... }
├── webhookSecret       string?           For verifying inbound webhooks
├── isActive            boolean
├── isVerified          boolean           Whether connection to external API is verified
├── lastSyncAt          datetime?         Last successful message sync
├── createdAt           datetime
└── updatedAt           datetime

Unique constraint: (tenantId, type, externalId-within-credentials)
```

### 3.2 Core CRM Layer

#### Contact

```
Contact
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── externalIds         json              { whatsapp: "+85291234567", instagram: "user_123" }
│                                         Allows one contact across multiple channels
├── name                string?
├── phone               string?
├── email               string?
├── company             string?
├── tags                string[]          ["VIP", "repeat-customer"]
├── customFields        json              { preference: "short hair", allergies: "none" }
├── source              ContactSource     WHATSAPP | INSTAGRAM | FACEBOOK | WEB_CHAT | MANUAL
├── status              ContactStatus     NEW | ACTIVE | INACTIVE | CONVERTED | LOST
├── firstContactAt      datetime
├── lastContactAt       datetime
├── totalConversations  int               Denormalized counter
├── totalOrders         int               Denormalized counter
├── totalSpent          decimal?          Denormalized sum (Phase 2+)
├── notes               text?             Manual notes by team
├── createdAt           datetime
└── updatedAt           datetime

Indexes:
  - (tenantId, phone)
  - (tenantId, email)
  - (tenantId, status)
  - (tenantId, lastContactAt DESC)
```

**Design note**: `externalIds` is a JSON map instead of a single `externalId + channelType` pair. This allows us to recognize the same customer across multiple channels and merge their records.

#### Conversation

```
Conversation
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── contactId           UUID (FK → Contact)
├── channelId           UUID (FK → Channel)
├── status              ConversationStatus  OPEN | WAITING | AI_ACTIVE | HANDED_OFF | CLOSED | ARCHIVED
├── assignedUserId      UUID? (FK → User)   Null = AI is handling; set = human agent assigned
├── leadState           LeadState           NEW | ENGAGED | QUALIFIED | PROPOSING | NEGOTIATING | CLOSING | WON | LOST
│                                           Phase 1: always NEW; Phase 2: FSM transitions
├── leadScore           int?                0-100, computed by scoring engine (Phase 2+)
├── summary             text?               AI-generated conversation summary, updated periodically
├── lastMessageAt       datetime
├── lastMessagePreview  string?             First 100 chars of last message (for list views)
├── messageCount        int                 Denormalized counter
├── aiMessageCount      int                 How many messages AI has sent
├── humanMessageCount   int                 How many messages human agent has sent
├── activePlaybookId    UUID? (FK → SalesPlaybook)  Currently active playbook (Phase 2+)
├── activePlaybookStep  int?                Current step in playbook (Phase 2+)
├── closedAt            datetime?
├── closedReason        string?             "resolved" | "no-response" | "converted" | "lost"
├── metadata            json                Extensible metadata bucket
├── createdAt           datetime
└── updatedAt           datetime

Indexes:
  - (tenantId, status, lastMessageAt DESC)    — Active conversations sorted by recency
  - (tenantId, contactId)                     — All conversations for a contact
  - (tenantId, assignedUserId, status)        — Agent's assigned conversations
  - (tenantId, leadState)                     — Pipeline view (Phase 2)
```

**Design note**: `status` distinguishes between `AI_ACTIVE` (AI is responding) and `WAITING` (customer hasn't replied). This lets the dashboard show "waiting for customer" vs "AI is handling".

#### Message

```
Message
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── conversationId      UUID (FK → Conversation)
├── direction           MessageDirection    INBOUND | OUTBOUND
├── senderType          MessageSenderType   CUSTOMER | AI | HUMAN_AGENT | SYSTEM
├── senderUserId        UUID? (FK → User)   Only set when senderType = HUMAN_AGENT
├── content             text
├── contentType         MessageContentType  TEXT | IMAGE | AUDIO | VIDEO | FILE | LOCATION | TEMPLATE
├── mediaUrl            string?             URL to media file (if contentType is not TEXT)
├── channelMessageId    string?             External message ID from WhatsApp/IG (for dedup + status tracking)
├── replyToMessageId    UUID? (FK → Message, self-ref)
├── metadata            json                Channel-specific metadata (reactions, read receipts, etc.)
├── isDeleted           boolean             Soft delete (if customer deletes message on channel)
├── createdAt           datetime            Immutable — messages are never updated
└── _no updatedAt_                          Messages are append-only

Indexes:
  - (conversationId, createdAt ASC)          — Message thread order
  - (tenantId, createdAt DESC)               — Global message feed (admin)
  - (channelMessageId)                       — Dedup incoming webhooks
```

**Design note**: Messages are **immutable**. No `updatedAt`. This is a log — once a message is stored, it never changes. If a message needs to be "edited" (e.g., WhatsApp edit), we store a new message with a `replyToMessageId` pointing to the original plus metadata indicating it's an edit.

#### Order

```
Order
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── contactId           UUID (FK → Contact)
├── conversationId      UUID? (FK → Conversation)   Null if created manually
├── orderNumber         string (unique per tenant)   Auto-generated: "ORD-20260319-001"
├── status              OrderStatus       DRAFT | CONFIRMED | PROCESSING | COMPLETED | CANCELLED | REFUNDED
├── source              OrderSource       AI_CREATED | HUMAN_CREATED | MANUAL
├── totalAmount         decimal?
├── currency            string            "HKD"
├── notes               text?
├── createdAt           datetime
└── updatedAt           datetime

OrderItem
├── id                  UUID (PK)
├── orderId             UUID (FK → Order)
├── name                string            Product/service name
├── quantity            int
├── unitPrice           decimal?
├── notes               string?
└── createdAt           datetime
```

**Design note**: `OrderItem` is a separate entity instead of a JSON column. This allows querying "most ordered product" and proper relational integrity. But if orders are always simple (1-2 items), a `json items` column on Order is also acceptable for Phase 1.

#### Booking

```
Booking
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── contactId           UUID (FK → Contact)
├── conversationId      UUID? (FK → Conversation)
├── bookingNumber       string (unique per tenant)   "BK-20260319-001"
├── title               string            "剪髮 - 陳小姐"
├── serviceName         string?           "剪髮" | "按摩" | ...
├── startAt             datetime
├── endAt               datetime?
├── duration            int?              Minutes
├── status              BookingStatus     PENDING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED
├── source              BookingSource     AI_CREATED | HUMAN_CREATED | MANUAL
├── location            string?
├── price               decimal?
├── currency            string            "HKD"
├── notes               text?
├── reminderSentAt      datetime?         When the last reminder was sent
├── cancelledAt         datetime?
├── cancelReason        string?
├── createdAt           datetime
└── updatedAt           datetime

Indexes:
  - (tenantId, startAt)                   — Calendar view
  - (tenantId, status, startAt)           — Upcoming confirmed bookings
  - (tenantId, contactId)                 — Customer's booking history
```

### 3.3 Task & Notification Layer

#### FollowUpTask

```
FollowUpTask
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── contactId           UUID (FK → Contact)
├── conversationId      UUID? (FK → Conversation)
├── assignedUserId      UUID? (FK → User)       Null = unassigned
├── type                FollowUpType      CALL | MESSAGE | EMAIL | TASK | REVIEW
├── title               string            Short description: "Follow up about Saturday booking"
├── reason              text              AI-generated or human-entered reason
├── source              FollowUpSource    AI_CREATED | HUMAN_CREATED
├── priority            FollowUpPriority  LOW | MEDIUM | HIGH | URGENT
├── dueAt               datetime
├── status              FollowUpStatus    PENDING | IN_PROGRESS | COMPLETED | OVERDUE | CANCELLED
├── completedAt         datetime?
├── completedByUserId   UUID? (FK → User)
├── outcome             text?             What happened when follow-up was completed
├── createdAt           datetime
└── updatedAt           datetime

Indexes:
  - (tenantId, status, dueAt)             — Pending tasks sorted by due date
  - (tenantId, assignedUserId, status)    — Agent's task list
```

#### Reminder

```
Reminder
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── targetType          ReminderTargetType  BOOKING | FOLLOW_UP | ORDER | CUSTOM
├── targetId            UUID                Polymorphic FK → the entity being reminded about
├── recipientType       ReminderRecipientType  USER | CONTACT
├── recipientId         UUID                FK → User or Contact
├── channel             ReminderChannel     EMAIL | SMS | PUSH | IN_APP | WHATSAPP
├── title               string              "Reminder: 陳小姐 booking tomorrow at 3pm"
├── message             text
├── scheduledAt         datetime
├── sentAt              datetime?
├── status              ReminderStatus      SCHEDULED | SENT | FAILED | CANCELLED | SKIPPED
├── failReason          string?
├── retryCount          int                 Default 0
├── createdAt           datetime
└── updatedAt           datetime

Indexes:
  - (status, scheduledAt)                   — Worker query: due reminders to send
  - (tenantId, targetType, targetId)        — All reminders for a specific booking/follow-up
```

**Design note**: `recipientType` + `recipientId` supports reminders to both team users (boss) AND customers (e.g., booking confirmation to customer via WhatsApp). Phase 1 focuses on user reminders; customer reminders come in Phase 2.

#### Notification

```
Notification
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── userId              UUID (FK → User)        Who receives this notification
├── type                NotificationType    NEW_MESSAGE | NEW_BOOKING | NEW_ORDER |
│                                           FOLLOW_UP_DUE | FOLLOW_UP_OVERDUE |
│                                           HANDOFF_REQUEST | REMINDER |
│                                           SYSTEM_ALERT
├── title               string              "新預約：陳小姐 - 3月20日 15:00"
├── body                text?               Optional longer description
├── linkType            string?             "conversation" | "booking" | "order" | "follow-up"
├── linkId              UUID?               ID of related entity (for click-to-navigate)
├── isRead              boolean             Default false
├── readAt              datetime?
├── createdAt           datetime
└── _no updatedAt_                          Only isRead/readAt changes

Indexes:
  - (tenantId, userId, isRead, createdAt DESC)  — Unread notifications for a user
```

### 3.4 Knowledge & Config Layer

#### KnowledgeDocument

```
KnowledgeDocument
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── title               string              "常見問題 - 剪髮價格"
├── content             text                The actual content AI will reference
├── category            string?             "FAQ" | "product" | "pricing" | "policy" | "service"
├── tags                string[]            For filtering / grouping
├── language            string              "zh-HK"
├── isActive            boolean             Inactive docs are not fed to AI
├── sortOrder           int                 Display order in dashboard
├── embedding           float[]?            Vector embedding (Phase 2, pgvector)
├── tokenCount          int?                Pre-computed token count for context window management
├── createdAt           datetime
└── updatedAt           datetime

Indexes:
  - (tenantId, isActive, category)          — Active docs by category for AI context
```

**Design note**: `tokenCount` is pre-computed when the document is saved. The AI engine uses this to pack as many relevant docs as possible into the context window without exceeding limits.

#### SalesPlaybook (Phase 2+)

```
SalesPlaybook
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── name                string              "新客戶引導流程"
├── description         text?
├── triggerConditions   json                { leadState: "NEW", intent: "inquiry", ... }
├── isDefault           boolean             Default playbook for new conversations
├── isActive            boolean
├── version             int                 For tracking edits
├── createdAt           datetime
└── updatedAt           datetime

PlaybookStep
├── id                  UUID (PK)
├── playbookId          UUID (FK → SalesPlaybook)
├── stepOrder           int                 1, 2, 3...
├── name                string              "Ask for name"
├── action              PlaybookAction      ASK_QUESTION | PRESENT_INFO | PRESENT_OFFER |
│                                           HANDLE_OBJECTION | CTA | QUALIFY | HANDOFF | WAIT
├── config              json                {
│                                             question: "請問你貴姓？",
│                                             field: "name",
│                                             skipIf: "contact.name is not null",
│                                             maxAttempts: 2
│                                           }
├── nextStepOnSuccess   int?                Step to go to on success (default: stepOrder + 1)
├── nextStepOnFailure   int?                Step to go to on failure (e.g., skip)
└── createdAt           datetime
```

#### ObjectionRule (Phase 2-3)

```
ObjectionRule
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── name                string              "太貴了 - 價值重構"
├── patterns            string[]            ["太貴", "好貴", "價錢太高", "cheaper", "discount"]
│                                           Multiple trigger patterns per rule
├── category            ObjectionCategory   PRICE | TIMING | TRUST | COMPETITOR | NEED | AUTHORITY | QUALITY
├── strategy            ObjectionStrategy   ACKNOWLEDGE | REFRAME | SOCIAL_PROOF | SCARCITY |
│                                           EMPATHY | COMPARISON | VALUE_STACK | FEEL_FELT_FOUND
├── responseTemplate    text                "我理解你覺得價格偏高。其實好多客人一開始都咁諗，
│                                           不過佢哋用過之後都覺得物超所值。因為我哋用嘅係..."
│                                           Supports {{variables}} for dynamic content
├── escalateAfter       int?                After N failed attempts, escalate (Phase 3)
├── priority            int                 Higher = matched first when multiple rules match
├── isActive            boolean
├── successCount        int                 Denormalized: how many times this rule led to positive outcome
├── useCount            int                 Denormalized: how many times this rule was applied
├── createdAt           datetime
└── updatedAt           datetime
```

#### UpsellRule (Phase 3)

```
UpsellRule
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── name                string              "剪髮 → 加護髮"
├── type                UpsellType          UPSELL | CROSS_SELL | QUANTITY | BUNDLE
├── triggerConditions   json                { product: "剪髮", leadState: "CLOSING", ... }
├── offerTemplate       text                "好多客人剪完頭髮都會加埋護髮，今日加只需要 +$80，你有興趣嗎？"
├── discountType        string?             "percentage" | "fixed" | null
├── discountValue       decimal?
├── priority            int
├── isActive            boolean
├── successCount        int
├── useCount            int
├── createdAt           datetime
└── updatedAt           datetime
```

### 3.5 AI & Analytics Layer

#### AiRun

```
AiRun
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── conversationId      UUID (FK → Conversation)
├── triggerMessageId    UUID (FK → Message)      The inbound message that triggered this run
├── responseMessageId   UUID? (FK → Message)     The outbound message generated
├── model               string                   "gpt-4o-mini"
├── promptTokens        int
├── completionTokens    int
├── totalTokens         int
├── latencyMs           int                      Total pipeline execution time
├── llmLatencyMs        int                      LLM API call time only
├── estimatedCost       decimal                  In USD
├── strategy            string                   Which strategy was selected: "faq" | "info-collect" | "booking" | "objection" | ...
├── extractedSignals    json                     { intent, sentiment, urgency, entities, ... }
├── sideEffectsExecuted json                     [{ type: "UPDATE_CONTACT", ... }, ...]
├── appliedRules        string[]                 IDs of objection/upsell rules that fired
├── confidence          float?                   AI's self-assessed confidence (Phase 2+)
├── inputContext        json                     Sanitized snapshot of context sent to LLM (for debugging)
├── rawOutput           text                     Raw LLM response (for debugging)
├── errorMessage        string?                  If pipeline errored
├── createdAt           datetime
└── _no updatedAt_                               Immutable log

Indexes:
  - (tenantId, createdAt DESC)                   — Recent AI runs
  - (tenantId, conversationId)                   — AI runs for a conversation
  - (tenantId, strategy, createdAt)              — Analytics: strategy usage over time
```

**Design note**: `AiRun` is the most important observability entity. Every single AI response is logged here. This enables: debugging ("why did AI say that?"), cost tracking ("how much are we spending per tenant?"), analytics ("which strategy converts best?"), and the Phase 3 learning loop.

#### LeadScore (Phase 2+)

```
LeadScore
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── contactId           UUID (FK → Contact, unique per tenant)
├── overallScore        int               0-100, composite score
├── engagementScore     int               Based on message frequency, response time
├── intentScore         int               Based on buying signals detected
├── fitScore            int               Based on profile match (budget, timing)
├── recencyScore        int               Decays over time without interaction
├── signals             json              { lastBuyingSignal: "...", lastObjection: "...", ... }
├── lastCalculatedAt    datetime
├── createdAt           datetime
└── updatedAt           datetime

ScoringRule
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── name                string            "Buying signal detected"
├── dimension           string            "engagement" | "intent" | "fit" | "recency"
├── condition           json              { signal: "buying_signal", minCount: 1 }
├── scoreImpact         int               +15
├── isActive            boolean
└── createdAt           datetime
```

#### DecisionIdentityProfile (Phase 3)

```
DecisionIdentityProfile
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── contactId           UUID (FK → Contact, unique per tenant)
├── primaryType         DecisionType      ANALYTICAL | DRIVER | EXPRESSIVE | AMIABLE
├── secondaryType       DecisionType?     Some people blend two types
├── confidence          float             0.0-1.0, how confident the classification is
├── signals             json              Evidence from conversations:
│                                         { analyticalSignals: ["asked for specs", "compared prices"],
│                                           driverSignals: ["wants quick answer", "impatient tone"] }
├── preferredTone       string?           Derived: "data-driven" | "direct" | "enthusiastic" | "warm"
├── preferredPace       string?           "fast" | "moderate" | "deliberate"
├── conversationsAnalyzed int             How many conversations informed this profile
├── lastUpdatedFromConversationId UUID?
├── createdAt           datetime
└── updatedAt           datetime
```

#### ObjectionEvent (Phase 2-3)

```
ObjectionEvent
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── conversationId      UUID (FK → Conversation)
├── contactId           UUID (FK → Contact)
├── messageId           UUID (FK → Message)       The message containing the objection
├── aiRunId             UUID (FK → AiRun)
├── objectionRuleId     UUID? (FK → ObjectionRule) The rule that was applied (null if no match)
├── detectedCategory    ObjectionCategory   PRICE | TIMING | TRUST | ...
├── detectedText        text                The actual objection text from customer
├── strategyUsed        ObjectionStrategy?  What strategy was applied
├── responseGiven       text                The AI's response to this objection
├── outcome             ObjectionOutcome    RESOLVED | PERSISTED | ESCALATED | UNKNOWN
│                                           Determined by analyzing subsequent messages
├── resolvedAfterTurns  int?                How many turns after objection before resolved
├── createdAt           datetime
└── _no updatedAt_

Indexes:
  - (tenantId, detectedCategory, outcome)   — Analytics: objection success rate by category
  - (tenantId, objectionRuleId)             — Analytics: rule effectiveness
```

**Design note**: `ObjectionEvent` is the runtime log; `ObjectionRule` is the static config. This separation allows us to track "rule X was applied 50 times, resolved 35 times (70% success rate)" — critical for Phase 3's learning loop.

#### HandoffLog (Phase 2+)

```
HandoffLog
├── id                  UUID (PK)
├── tenantId            UUID (FK → Tenant)
├── conversationId      UUID (FK → Conversation)
├── contactId           UUID (FK → Contact)
├── triggeredByAiRunId  UUID? (FK → AiRun)  Which AI run decided to hand off
├── reason              HandoffReason       CUSTOMER_REQUEST | AI_LOW_CONFIDENCE |
│                                           COMPLEX_INQUIRY | ESCALATION |
│                                           SENSITIVE_TOPIC | REPEATED_OBJECTION
├── aiConfidence        float?              AI's confidence at time of handoff
├── aiSummary           text                AI-generated context summary for the human agent:
│                                           "客戶陳小姐想預約剪髮，但對價格有疑慮。已回應價值重構，
│                                           客戶仍猶豫。建議提供首次優惠。"
├── suggestedAction     text?               AI's recommendation to the human agent
├── assignedUserId      UUID? (FK → User)
├── acceptedAt          datetime?           When human agent accepted the handoff
├── resolvedAt          datetime?
├── resolution          HandoffResolution?  CONVERTED | RESOLVED | LOST | RETURNED_TO_AI
├── resolutionNotes     text?
├── handoffAt           datetime
├── createdAt           datetime
└── updatedAt           datetime
```

---

## 4. Phase Mapping

### Phase 1: AI Receptionist (Starter) — MVP

```
MUST BUILD                                    Entity          NestJS Module
─────────────────────────────────────────────────────────────────────────────
Platform
  ✅ Auth (login, register, JWT)              —               auth
  ✅ Tenant + TenantSettings                  Tenant,         tenants
                                              TenantSettings
  ✅ Users (owner/admin/agent CRUD)           User            users
  ✅ Channels (WhatsApp, web chat config)     Channel         channels

Core CRM
  ✅ Contacts (CRUD + auto-create)            Contact         contacts
  ✅ Conversations (CRUD + status)            Conversation    conversations
  ✅ Messages (store + retrieve)              Message         messages
  ✅ Orders (basic CRUD)                      Order,          orders
                                              OrderItem
  ✅ Bookings (basic CRUD)                    Booking         bookings

Task & Notification
  ✅ Follow-ups (create + track)              FollowUpTask    follow-ups
  ✅ Reminders (schedule + send)              Reminder        reminders
  ✅ Notifications (in-app + email)           Notification    notifications

Knowledge
  ✅ Knowledge Base (CRUD)                    KnowledgeDoc    knowledge-base

AI & Observability
  ✅ AI Runs (basic logging)                  AiRun           ai-runs

Dashboard & Ingress
  ✅ Dashboard (basic stats)                  —               dashboard
  ✅ Webhooks (WhatsApp + web chat)           —               webhooks
```

**Phase 1 Entity Count: 13 tables**

Fields present but unused in Phase 1 (reserved for Phase 2):
- `Conversation.leadState` → always `NEW`
- `Conversation.leadScore` → always `null`
- `Conversation.activePlaybookId` → always `null`
- `AiRun.confidence` → always `null`
- `AiRun.appliedRules` → always `[]`

### Phase 2: AI Sales Assistant (Growth)

```
NEW MODULES                                   Entity          NestJS Module
─────────────────────────────────────────────────────────────────────────────
  ➕ Lead Scoring                             LeadScore,      scoring
                                              ScoringRule
  ➕ Sales Playbooks                          SalesPlaybook,  sales-playbooks
                                              PlaybookStep
  ➕ Objection Rules                          ObjectionRule   objection-rules
  ➕ Objection Events (logging)               ObjectionEvent  objection-events
  ➕ Handoff Management                       HandoffLog      handoffs

UPGRADED MODULES
  🔼 Conversations: lead state FSM, playbook tracking, AI confidence
  🔼 Contacts: totalSpent, merge logic, enhanced search
  🔼 AI Runs: confidence scoring, signal extraction v2, rule tracking
  🔼 Knowledge Base: vector embeddings (pgvector), semantic search
  🔼 Dashboard: pipeline view, lead scoring, conversion stats
  🔼 Channels: + Instagram, + Facebook adapters
  🔼 Reminders: customer-facing reminders (booking confirmation via WhatsApp)
  🔼 Notifications: push notifications
```

**Phase 2 adds: 6 new tables → total ~19 tables**

### Phase 3: AI Top Sales Agent (Elite)

```
NEW MODULES                                   Entity          NestJS Module
─────────────────────────────────────────────────────────────────────────────
  ➕ Decision Identity Profiles               DecisionIdentity decision-profiles
                                              Profile
  ➕ Upsell Rules                             UpsellRule       upsell-rules
  ➕ Analytics (advanced)                     —                analytics

UPGRADED MODULES
  🔼 Objection Rules: multi-turn strategies, escalation chains
  🔼 Objection Events: outcome tracking, success rate
  🔼 AI Runs: A/B test tracking, prompt versioning
  🔼 Scoring: predictive scoring, decay functions
  🔼 Dashboard: conversion funnels, revenue attribution, AI performance
```

**Phase 3 adds: 2 new tables → total ~21 tables**

---

## 5. API Boundaries

### 5.1 REST API Surface

Each domain exposes a well-defined API boundary. Controllers only call their own module's service. Cross-module coordination happens in the worker.

#### Platform APIs

```
Auth API (/auth)
├── POST   /auth/register              Create tenant + owner user
├── POST   /auth/login                 Login, returns JWT pair
├── POST   /auth/refresh               Refresh access token
├── GET    /auth/me                    Current user profile
└── POST   /auth/logout                Revoke refresh token

Tenant API (/tenants)
├── GET    /tenants/current            Current tenant info
├── PATCH  /tenants/current            Update tenant name, industry
├── GET    /tenants/current/settings   Get AI + business settings
└── PATCH  /tenants/current/settings   Update settings

User API (/users)
├── GET    /users                      List team members
├── POST   /users                      Invite / create team member
├── GET    /users/:id                  User detail
├── PATCH  /users/:id                  Update user
└── DELETE /users/:id                  Deactivate user (soft delete)

Channel API (/channels)
├── GET    /channels                   List configured channels
├── POST   /channels                   Add new channel (connect WhatsApp, etc.)
├── GET    /channels/:id               Channel detail + status
├── PATCH  /channels/:id               Update channel config
├── DELETE /channels/:id               Disconnect channel
└── POST   /channels/:id/verify        Test channel connection
```

#### Core CRM APIs

```
Contact API (/contacts)
├── GET    /contacts                   List + search + filter + paginate
│                                      ?status=ACTIVE&search=陳&sort=lastContactAt
├── POST   /contacts                   Create contact manually
├── GET    /contacts/:id               Contact detail + summary stats
├── PATCH  /contacts/:id               Update contact
├── DELETE /contacts/:id               Soft delete
├── GET    /contacts/:id/conversations All conversations for this contact
├── GET    /contacts/:id/orders        All orders for this contact
├── GET    /contacts/:id/bookings      All bookings for this contact
└── GET    /contacts/:id/timeline      Unified timeline (messages, orders, bookings, follow-ups)

Conversation API (/conversations)
├── GET    /conversations              List + filter + paginate
│                                      ?status=OPEN&assignedTo=me&sort=lastMessageAt
├── GET    /conversations/:id          Conversation detail (includes contact info)
├── PATCH  /conversations/:id          Update status, assign to user, close
├── GET    /conversations/:id/messages Messages in thread (paginated, oldest first)
├── POST   /conversations/:id/messages Send message as human agent
│                                      (also pauses AI auto-response)
└── POST   /conversations/:id/close    Close conversation with reason

Order API (/orders)
├── GET    /orders                     List + filter + paginate
├── POST   /orders                     Create order manually
├── GET    /orders/:id                 Order detail
├── PATCH  /orders/:id                 Update order (status, items, notes)
└── PATCH  /orders/:id/status          Quick status update

Booking API (/bookings)
├── GET    /bookings                   List + filter + paginate
│                                      ?status=CONFIRMED&from=2026-03-19&to=2026-03-26
├── POST   /bookings                   Create booking manually
├── GET    /bookings/:id               Booking detail
├── PATCH  /bookings/:id               Update booking
├── PATCH  /bookings/:id/status        Quick status update (confirm, cancel, complete, no-show)
└── GET    /bookings/calendar          Calendar view data (grouped by day)
```

#### Task & Notification APIs

```
Follow-Up API (/follow-ups)
├── GET    /follow-ups                 List + filter
│                                      ?status=PENDING&assignedTo=me&sort=dueAt
├── POST   /follow-ups                 Create follow-up manually
├── GET    /follow-ups/:id             Detail
├── PATCH  /follow-ups/:id             Update
└── PATCH  /follow-ups/:id/complete    Mark as completed (with outcome text)

Reminder API (/reminders)
├── GET    /reminders                  List upcoming reminders
└── PATCH  /reminders/:id/cancel       Cancel a scheduled reminder

Notification API (/notifications)
├── GET    /notifications              List for current user (paginated)
│                                      ?unreadOnly=true
├── PATCH  /notifications/:id/read     Mark as read
└── POST   /notifications/read-all     Mark all as read
```

#### Knowledge & Config APIs

```
Knowledge Base API (/knowledge-base)
├── GET    /knowledge-base             List docs + filter by category
├── POST   /knowledge-base             Create document
├── GET    /knowledge-base/:id         Document detail
├── PATCH  /knowledge-base/:id         Update document
├── DELETE /knowledge-base/:id         Delete document
└── POST   /knowledge-base/reorder     Reorder documents (batch update sortOrder)

Sales Playbook API (/playbooks) — Phase 2
├── GET    /playbooks                  List playbooks
├── POST   /playbooks                  Create playbook
├── GET    /playbooks/:id              Playbook detail + steps
├── PATCH  /playbooks/:id              Update playbook
├── DELETE /playbooks/:id              Delete playbook
├── POST   /playbooks/:id/steps        Add step
├── PATCH  /playbooks/:id/steps/:stepId Update step
└── DELETE /playbooks/:id/steps/:stepId Remove step

Objection Rules API (/objection-rules) — Phase 2
├── GET    /objection-rules            List rules
├── POST   /objection-rules            Create rule
├── GET    /objection-rules/:id        Rule detail + stats
├── PATCH  /objection-rules/:id        Update rule
└── DELETE /objection-rules/:id        Delete rule

Upsell Rules API (/upsell-rules) — Phase 3
├── (same CRUD pattern as objection-rules)
```

#### AI & Analytics APIs

```
AI Runs API (/ai-runs) — read-only
├── GET    /ai-runs                    List recent runs (admin debugging)
│                                      ?conversationId=xxx
└── GET    /ai-runs/:id               Run detail (full input/output snapshot)

Scoring API (/scoring) — Phase 2
├── GET    /scoring/rules              List scoring rules
├── POST   /scoring/rules              Create rule
├── PATCH  /scoring/rules/:id          Update rule
└── GET    /scoring/contacts/:id       Get lead score for a contact

Handoff API (/handoffs) — Phase 2
├── GET    /handoffs                   List pending handoffs
│                                      ?status=PENDING&assignedTo=me
├── GET    /handoffs/:id               Handoff detail + AI summary
├── PATCH  /handoffs/:id/accept        Accept handoff assignment
└── PATCH  /handoffs/:id/resolve       Resolve handoff (with resolution + notes)

Decision Profiles API (/decision-profiles) — Phase 3, read-only
├── GET    /decision-profiles/:contactId  Get decision profile for a contact

Dashboard API (/dashboard)
├── GET    /dashboard/overview         Key metrics: open conversations, today's bookings,
│                                      pending follow-ups, unread notifications
├── GET    /dashboard/conversations    Conversation stats (by status, by channel)
├── GET    /dashboard/bookings         Booking stats (upcoming, completed, cancelled)
├── GET    /dashboard/ai-usage         AI usage stats (runs, tokens, cost) — Phase 2
└── GET    /dashboard/pipeline         Sales pipeline stats (by lead state) — Phase 2
```

#### Webhook Ingress (no auth, verified by signature)

```
Webhook API (/webhooks)
├── GET    /webhooks/whatsapp          WhatsApp webhook verification (challenge response)
├── POST   /webhooks/whatsapp          Inbound WhatsApp message
├── POST   /webhooks/web-chat          Inbound web chat message
├── POST   /webhooks/instagram         Inbound Instagram DM — Phase 2
└── POST   /webhooks/facebook          Inbound Facebook Messenger — Phase 2
```

### 5.2 Internal Service Boundaries (Not exposed as REST)

These are services that are only called internally (by worker processors or by other services):

```
AI Pipeline Service (apps/worker)
├── processInboundMessage(tenantId, channelId, rawMessage)
│   → Orchestrates the full AI flow, returns nothing (side effects are persisted)

Side Effect Executor (apps/worker)
├── executeSideEffects(tenantId, conversationId, sideEffects[])
│   → Calls individual domain services to persist AI-decided actions

Channel Sender Service (apps/worker)
├── sendOutboundMessage(channelId, recipientExternalId, text)
│   → Routes to the correct channel adapter and sends

Reminder Scheduler (apps/worker, cron)
├── checkDueReminders()
│   → Queries DB for due reminders, sends them

Follow-Up Checker (apps/worker, cron)
├── checkOverdueFollowUps()
│   → Marks overdue, notifies assigned users
```

### 5.3 API Design Rules

| Rule | Detail |
|------|--------|
| **Tenant scoping** | Every API endpoint (except /auth and /webhooks) requires JWT. Tenant is resolved from JWT. All queries are auto-scoped. |
| **Pagination** | All list endpoints support `?page=1&limit=20`. Default limit: 20. Max limit: 100. Response includes `{ data, pagination: { page, limit, total, totalPages } }` |
| **Filtering** | Query params for common filters. Example: `/conversations?status=OPEN&channel=WHATSAPP` |
| **Sorting** | `?sort=createdAt&order=desc`. Default sort varies by entity (conversations: lastMessageAt desc, bookings: startAt asc) |
| **Response envelope** | All responses use `{ success: boolean, data: T, error?: { code, message } }` |
| **Validation** | All inputs validated via class-validator DTOs. 400 on invalid input. |
| **Error codes** | Structured error codes: `AUTH_INVALID_CREDENTIALS`, `TENANT_SUSPENDED`, `CONTACT_NOT_FOUND`, etc. |
| **Rate limiting** | Per-tenant rate limiting via Redis. Starter: 100 req/min. Growth: 500. Elite: 2000. |
| **Versioning** | No URL versioning in Phase 1. If needed later: `/v2/...` prefix. |

---

## 6. Entity Relationship Summary

```
┌─────────────────────────────────────────────────────────────────┐
│ PLATFORM                                                        │
│                                                                 │
│  Tenant ──┬── 1:1 ── TenantSettings                            │
│           ├── 1:N ── User                                       │
│           ├── 1:N ── Channel                                    │
│           └── 1:N ── (every other entity has tenantId)          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ CORE CRM                                                        │
│                                                                 │
│  Contact ──┬── 1:N ── Conversation ──┬── 1:N ── Message         │
│            │          │              │                           │
│            │          ├── N:1 ── Channel                         │
│            │          ├── 0:1 ── User (assigned)                │
│            │          │                                         │
│            ├── 1:N ── Order ──── 1:N ── OrderItem               │
│            │                                                    │
│            ├── 1:N ── Booking                                   │
│            │                                                    │
│            ├── 0:1 ── LeadScore          (Phase 2)              │
│            └── 0:1 ── DecisionIdentity   (Phase 3)              │
│                       Profile                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ TASKS                                                           │
│                                                                 │
│  Conversation ──── 1:N ── FollowUpTask ──── 0:N ── Reminder     │
│  Booking ───────── 0:N ── Reminder                              │
│  User ──────────── 1:N ── Notification                          │
└─────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ KNOWLEDGE & CONFIG                                              │
│                                                                 │
│  Tenant ──┬── 1:N ── KnowledgeDocument                          │
│           ├── 1:N ── SalesPlaybook ── 1:N ── PlaybookStep       │
│           ├── 1:N ── ObjectionRule                               │
│           ├── 1:N ── UpsellRule              (Phase 3)          │
│           └── 1:N ── ScoringRule             (Phase 2)          │
└─────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│ AI & ANALYTICS                                                  │
│                                                                 │
│  Conversation ──┬── 1:N ── AiRun                                │
│                 ├── 0:N ── HandoffLog        (Phase 2)          │
│                 └── 0:N ── ObjectionEvent    (Phase 2)          │
│                                                                 │
│  AiRun ──── triggered by Message                                │
│  AiRun ──── produces Message                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Cardinality Summary

| Relationship | Cardinality | Notes |
|-------------|-------------|-------|
| Tenant → User | 1:N | Owner + team members |
| Tenant → Channel | 1:N | Multiple channels per tenant |
| Tenant → Contact | 1:N | All customers belong to a tenant |
| Contact → Conversation | 1:N | One conversation per channel (usually), but can have multiple over time |
| Conversation → Message | 1:N | Append-only message log |
| Conversation → FollowUpTask | 1:N | AI or human can create follow-ups from a conversation |
| Contact → Order | 1:N | Customer's order history |
| Contact → Booking | 1:N | Customer's booking history |
| Contact → LeadScore | 1:1 | One computed score per contact (Phase 2) |
| Contact → DecisionIdentityProfile | 1:1 | One profile per contact (Phase 3) |
| FollowUpTask → Reminder | 1:N | A follow-up can have multiple reminders (initial + follow-up reminders) |
| Booking → Reminder | 1:N | Reminder before booking + confirmation after |
| Conversation → AiRun | 1:N | Every AI-processed message creates an AiRun |
| Message → AiRun | 1:1 | One inbound message triggers one AI run |
| Conversation → HandoffLog | 0:N | Can be handed off multiple times |
| Conversation → ObjectionEvent | 0:N | Multiple objections may arise in one conversation |
| SalesPlaybook → PlaybookStep | 1:N | Ordered steps within a playbook |
