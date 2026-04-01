# AI Top Sales - Prisma Schema Plan

> Version: 0.1 | Date: 2026-03-19
> Depends on: [BACKEND-DOMAIN-DESIGN.md](./BACKEND-DOMAIN-DESIGN.md)

---

## 1. Prisma Model List — By Phase

### Phase 1 (13 models) — Must build, ship MVP

| # | Model | Domain | Why Phase 1 |
|---|-------|--------|-------------|
| 1 | `Tenant` | platform | Multi-tenant root entity |
| 2 | `TenantSettings` | platform | AI config, business hours, tone — 1:1 with Tenant |
| 3 | `User` | platform | Team members, auth |
| 4 | `Channel` | platform | WhatsApp / web chat connection config |
| 5 | `Contact` | CRM | Customer/lead records |
| 6 | `Conversation` | CRM | Conversation threads |
| 7 | `Message` | CRM | Individual messages (append-only log) |
| 8 | `Order` | CRM | Simple order records |
| 9 | `OrderItem` | CRM | Order line items |
| 10 | `Booking` | CRM | Appointment / reservation records |
| 11 | `FollowUpTask` | tasks | Scheduled follow-up tasks |
| 12 | `Reminder` | tasks | Automated reminders |
| 13 | `Notification` | tasks | In-app notifications |
| 14 | `KnowledgeDocument` | knowledge | FAQ / product info for AI context |
| 15 | `AiRun` | AI | AI execution audit log |

**15 models** total. (Slightly more than the "13 tables" in domain design because `OrderItem` and `KnowledgeDocument` are included.)

### Phase 2 (add 6 models)

| # | Model | Domain | Why Phase 2 |
|---|-------|--------|-------------|
| 16 | `SalesPlaybook` | knowledge | Configurable sales flows |
| 17 | `PlaybookStep` | knowledge | Steps within a playbook |
| 18 | `ObjectionRule` | knowledge | Objection patterns + strategies |
| 19 | `ObjectionEvent` | AI | Runtime objection event log |
| 20 | `HandoffLog` | AI | Human handoff lifecycle |
| 21 | `LeadScore` | AI | Computed lead scores per contact |
| 22 | `ScoringRule` | AI | Configurable scoring rules |

### Phase 3 (add 2 models)

| # | Model | Domain | Why Phase 3 |
|---|-------|--------|-------------|
| 23 | `DecisionIdentityProfile` | AI | Customer decision style profiling |
| 24 | `UpsellRule` | knowledge | Upsell/cross-sell trigger rules |

### Total: 24 models across all phases

---

## 2. Model Relationships

### Relationship Map

```
Tenant ──────────────────────────────────────────────────────────
  │
  ├── 1:1 ── TenantSettings
  ├── 1:N ── User
  ├── 1:N ── Channel
  ├── 1:N ── Contact ─────────────────────────────────────────
  │            │
  │            ├── 1:N ── Conversation ────────────────────────
  │            │            │
  │            │            ├── N:1 ── Channel
  │            │            ├── 0:1 ── User (assignedUser)
  │            │            ├── 1:N ── Message
  │            │            │            └── 0:1 ── Message (replyTo, self-ref)
  │            │            ├── 1:N ── AiRun
  │            │            ├── 1:N ── FollowUpTask
  │            │            │            └── 0:N ── Reminder
  │            │            ├── 0:N ── HandoffLog           [Phase 2]
  │            │            ├── 0:N ── ObjectionEvent       [Phase 2]
  │            │            └── 0:1 ── SalesPlaybook (active) [Phase 2]
  │            │
  │            ├── 1:N ── Order ── 1:N ── OrderItem
  │            ├── 1:N ── Booking ── 0:N ── Reminder
  │            ├── 0:1 ── LeadScore                         [Phase 2]
  │            └── 0:1 ── DecisionIdentityProfile           [Phase 3]
  │
  ├── 1:N ── KnowledgeDocument
  ├── 1:N ── SalesPlaybook ── 1:N ── PlaybookStep           [Phase 2]
  ├── 1:N ── ObjectionRule                                  [Phase 2]
  ├── 1:N ── ScoringRule                                    [Phase 2]
  ├── 1:N ── UpsellRule                                     [Phase 3]
  ├── 1:N ── Notification ── N:1 ── User
  └── 1:N ── Reminder

AiRun:
  ├── N:1 ── Conversation
  ├── N:1 ── Message (triggerMessage)
  └── 0:1 ── Message (responseMessage)
```

### Foreign Key Summary

| From Model | Field | To Model | Type | Nullable | Notes |
|------------|-------|----------|------|----------|-------|
| TenantSettings | tenantId | Tenant | 1:1 | No | Unique constraint |
| User | tenantId | Tenant | N:1 | No | |
| Channel | tenantId | Tenant | N:1 | No | |
| Contact | tenantId | Tenant | N:1 | No | |
| Conversation | tenantId | Tenant | N:1 | No | |
| Conversation | contactId | Contact | N:1 | No | |
| Conversation | channelId | Channel | N:1 | No | |
| Conversation | assignedUserId | User | N:1 | **Yes** | Null = AI handling |
| Conversation | activePlaybookId | SalesPlaybook | N:1 | **Yes** | Phase 2, null in Phase 1 |
| Message | tenantId | Tenant | N:1 | No | |
| Message | conversationId | Conversation | N:1 | No | |
| Message | senderUserId | User | N:1 | **Yes** | Only for HUMAN_AGENT |
| Message | replyToMessageId | Message | self | **Yes** | Self-referential |
| Order | tenantId | Tenant | N:1 | No | |
| Order | contactId | Contact | N:1 | No | |
| Order | conversationId | Conversation | N:1 | **Yes** | Null if manual |
| OrderItem | orderId | Order | N:1 | No | Cascade delete |
| Booking | tenantId | Tenant | N:1 | No | |
| Booking | contactId | Contact | N:1 | No | |
| Booking | conversationId | Conversation | N:1 | **Yes** | |
| FollowUpTask | tenantId | Tenant | N:1 | No | |
| FollowUpTask | contactId | Contact | N:1 | No | |
| FollowUpTask | conversationId | Conversation | N:1 | **Yes** | |
| FollowUpTask | assignedUserId | User | N:1 | **Yes** | |
| FollowUpTask | completedByUserId | User | N:1 | **Yes** | |
| Reminder | tenantId | Tenant | N:1 | No | |
| Notification | tenantId | Tenant | N:1 | No | |
| Notification | userId | User | N:1 | No | |
| KnowledgeDocument | tenantId | Tenant | N:1 | No | |
| AiRun | tenantId | Tenant | N:1 | No | |
| AiRun | conversationId | Conversation | N:1 | No | |
| AiRun | triggerMessageId | Message | N:1 | No | |
| AiRun | responseMessageId | Message | N:1 | **Yes** | Null if errored |
| **Phase 2** | | | | | |
| SalesPlaybook | tenantId | Tenant | N:1 | No | |
| PlaybookStep | playbookId | SalesPlaybook | N:1 | No | Cascade delete |
| ObjectionRule | tenantId | Tenant | N:1 | No | |
| ObjectionEvent | tenantId | Tenant | N:1 | No | |
| ObjectionEvent | conversationId | Conversation | N:1 | No | |
| ObjectionEvent | contactId | Contact | N:1 | No | |
| ObjectionEvent | messageId | Message | N:1 | No | |
| ObjectionEvent | aiRunId | AiRun | N:1 | No | |
| ObjectionEvent | objectionRuleId | ObjectionRule | N:1 | **Yes** | Null if no rule matched |
| HandoffLog | tenantId | Tenant | N:1 | No | |
| HandoffLog | conversationId | Conversation | N:1 | No | |
| HandoffLog | contactId | Contact | N:1 | No | |
| HandoffLog | triggeredByAiRunId | AiRun | N:1 | **Yes** | |
| HandoffLog | assignedUserId | User | N:1 | **Yes** | |
| LeadScore | tenantId | Tenant | N:1 | No | |
| LeadScore | contactId | Contact | 1:1 | No | Unique per tenant |
| ScoringRule | tenantId | Tenant | N:1 | No | |
| **Phase 3** | | | | | |
| DecisionIdentityProfile | tenantId | Tenant | N:1 | No | |
| DecisionIdentityProfile | contactId | Contact | 1:1 | No | Unique per tenant |
| UpsellRule | tenantId | Tenant | N:1 | No | |

---

## 3. Enum Definitions

### Phase 1 Enums (define now, use now)

```
TenantPlan          STARTER | GROWTH | ELITE
TenantStatus        ACTIVE | SUSPENDED | TRIAL
UserRole            OWNER | ADMIN | AGENT
ChannelType         WHATSAPP | INSTAGRAM | FACEBOOK | WEB_CHAT
AiTone              FRIENDLY | PROFESSIONAL | CASUAL | LUXURY
ContactStatus       NEW | ACTIVE | INACTIVE | CONVERTED | LOST
ContactSource       WHATSAPP | INSTAGRAM | FACEBOOK | WEB_CHAT | MANUAL
ConversationStatus  OPEN | WAITING | AI_ACTIVE | HANDED_OFF | CLOSED | ARCHIVED
LeadState           NEW | ENGAGED | QUALIFIED | PROPOSING | NEGOTIATING | CLOSING | WON | LOST
MessageDirection    INBOUND | OUTBOUND
MessageSenderType   CUSTOMER | AI | HUMAN_AGENT | SYSTEM
MessageContentType  TEXT | IMAGE | AUDIO | VIDEO | FILE | LOCATION | TEMPLATE
OrderStatus         DRAFT | CONFIRMED | PROCESSING | COMPLETED | CANCELLED | REFUNDED
OrderSource         AI_CREATED | HUMAN_CREATED | MANUAL
BookingStatus       PENDING | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW | RESCHEDULED
BookingSource       AI_CREATED | HUMAN_CREATED | MANUAL
FollowUpType        CALL | MESSAGE | EMAIL | TASK | REVIEW
FollowUpSource      AI_CREATED | HUMAN_CREATED
FollowUpPriority    LOW | MEDIUM | HIGH | URGENT
FollowUpStatus      PENDING | IN_PROGRESS | COMPLETED | OVERDUE | CANCELLED
ReminderTargetType  BOOKING | FOLLOW_UP | ORDER | CUSTOM
ReminderRecipientType  USER | CONTACT
ReminderChannel     EMAIL | SMS | PUSH | IN_APP | WHATSAPP
ReminderStatus      SCHEDULED | SENT | FAILED | CANCELLED | SKIPPED
NotificationType    NEW_MESSAGE | NEW_BOOKING | NEW_ORDER | FOLLOW_UP_DUE |
                    FOLLOW_UP_OVERDUE | HANDOFF_REQUEST | REMINDER | SYSTEM_ALERT
```

### Phase 2 Enums (define now in schema, use in Phase 2 code)

```
ObjectionCategory   PRICE | TIMING | TRUST | COMPETITOR | NEED | AUTHORITY | QUALITY
ObjectionStrategy   ACKNOWLEDGE | REFRAME | SOCIAL_PROOF | SCARCITY |
                    EMPATHY | COMPARISON | VALUE_STACK | FEEL_FELT_FOUND
ObjectionOutcome    RESOLVED | PERSISTED | ESCALATED | UNKNOWN
PlaybookAction      ASK_QUESTION | PRESENT_INFO | PRESENT_OFFER |
                    HANDLE_OBJECTION | CTA | QUALIFY | HANDOFF | WAIT
HandoffReason       CUSTOMER_REQUEST | AI_LOW_CONFIDENCE | COMPLEX_INQUIRY |
                    ESCALATION | SENSITIVE_TOPIC | REPEATED_OBJECTION
HandoffResolution   CONVERTED | RESOLVED | LOST | RETURNED_TO_AI
```

### Phase 3 Enums

```
DecisionType        ANALYTICAL | DRIVER | EXPRESSIVE | AMIABLE
UpsellType          UPSELL | CROSS_SELL | QUANTITY | BUNDLE
```

### Enum Strategy: Prisma `enum` vs String

| Approach | Pros | Cons |
|----------|------|------|
| **Prisma `enum`** | Type-safe, DB-enforced, auto-completion | Schema migration required to add values |
| **String field** | No migration to add values, more flexible | No DB-level enforcement, typos possible |

**Decision**: Use **Prisma `enum`** for all stable enums that are unlikely to change frequently (TenantPlan, UserRole, MessageDirection, etc.). These represent core domain states.

**Exception**: Future-facing Phase 2/3 enums like `ObjectionCategory`, `PlaybookAction` could start as enums and be augmented via migration when Phase 2 ships. Adding a value to a Prisma enum is a simple `ALTER TYPE ... ADD VALUE` migration — low risk.

---

## 4. Fields That Use JSON vs Dedicated Columns vs Config Tables

### JSON Fields (flexible, schema-less, queried rarely)

| Model | Field | Type | Why JSON |
|-------|-------|------|----------|
| TenantSettings | `businessHours` | `Json` | Structure varies: `{ mon: "09:00-18:00" }` or `{ mon: { open: "09:00", close: "18:00" } }`. Queried as a whole, never filtered. |
| TenantSettings | `collectFields` | `String[]` | Simple array. Could be JSON or Prisma `String[]`. |
| TenantSettings | `requiredForBooking` | `String[]` | Same as above. |
| Contact | `externalIds` | `Json` | Map: `{ whatsapp: "+852...", instagram: "..." }`. Multiple channels per contact. |
| Contact | `customFields` | `Json` | Tenant-defined arbitrary fields. Fully dynamic. |
| Channel | `credentials` | `Json` | Channel-specific: WhatsApp has `phoneNumberId`, IG has `pageId`. Different shape per channel type. |
| Conversation | `metadata` | `Json` | Extensible bucket for future fields without migration. |
| Message | `metadata` | `Json` | Channel-specific: reactions, read receipts, delivery status. |
| Order (Phase 1 simplification) | `items` | `Json` | **Phase 1 simplification**: could use JSON instead of OrderItem table. See section 5. |
| AiRun | `extractedSignals` | `Json` | AI output shape evolves across phases. |
| AiRun | `sideEffectsExecuted` | `Json` | Array of side effect records. |
| AiRun | `inputContext` | `Json` | Debug snapshot of LLM input. |
| SalesPlaybook | `triggerConditions` | `Json` | Complex conditions: `{ leadState: "NEW", intent: "inquiry" }`. |
| PlaybookStep | `config` | `Json` | Step-specific config varies by action type. |
| ObjectionRule | `patterns` | `String[]` | Array of trigger patterns. |
| UpsellRule | `triggerConditions` | `Json` | Same as playbook. |
| LeadScore | `signals` | `Json` | Detailed signal breakdown. |
| DecisionIdentityProfile | `signals` | `Json` | Evidence from conversations. |

### Why Not Config Tables for These?

Some fields (like `businessHours`, `customFields`, `triggerConditions`) could theoretically be normalized into key-value config tables. We avoid this because:

1. They are always loaded as a unit (never queried by individual key)
2. JSON is simpler to read/write in TypeScript
3. No need for SQL-level filtering on these fields
4. Prisma types them as `Prisma.JsonValue` which can be cast to typed interfaces in code

### Dedicated Columns vs JSON — When to Use Each

| Use **dedicated columns** when | Use **JSON** when |
|-------------------------------|-------------------|
| You filter/sort by this field | You never filter/sort by this field |
| You need DB-level constraints (unique, not null) | Structure is dynamic/tenant-defined |
| The field is part of core domain logic | The field is metadata/config loaded as a whole |
| You need referential integrity (FK) | The shape varies by context (e.g., channel-specific data) |

---

## 5. Models That Can Be Simplified for Phase 1

### Simplification 1: Order → Inline Items

**Full version** (Phase 2+): `Order` + `OrderItem` (two tables, proper relational)

**Phase 1 simplification**: Drop `OrderItem` table, use `Json items` column on `Order`.

```prisma
model Order {
  // ...
  items       Json    // [{ name: "剪髮", quantity: 1, unitPrice: 280 }]
  // ...
}
```

**Migration path**: When Phase 2 needs per-item analytics, create `OrderItem` table and migrate `items` JSON into it. Low-risk migration.

**Recommendation**: **Use the simplified version for Phase 1**. Most tenants will have 1-2 item orders. The `OrderItem` table adds complexity without Phase 1 value.

### Simplification 2: Reminder → Simpler Recipient Model

**Full version**: `recipientType` (USER | CONTACT) + `recipientId` (polymorphic).

**Phase 1 simplification**: Only `recipientUserId` (FK → User). No customer-facing reminders yet.

```prisma
model Reminder {
  // Phase 1: only remind team members
  recipientUserId  String
  recipientUser    User    @relation(fields: [recipientUserId], references: [id])
  // Phase 2: add recipientContactId for customer reminders
}
```

**Recommendation**: **Use simplified version**. Customer-facing reminders (booking confirmation via WhatsApp) come in Phase 2.

### Simplification 3: Notification → No Push

Phase 1 notifications are in-app only (shown in dashboard). Email notifications are a stretch goal. Push notifications are Phase 2.

No schema change needed — `NotificationType` enum already covers this. The delivery mechanism is in code, not schema.

### Simplification 4: AiRun → Fewer Fields

Phase 1 `AiRun` doesn't need:
- `confidence` → always null
- `appliedRules` → always empty array
- `llmLatencyMs` → nice to have but not essential

**Recommendation**: **Keep all fields in schema from day 1**. They're all nullable or have defaults. Having them avoids a migration later. The code just doesn't populate them in Phase 1.

### Simplification 5: Conversation → Phase 2 Fields Present But Unused

Fields like `leadScore`, `activePlaybookId`, `activePlaybookStep` exist in the schema from day 1 but are always null in Phase 1. No simplification needed — just nullable columns.

---

## 6. Index Strategy

### Phase 1 Indexes (create with initial migration)

```
Tenant
  - (slug)                              UNIQUE

TenantSettings
  - (tenantId)                          UNIQUE (1:1 with Tenant)

User
  - (tenantId, email)                   UNIQUE (email unique per tenant)

Channel
  - (tenantId, type)                    INDEX (find channels by type)

Contact
  - (tenantId, phone)                   INDEX
  - (tenantId, email)                   INDEX
  - (tenantId, status)                  INDEX
  - (tenantId, lastContactAt)           INDEX (DESC)

Conversation
  - (tenantId, status, lastMessageAt)   INDEX (DESC) — main list query
  - (tenantId, contactId)               INDEX
  - (tenantId, assignedUserId, status)  INDEX — agent's queue

Message
  - (conversationId, createdAt)         INDEX (ASC) — thread order
  - (channelMessageId)                  UNIQUE (nullable) — webhook dedup
  - (tenantId, createdAt)               INDEX (DESC)

Order
  - (tenantId, orderNumber)             UNIQUE
  - (tenantId, contactId)               INDEX
  - (tenantId, status)                  INDEX

Booking
  - (tenantId, bookingNumber)           UNIQUE
  - (tenantId, startAt)                 INDEX — calendar view
  - (tenantId, status, startAt)         INDEX — upcoming bookings
  - (tenantId, contactId)               INDEX

FollowUpTask
  - (tenantId, status, dueAt)           INDEX — pending tasks
  - (tenantId, assignedUserId, status)  INDEX

Reminder
  - (status, scheduledAt)               INDEX — worker query (cross-tenant!)
  - (tenantId, targetType, targetId)    INDEX

Notification
  - (tenantId, userId, isRead, createdAt) INDEX (DESC)

KnowledgeDocument
  - (tenantId, isActive, category)      INDEX

AiRun
  - (tenantId, createdAt)               INDEX (DESC)
  - (tenantId, conversationId)          INDEX
```

### Phase 2 Indexes (added via migration)

```
LeadScore
  - (tenantId, contactId)               UNIQUE

ObjectionRule
  - (tenantId, isActive, priority)      INDEX

ObjectionEvent
  - (tenantId, detectedCategory, outcome) INDEX
  - (tenantId, objectionRuleId)         INDEX

HandoffLog
  - (tenantId, conversationId)          INDEX
  - (tenantId, assignedUserId)          INDEX

Conversation (add)
  - (tenantId, leadState)               INDEX — pipeline view
```

### Phase 3 Indexes

```
DecisionIdentityProfile
  - (tenantId, contactId)               UNIQUE

UpsellRule
  - (tenantId, isActive, priority)      INDEX
```

### Index Design Principles

1. **Every `tenantId` is the leading column** in composite indexes (except `Reminder.status,scheduledAt` which is a cross-tenant worker query).
2. **No index on every column** — only columns that appear in `WHERE` or `ORDER BY` of actual queries.
3. **Nullable unique indexes** are allowed in PostgreSQL (multiple nulls are considered distinct).
4. **No full-text search indexes in Phase 1** — keyword matching is done in application code. Phase 2 may add `GIN` indexes for PostgreSQL full-text search or pgvector indexes.

---

## 7. Migration Strategy

### Initial Migration (Phase 1 Launch)

One migration creates all Phase 1 tables + Phase 2/3 enums.

**Why include Phase 2/3 enums in the initial migration?**
- Adding values to a Prisma enum requires a migration. Creating the enum with all future values from the start avoids "ALTER TYPE ADD VALUE" migrations later.
- Unused enum values have zero runtime cost.
- Enum types in PostgreSQL are very lightweight.

**Phase 2/3 tables are NOT created in the initial migration.** We only create the tables when the code to use them is ready.

### Migration Flow

```
Migration 1 (Phase 1 launch):
  ├── Create all enums (including Phase 2/3 values)
  ├── Create 15 tables (Tenant through AiRun)
  ├── Create all Phase 1 indexes
  └── Seed: create demo tenant + owner user

Migration 2..N (Phase 1 iterations):
  ├── Column additions (new nullable columns, no breaking changes)
  ├── Index adjustments based on real query patterns
  └── Minor enum value additions if needed

Migration P2-1 (Phase 2 launch):
  ├── Create 7 tables (SalesPlaybook, PlaybookStep, ObjectionRule,
  │   ObjectionEvent, HandoffLog, LeadScore, ScoringRule)
  ├── Create Phase 2 indexes
  └── Add any new columns to existing tables

Migration P3-1 (Phase 3 launch):
  ├── Create 2 tables (DecisionIdentityProfile, UpsellRule)
  ├── Create Phase 3 indexes
  └── Add any new columns to existing tables
```

### Migration Rules

| Rule | Rationale |
|------|-----------|
| **Never drop columns in production** | Use `@ignore` in Prisma or leave deprecated columns. Data loss is unacceptable. |
| **Always add columns as nullable** (or with default) | Non-nullable column additions fail on existing data. |
| **Never rename columns in production** | Use new column + backfill + deprecate old. |
| **Always use `prisma migrate dev` locally** | Generates SQL migration files that are committed to git. |
| **Always use `prisma migrate deploy` in production** | Applies pending migrations without generating new ones. |
| **Seed data is separate from migrations** | `prisma/seed.ts` runs via `prisma db seed`, not in migrations. |

### Schema File Organization

Single `schema.prisma` file (not split across files — Prisma doesn't natively support multi-file schemas in a stable way yet). Models are organized by comment sections:

```prisma
// ============================================
// ENUMS
// ============================================
// ... all enums ...

// ============================================
// PLATFORM LAYER
// ============================================
// Tenant, TenantSettings, User, Channel

// ============================================
// CORE CRM LAYER
// ============================================
// Contact, Conversation, Message, Order, OrderItem, Booking

// ============================================
// TASK & NOTIFICATION LAYER
// ============================================
// FollowUpTask, Reminder, Notification

// ============================================
// KNOWLEDGE & CONFIG LAYER
// ============================================
// KnowledgeDocument
// SalesPlaybook, PlaybookStep          (Phase 2)
// ObjectionRule                        (Phase 2)
// UpsellRule                           (Phase 3)

// ============================================
// AI & ANALYTICS LAYER
// ============================================
// AiRun
// LeadScore, ScoringRule               (Phase 2)
// ObjectionEvent                       (Phase 2)
// HandoffLog                           (Phase 2)
// DecisionIdentityProfile              (Phase 3)
```

---

## 8. Prisma-Specific Decisions

### ID Strategy

```prisma
id  String  @id @default(cuid())
```

Using `cuid()` instead of `uuid()`:
- Shorter than UUID (25 chars vs 36)
- Sortable by creation time (useful for cursor-based pagination)
- Collision-resistant
- URL-safe

### Timestamp Strategy

```prisma
createdAt  DateTime  @default(now())
updatedAt  DateTime  @updatedAt
```

Every model gets `createdAt`. Most get `updatedAt`. Exceptions:
- `Message` — immutable, no `updatedAt`
- `AiRun` — immutable log, no `updatedAt`
- `ObjectionEvent` — immutable log, no `updatedAt`
- `Notification` — only `isRead`/`readAt` change, still has `updatedAt` for simplicity

### Decimal Handling

```prisma
totalAmount  Decimal?  @db.Decimal(10, 2)
```

Using `Decimal` (not `Float`) for money. PostgreSQL `NUMERIC(10,2)` for precision.

### Tenant Scoping

Every model (except `Tenant` itself) has:

```prisma
tenantId  String
tenant    Tenant  @relation(fields: [tenantId], references: [id])
```

This is enforced at the schema level. Prisma middleware in the application layer auto-injects `tenantId` into every query.

### Soft Delete Strategy

**No global soft delete.** Only specific models need it:
- `Contact` — `status: LOST` or `INACTIVE` serves as soft delete
- `User` — `isActive: false` serves as soft delete
- `Message` — `isDeleted: true` for channel-deleted messages

Other models use real deletes. Cascade rules:
- `Order` → `OrderItem`: cascade delete
- `SalesPlaybook` → `PlaybookStep`: cascade delete
- Everything else: restrict (prevent deletion if child records exist)

### Prisma Client Extensions (Multi-Tenant)

Not in the schema file, but in the application code:

```typescript
// packages/database/src/middleware/tenant-scope.middleware.ts
// Prisma extension that auto-filters by tenantId on all find/update/delete
// and auto-injects tenantId on all create operations
```

This ensures that even if a developer forgets to add `where: { tenantId }`, the middleware catches it.

---

## 9. Pre-Generation Checklist

Before generating the actual Prisma schema, confirm:

- [x] 24 models total across 3 phases
- [x] Phase 1: 15 models (enough for MVP)
- [x] All Phase 2/3 enums defined upfront (avoid ALTER TYPE migrations)
- [x] Phase 2/3 fields on Phase 1 models are nullable (no unused NOT NULL columns)
- [x] JSON used for dynamic/config data, columns for queryable data
- [x] `cuid()` for IDs, `Decimal` for money, `DateTime` for timestamps
- [x] OrderItem simplified to `Json items` on Order for Phase 1
- [x] Reminder simplified to user-only recipients for Phase 1
- [x] All indexes planned per query patterns
- [x] Single schema file with section comments
- [x] Migration strategy: one initial migration for Phase 1, additive for Phase 2/3

---

## 10. Decision: Include Phase 2/3 Models in Initial Schema?

### Option A: Schema contains only Phase 1 models
- Pros: Cleaner schema, no unused models
- Cons: Phase 2 requires migration to add 7 models + relations

### Option B: Schema contains ALL 24 models from day 1
- Pros: No structural migrations later, relations are pre-defined
- Cons: Schema has models with no code using them

### Option C (Recommended): Schema contains Phase 1 models + Phase 2/3 enums
- Phase 1: All 15 models created
- Phase 2/3 enums defined but tables NOT created
- Phase 2/3 columns on Phase 1 models (e.g., `Conversation.leadScore`) are present but nullable
- Phase 2/3 models added via migration when code is ready

**This is the recommended approach.** It balances "don't create tables you don't use" with "prepare the schema for future expansion."

The Prisma schema file will have Phase 2/3 models as commented-out blocks with a clear `// Phase 2 — uncomment and migrate when ready` annotation. When Phase 2 development begins, uncomment the models and run `prisma migrate dev`.

---

Ready for actual `schema.prisma` generation on your signal.
