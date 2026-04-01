# AI Top Sales - Frontend Architecture Spec

> Version: 0.1 | Date: 2026-03-19
> Tech: Next.js 15 · App Router · TypeScript · Tailwind CSS · shadcn/ui

---

## 0. Frontend Design Philosophy

This is **not** a generic admin panel. It's the command center for a business owner or team managing their AI sales employee. Every screen should answer one of these questions:

- **What's happening right now?** → Dashboard, conversation inbox
- **Who are my customers?** → Contacts, contact detail
- **What has the AI done?** → Conversations, AI run logs
- **What needs my attention?** → Follow-ups, handoffs, reminders
- **What's coming up?** → Bookings calendar, upcoming deliveries
- **How do I teach the AI?** → Knowledge base, playbooks, objection rules

### UX Principles

1. **Inbox-first** — The conversation inbox is the home screen. Everything revolves around customer messages.
2. **Zero-training onboarding** — A restaurant owner in Hong Kong should understand the UI without documentation.
3. **Mobile-aware** — Not mobile-first, but the most-used pages (inbox, bookings, dashboard) must work on mobile.
4. **Chinese-native** — Default UI language is Traditional Chinese (zh-HK). Interface designed for CJK readability.
5. **Speed over features** — Fast page loads. SWR for data fetching. Optimistic UI updates.

---

## 1. App Sitemap

### Complete Page Map

```
/
├── (auth)                              PUBLIC PAGES (no sidebar)
│   ├── /login                          Login
│   └── /register                       Register (creates tenant + owner)
│
├── (dashboard)                         PROTECTED PAGES (sidebar layout)
│   │
│   ├── /                               Dashboard home (overview stats)
│   │
│   │── INBOX ─────────────────────────
│   ├── /conversations                  Conversation list (the main "inbox")
│   └── /conversations/[id]            Conversation detail (split view: list + thread)
│   │
│   │── CRM ───────────────────────────
│   ├── /contacts                       Contact list
│   ├── /contacts/[id]                 Contact detail (profile + timeline)
│   ├── /orders                         Order list
│   ├── /orders/[id]                   Order detail
│   ├── /bookings                       Booking list + calendar
│   └── /bookings/[id]                Booking detail
│   │
│   │── TASKS ─────────────────────────
│   ├── /follow-ups                     Follow-up task list
│   │
│   │── KNOWLEDGE ─────────────────────
│   ├── /knowledge-base                 Knowledge document list
│   ├── /knowledge-base/new            Create new document
│   └── /knowledge-base/[id]          Edit document
│   │
│   │── SETTINGS ──────────────────────
│   ├── /settings                       General business settings
│   ├── /settings/ai                   AI configuration (tone, greeting, model)
│   ├── /settings/team                 Team member management
│   └── /settings/channels             Channel connections (WhatsApp, web chat)
│   │
│   │── PHASE 2 ───────────────────────
│   ├── /pipeline                       Sales pipeline (Kanban board)
│   ├── /handoffs                       Handoff queue
│   ├── /playbooks                      Playbook list
│   ├── /playbooks/[id]               Playbook editor (steps)
│   ├── /objection-rules               Objection rule list
│   ├── /settings/scoring              Lead scoring rules
│   │
│   │── PHASE 3 ───────────────────────
│   ├── /analytics                      Advanced analytics dashboard
│   ├── /analytics/ai-performance      AI performance metrics
│   ├── /analytics/conversions         Conversion funnels
│   ├── /upsell-rules                   Upsell/cross-sell rules
│   └── /settings/decision-profiles    Decision identity config
│
└── /chat-widget                        PUBLIC: Embeddable web chat widget (standalone, no layout)
```

---

## 2. Phase-Based Page Map

### Phase 1 — AI Receptionist MVP (14 pages)

| Page | Route | Priority | Purpose |
|------|-------|----------|---------|
| Login | `/login` | Must | Auth |
| Register | `/register` | Must | Onboarding |
| **Dashboard** | `/` | **Must** | Overview stats: open conversations, today's bookings, pending follow-ups |
| **Conversations list** | `/conversations` | **Must** | The main inbox — where the boss spends most time |
| **Conversation detail** | `/conversations/[id]` | **Must** | Message thread + contact sidebar + AI actions |
| Contacts list | `/contacts` | Must | Customer list with search/filter |
| Contact detail | `/contacts/[id]` | Must | Profile, history, timeline |
| Orders list | `/orders` | Must | Order tracking |
| Order detail | `/orders/[id]` | Should | Order line items + status |
| **Bookings list** | `/bookings` | **Must** | Calendar + list view of appointments |
| Booking detail | `/bookings/[id]` | Should | Booking info + status actions |
| **Follow-ups** | `/follow-ups` | **Must** | Task list for boss/team |
| **Knowledge base** | `/knowledge-base` | **Must** | FAQ/product docs that power the AI |
| Knowledge doc editor | `/knowledge-base/[id]` | Must | Create/edit documents |
| Settings - General | `/settings` | Must | Business name, hours, currency |
| Settings - AI | `/settings/ai` | Must | Tone, greeting, model config |
| Settings - Team | `/settings/team` | Should | Invite/manage team members |
| Settings - Channels | `/settings/channels` | Must | Connect WhatsApp, enable web chat |

### Phase 2 — AI Sales Assistant (add 6 pages)

| Page | Route | Purpose |
|------|-------|---------|
| **Sales Pipeline** | `/pipeline` | Kanban board by lead state |
| **Handoff Queue** | `/handoffs` | Pending handoffs for human agents |
| Playbook list | `/playbooks` | Sales flow management |
| Playbook editor | `/playbooks/[id]` | Visual step editor |
| Objection rules | `/objection-rules` | Objection pattern + strategy CRUD |
| Scoring rules | `/settings/scoring` | Lead scoring dimension config |

### Phase 3 — AI Top Sales Agent (add 4 pages)

| Page | Route | Purpose |
|------|-------|---------|
| Analytics dashboard | `/analytics` | Conversion funnels, revenue attribution |
| AI performance | `/analytics/ai-performance` | Strategy effectiveness, prompt A/B |
| Upsell rules | `/upsell-rules` | Upsell/cross-sell rule CRUD |
| Decision profiles | `/settings/decision-profiles` | Decision identity type config |

---

## 3. UX Priorities — Demo-Ready MVP Core Screens

If we can only demo **5 pages** to close a sale, it's these:

### Screen 1: Dashboard (`/`)

```
┌─────────────────────────────────────────────────────────┐
│  AI Top Sales — 美麗髮廊                    🔔 3  👤    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ 對話中    │ │ 今日預約  │ │ 待跟進    │ │ 本月訂單  │   │
│  │    12    │ │    5     │ │    3     │ │   28     │   │
│  │ +4 today │ │ next: 2pm│ │ 1 overdue│ │ $12,400  │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│  ┌─ Recent Conversations ─────────────────────────────┐ │
│  │ 陳小姐  "我想預約星期六下午"    AI replied · 2min   │ │
│  │ 李先生  "你哋幾點收工？"        AI replied · 15min  │ │
│  │ Wong    "How much for haircut?" AI replied · 1hr    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Upcoming Bookings ────────────────────────────────┐ │
│  │ 14:00  陳小姐 — 剪髮  ✅ Confirmed                 │ │
│  │ 15:30  李太太 — 染髮  ⏳ Pending                    │ │
│  │ 17:00  張先生 — 剪髮  ✅ Confirmed                 │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Action Required ──────────────────────────────────┐ │
│  │ ⚠ 陳小姐 follow-up overdue (2 days)               │ │
│  │ 🔔 New booking request from WhatsApp               │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**What it proves**: Boss can see everything at a glance. AI is working 24/7.

### Screen 2: Conversation Inbox (`/conversations` + `/conversations/[id]`)

```
┌──────── Conversations ──────────────────────────────────┐
│ 🔍 Search          [All] [Open] [Waiting] [Handed Off]  │
├───────────────┬─────────────────────────────────────────┤
│               │                                         │
│ CONVERSATION  │  CONVERSATION DETAIL                    │
│ LIST          │                                         │
│               │  陳小姐 · WhatsApp · Active              │
│ ● 陳小姐      │  ┌─────────────────────────────────┐    │
│   我想預約... │  │ 陳小姐: 你好，我想預約星期六      │    │
│   2 min ago   │  │        下午剪髮                   │    │
│               │  │                                   │    │
│ ● 李先生      │  │ AI 小美: 你好陳小姐！😊 星期六     │    │
│   幾點收工？  │  │ 下午有空位，請問你想約幾點呢？     │    │
│   15 min ago  │  │                                   │    │
│               │  │ 陳小姐: 3點得唔得？               │    │
│ ○ Wong       │  │                                   │    │
│   How much.. │  │ AI 小美: 3點冇問題！已經幫你預約   │    │
│   1 hr ago   │  │ 咗星期六 15:00 剪髮。到時見！😊    │    │
│               │  └─────────────────────────────────┘    │
│               │                                         │
│               │  [Type a message as human agent...]      │
│               │                                         │
│               ├─────────────────────────────────────────┤
│               │  CONTACT SIDEBAR                        │
│               │  Name: 陳小姐                            │
│               │  Phone: 9123 4567                        │
│               │  Status: Active                         │
│               │  Tags: [Repeat Customer]                 │
│               │  Orders: 3 ($2,400)                      │
│               │  ─────────────────                       │
│               │  AI Strategy: FAQ_ANSWER                 │
│               │  Lead State: ENGAGED                     │
│               │  [Assign to me] [Close] [Handoff]       │
└───────────────┴─────────────────────────────────────────┘
```

**What it proves**: Boss can see every AI conversation, jump in anytime, and see customer profile alongside chat.

### Screen 3: Bookings Calendar (`/bookings`)

```
┌──────── Bookings ───────────────────────────────────────┐
│  [List view]  [Calendar view]         [+ New Booking]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ◀  March 2026  ▶                                       │
│                                                         │
│  Mon 16   Tue 17   Wed 18   Thu 19   Fri 20   Sat 21   │
│  ┌─────┐ ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  │
│  │10:00│ │     │  │09:30│  │     │  │14:00│  │10:00│  │
│  │陳小姐│ │     │  │李太太│  │     │  │陳小姐│  │張先生│  │
│  │剪髮 ✅│ │     │  │染髮 ✅│  │     │  │剪髮 ✅│  │剪髮 ⏳│  │
│  │     │ │     │  │     │  │     │  │     │  │     │  │
│  │15:00│ │     │  │14:00│  │     │  │16:00│  │14:00│  │
│  │王先生│ │     │  │Wong │  │     │  │李先生│  │陳小姐│  │
│  │按摩 ✅│ │     │  │Hair✅│  │     │  │剪髮 ⏳│  │剪髮 ✅│  │
│  └─────┘ └─────┘  └─────┘  └─────┘  └─────┘  └─────┘  │
│                                                         │
│  Today's Summary: 5 bookings · 2 confirmed · 1 pending  │
└─────────────────────────────────────────────────────────┘
```

**What it proves**: Boss can see the schedule, AI books appointments automatically.

### Screen 4: Knowledge Base (`/knowledge-base`)

```
┌──────── Knowledge Base ─────────────────────────────────┐
│  Your AI reads these docs to answer customer questions.  │
│                                           [+ New Doc]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Category: [All] [FAQ] [Pricing] [Services] [Policy]    │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 📄 服務價目表                          Pricing    │   │
│  │    男士剪髮 $180 / 女士剪髮 $280 / 染髮 $480...  │   │
│  │    Last edited: 2 days ago            [Edit]      │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ 📄 營業時間與地址                      FAQ        │   │
│  │    星期一至六 10:00-20:00，星期日休息...          │   │
│  │    Last edited: 1 week ago            [Edit]      │   │
│  ├──────────────────────────────────────────────────┤   │
│  │ 📄 預約須知                           Policy      │   │
│  │    預約需提前24小時，取消需提前12小時通知...      │   │
│  │    Last edited: 2 weeks ago           [Edit]      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**What it proves**: Non-technical boss can teach the AI by writing simple documents.

### Screen 5: Settings - AI (`/settings/ai`)

```
┌──────── AI Settings ────────────────────────────────────┐
│  Configure how your AI assistant behaves.               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  AI Name           [小美                    ]           │
│  AI Role           [美麗髮廊的專業顧問        ]           │
│                                                         │
│  Greeting Message                                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │ 你好！歡迎嚟到美麗髮廊！😊                        │   │
│  │ 有咩可以幫到你？                                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  Tone              (●) Friendly  ( ) Professional       │
│                    ( ) Casual    ( ) Luxury              │
│                                                         │
│  Language           [繁體中文 (香港)     ▾]              │
│                                                         │
│  Collect from customers                                 │
│  [✓] Name  [✓] Phone  [ ] Email  [ ] Company           │
│                                                         │
│  Auto-handoff to human                                  │
│  [✓] Enabled                                            │
│  Keywords: [真人] [客服] [經理] [+add]                  │
│                                                         │
│                                   [Save Changes]        │
└─────────────────────────────────────────────────────────┘
```

**What it proves**: Boss can customize AI personality without any code.

---

## 4. Page Layout Patterns

### Layout Pattern Reference

| Pattern | When to Use | Pages |
|---------|-------------|-------|
| **Split view** (list + detail) | High-frequency browsing with drill-down | Conversations, Contacts |
| **Table / list** | Paginated data with filters, sorting | Orders, Follow-ups, Reminders, AI Runs |
| **Card grid** | Visual overview with quick stats | Dashboard, Knowledge base |
| **Calendar** | Date-based records | Bookings |
| **Kanban board** | Stage-based workflow | Pipeline (Phase 2) |
| **Form** | Configuration, CRUD | Settings, Knowledge doc editor |
| **Timeline** | Chronological activity | Contact detail (activity tab) |
| **Chat thread** | Message-based interaction | Conversation detail |

### Page-by-Page Layout Assignments

| Page | Primary Layout | Detail |
|------|---------------|--------|
| `/` Dashboard | **Card grid** | 4 stat cards top, 2-column below (recent conversations + upcoming bookings + action items) |
| `/conversations` | **Split view** | Left: scrollable conversation list with preview. Right: message thread + contact sidebar. Persistent — clicking a conversation updates the right panel without full navigation. |
| `/conversations/[id]` | **Chat thread + sidebar** | Main: message bubbles (customer left, AI/agent right). Right sidebar: contact card, AI metadata, action buttons. |
| `/contacts` | **Table** | Searchable, filterable table. Columns: name, phone, status, last contact, total orders. Click → `/contacts/[id]`. |
| `/contacts/[id]` | **Profile + tabs** | Top: contact card (name, phone, email, tags). Tabs: [Conversations] [Orders] [Bookings] [Timeline]. Each tab is a list. |
| `/orders` | **Table** | Filterable by status. Columns: order #, customer, items, amount, status, date. |
| `/orders/[id]` | **Detail card** | Order info + line items + status actions (confirm, complete, cancel). |
| `/bookings` | **Calendar + list toggle** | Default: weekly calendar view. Toggle to list view. Each booking is a card on the calendar. |
| `/bookings/[id]` | **Detail card** | Booking info + status actions + reminder status. |
| `/follow-ups` | **Table** | Columns: task, contact, due date, priority, status, assigned to. Filter by status/assignee. |
| `/knowledge-base` | **Card list** | Docs as cards with title, preview, category badge, edit button. Filter by category. Drag-to-reorder. |
| `/knowledge-base/[id]` | **Form** | Rich text editor for document content. Category selector. Active toggle. |
| `/settings/*` | **Form** | Grouped form sections with save button. |
| `/pipeline` (P2) | **Kanban board** | Columns: NEW → ENGAGED → QUALIFIED → PROPOSING → CLOSING → WON. Cards are conversations. Drag to move. |
| `/handoffs` (P2) | **Table** | Pending handoffs with AI summary preview. Actions: accept, resolve. |
| `/playbooks` (P2) | **Card list** | Playbooks as cards. Click to edit. |
| `/playbooks/[id]` (P2) | **Visual flow editor** | Vertical step list. Each step: action type, config, next step. Drag to reorder. |
| `/objection-rules` (P2) | **Table** | Rules with pattern, category, strategy, success rate. Inline edit. |
| `/analytics` (P3) | **Dashboard** | Charts: conversion funnel, revenue over time, strategy effectiveness, AI cost. |

---

## 5. Reusable UI Components

### Primitive Components (shadcn/ui based)

These come from shadcn/ui and are installed into `components/ui/`. We customize them once.

```
components/ui/
├── button.tsx              Primary, secondary, ghost, destructive, outline variants
├── input.tsx               Text input with label + error state
├── textarea.tsx            Multi-line input
├── select.tsx              Dropdown select
├── checkbox.tsx
├── radio-group.tsx
├── switch.tsx              Toggle switch
├── badge.tsx               Status badges (colored by status)
├── avatar.tsx              User/contact avatar with fallback initials
├── card.tsx                Card container
├── dialog.tsx              Modal dialog
├── sheet.tsx               Slide-over panel (mobile nav, filters)
├── dropdown-menu.tsx       Context menus, action menus
├── tabs.tsx                Tab navigation
├── table.tsx               Data table (header, body, row, cell)
├── skeleton.tsx            Loading skeleton
├── toast.tsx               Toast notifications
├── tooltip.tsx
├── separator.tsx
├── scroll-area.tsx
├── popover.tsx
└── command.tsx             Command palette / search (Phase 2)
```

### Layout Components

```
components/layout/
├── sidebar.tsx             Main navigation sidebar
│                           - Collapsed on mobile, expanded on desktop
│                           - Sections: Inbox, CRM, Tasks, Knowledge, Settings
│                           - Notification badge on Inbox
│                           - Active state on current page
├── topbar.tsx              Top bar with:
│                           - Business name / logo
│                           - Notification bell with unread count
│                           - User avatar dropdown (profile, logout)
├── mobile-nav.tsx          Bottom tab bar on mobile (5 tabs: Home, Inbox, Bookings, Tasks, More)
├── page-header.tsx         Page title + description + action buttons (e.g., "+ New Booking")
├── page-container.tsx      Max-width container with padding
└── empty-state.tsx         "No data yet" illustration + CTA
```

### Domain Components — Conversations

```
components/conversations/
├── conversation-list.tsx           Scrollable list of conversation previews
├── conversation-list-item.tsx      Single item: avatar, name, preview, time, unread badge
├── conversation-filters.tsx        Status filter tabs + channel filter + search
├── message-thread.tsx              Scrollable message list with auto-scroll-to-bottom
├── message-bubble.tsx              Single message: content, sender, timestamp
│                                   - Customer bubbles: left, gray
│                                   - AI bubbles: right, blue, with "AI" badge
│                                   - Human agent bubbles: right, green, with agent name
│                                   - System messages: center, muted
├── message-input.tsx               Text input + send button (for human agent takeover)
├── conversation-sidebar.tsx        Contact info + AI metadata + actions panel
├── ai-strategy-badge.tsx           Shows which AI strategy was used (FAQ, booking, etc.)
└── handoff-banner.tsx              Banner when conversation is handed off to human
```

### Domain Components — Contacts

```
components/contacts/
├── contact-card.tsx                Compact card: avatar, name, phone, status badge
├── contact-detail-header.tsx       Full header: avatar, name, all fields, tags, edit button
├── contact-timeline.tsx            Chronological activity feed (messages, bookings, orders, follow-ups)
├── contact-timeline-item.tsx       Single timeline item with icon, description, timestamp
├── contact-tags.tsx                Tag pills with add/remove
└── contact-merge-dialog.tsx        Merge duplicate contacts (Phase 2)
```

### Domain Components — Bookings

```
components/bookings/
├── booking-calendar.tsx            Weekly calendar grid (uses a lightweight calendar lib)
├── booking-calendar-event.tsx      Single booking block on calendar
├── booking-card.tsx                Card: title, time, contact, status badge
├── booking-status-badge.tsx        Colored badge: confirmed=green, pending=yellow, cancelled=red
├── booking-form.tsx                Create/edit form: contact, service, date, time, notes
└── booking-actions.tsx             Status action buttons: confirm, cancel, complete, no-show
```

### Domain Components — Orders

```
components/orders/
├── order-card.tsx                  Card: order #, contact, items summary, amount, status
├── order-status-badge.tsx
├── order-items-table.tsx           Line items table within order detail
└── order-form.tsx                  Create/edit form
```

### Domain Components — Follow-ups & Tasks

```
components/follow-ups/
├── follow-up-list.tsx              Task list with priority indicators
├── follow-up-card.tsx              Task card: title, contact, due date, priority, status
├── follow-up-form.tsx              Create/edit form
└── follow-up-complete-dialog.tsx   Dialog to mark complete with outcome text
```

### Domain Components — Knowledge Base

```
components/knowledge-base/
├── document-list.tsx               Card list of documents, with drag-to-reorder
├── document-card.tsx               Card: title, preview, category badge, last edited
├── document-editor.tsx             Markdown/rich text editor for document content
├── document-form.tsx               Title, category, content, active toggle
└── category-filter.tsx             Category filter pills
```

### Domain Components — Dashboard

```
components/dashboard/
├── stat-card.tsx                   Metric card: label, value, trend indicator
├── recent-conversations.tsx        List of latest conversations with status
├── upcoming-bookings.tsx           Today's bookings timeline
├── action-required.tsx             Urgent items: overdue follow-ups, handoff requests
└── activity-chart.tsx              Simple bar/line chart (Phase 2, using Recharts)
```

### Domain Components — Settings

```
components/settings/
├── settings-section.tsx            Grouped form section with title + description
├── ai-tone-selector.tsx            Visual tone picker (friendly/professional/casual/luxury)
├── business-hours-editor.tsx       Day-by-day hours editor
├── collect-fields-editor.tsx       Checkbox list of fields AI should collect
├── channel-connection-card.tsx     Channel status card with connect/disconnect actions
└── team-member-list.tsx            Team member table with role selector
```

### Shared Composite Components

```
components/shared/
├── data-table.tsx                  Generic data table with:
│                                   - Column definitions
│                                   - Sorting (client-side for small data, server-side for large)
│                                   - Pagination
│                                   - Row click handler
│                                   - Empty state
├── status-badge.tsx                Generic status badge (maps enum → color)
├── source-badge.tsx                Source badge (AI / Human / Manual)
├── date-display.tsx                Relative time ("2 min ago") or absolute ("2026-03-19 15:00")
├── currency-display.tsx            Formatted currency ("HK$280.00")
├── search-input.tsx                Debounced search input with icon
├── filter-bar.tsx                  Horizontal filter pills/dropdowns
├── pagination.tsx                  Page navigation (previous/next + page numbers)
├── confirm-dialog.tsx              "Are you sure?" confirmation dialog
├── loading-spinner.tsx             Centered spinner
├── notification-bell.tsx           Bell icon with unread count badge
└── user-avatar-menu.tsx            Avatar dropdown: profile, settings, logout
```

---

## 6. Frontend Folder Structure

```
apps/web/
├── app/                                    APP ROUTER
│   │
│   ├── (auth)/                             Public pages (no sidebar)
│   │   ├── login/
│   │   │   └── page.tsx
│   │   ├── register/
│   │   │   └── page.tsx
│   │   └── layout.tsx                      Centered card layout, no nav
│   │
│   ├── (dashboard)/                        Protected pages (sidebar)
│   │   ├── layout.tsx                      Sidebar + topbar + auth guard + notification provider
│   │   ├── page.tsx                        Dashboard home
│   │   │
│   │   ├── conversations/
│   │   │   ├── page.tsx                    Conversation list (also renders split view)
│   │   │   ├── [id]/
│   │   │   │   └── page.tsx               Conversation detail (full-page on mobile)
│   │   │   └── layout.tsx                 Split view layout (list left, detail right) — optional
│   │   │
│   │   ├── contacts/
│   │   │   ├── page.tsx                    Contact table
│   │   │   └── [id]/
│   │   │       └── page.tsx               Contact detail with tabs
│   │   │
│   │   ├── orders/
│   │   │   ├── page.tsx                    Order table
│   │   │   └── [id]/
│   │   │       └── page.tsx               Order detail
│   │   │
│   │   ├── bookings/
│   │   │   ├── page.tsx                    Booking calendar + list
│   │   │   └── [id]/
│   │   │       └── page.tsx               Booking detail
│   │   │
│   │   ├── follow-ups/
│   │   │   └── page.tsx                    Follow-up task list
│   │   │
│   │   ├── knowledge-base/
│   │   │   ├── page.tsx                    Document list
│   │   │   ├── new/
│   │   │   │   └── page.tsx               New document form
│   │   │   └── [id]/
│   │   │       └── page.tsx               Edit document
│   │   │
│   │   ├── settings/
│   │   │   ├── page.tsx                    General settings
│   │   │   ├── ai/
│   │   │   │   └── page.tsx               AI configuration
│   │   │   ├── team/
│   │   │   │   └── page.tsx               Team management
│   │   │   ├── channels/
│   │   │   │   └── page.tsx               Channel connections
│   │   │   └── layout.tsx                 Settings sidebar/tabs layout
│   │   │
│   │   │── ─── PHASE 2 PAGES ──────────────
│   │   ├── pipeline/
│   │   │   └── page.tsx                    Sales Kanban board
│   │   ├── handoffs/
│   │   │   └── page.tsx                    Handoff queue
│   │   ├── playbooks/
│   │   │   ├── page.tsx                    Playbook list
│   │   │   └── [id]/
│   │   │       └── page.tsx               Playbook step editor
│   │   ├── objection-rules/
│   │   │   └── page.tsx                    Objection rule table
│   │   │
│   │   │── ─── PHASE 3 PAGES ──────────────
│   │   ├── analytics/
│   │   │   ├── page.tsx                    Analytics overview
│   │   │   ├── ai-performance/
│   │   │   │   └── page.tsx               AI metrics
│   │   │   └── conversions/
│   │   │       └── page.tsx               Conversion funnels
│   │   └── upsell-rules/
│   │       └── page.tsx                    Upsell rule table
│   │
│   ├── chat-widget/                        Public embeddable chat widget
│   │   ├── page.tsx                        Standalone chat UI (iframe-able)
│   │   └── layout.tsx                      Minimal layout, no sidebar
│   │
│   ├── layout.tsx                          Root layout: html, body, font, providers
│   ├── globals.css                         Tailwind base + custom CSS variables
│   ├── not-found.tsx                       404 page
│   └── loading.tsx                         Root loading state
│
├── components/                             SHARED UI COMPONENTS
│   ├── ui/                                 shadcn/ui primitives (button, input, card, dialog, etc.)
│   ├── layout/                             Sidebar, topbar, mobile-nav, page-header
│   ├── shared/                             Data-table, status-badge, pagination, search-input, etc.
│   ├── conversations/                      Conversation-specific components
│   ├── contacts/                           Contact-specific components
│   ├── bookings/                           Booking-specific components
│   ├── orders/                             Order-specific components
│   ├── follow-ups/                         Follow-up-specific components
│   ├── knowledge-base/                     Knowledge-base-specific components
│   ├── dashboard/                          Dashboard widgets
│   └── settings/                           Settings-specific components
│
├── lib/                                    UTILITIES & INFRA
│   ├── api-client.ts                       Fetch wrapper with auth header injection
│   │                                       - Automatically attaches JWT
│   │                                       - Handles 401 → refresh token → retry
│   │                                       - Handles network errors with toast
│   │                                       - Typed: api.get<Contact[]>('/contacts')
│   ├── auth.ts                             Token storage (localStorage), refresh logic
│   ├── utils.ts                            cn(), formatDate(), formatCurrency(), etc.
│   ├── constants.ts                        API_URL, pagination defaults, etc.
│   └── navigation.ts                       Sidebar nav items (with phase-based visibility)
│
├── hooks/                                  CUSTOM HOOKS
│   ├── use-auth.ts                         Auth state: user, isAuthenticated, login(), logout()
│   ├── use-api.ts                          Generic SWR wrapper: useApi<T>(url, options)
│   │                                       - Returns { data, error, isLoading, mutate }
│   │                                       - Auto-refreshes on window focus
│   │                                       - Deduplicates identical requests
│   ├── use-conversations.ts                useConversations(filters), useConversation(id)
│   ├── use-contacts.ts                     useContacts(filters), useContact(id)
│   ├── use-bookings.ts                     useBookings(filters), useBooking(id)
│   ├── use-orders.ts                       useOrders(filters), useOrder(id)
│   ├── use-follow-ups.ts                   useFollowUps(filters)
│   ├── use-knowledge-base.ts               useKnowledgeDocs(), useKnowledgeDoc(id)
│   ├── use-notifications.ts                useNotifications(), useUnreadCount()
│   ├── use-dashboard.ts                    useDashboardStats()
│   ├── use-tenant-settings.ts              useTenantSettings(), useUpdateSettings()
│   ├── use-debounce.ts                     Debounced value for search inputs
│   └── use-media-query.ts                  Responsive breakpoint detection
│
├── stores/                                 CLIENT STATE (minimal)
│   └── auth-store.ts                       Zustand store: token, user, tenant info
│   │                                       Only auth state is in client store.
│   │                                       All server data is in SWR cache.
│
├── types/                                  FRONTEND TYPES
│   ├── api.ts                              API response types (mirroring backend DTOs)
│   │                                       - Tenant, User, Contact, Conversation, Message, etc.
│   │                                       - NOT imported from @ats/database (no Prisma types)
│   │                                       - Shared enums come from @ats/shared
│   └── navigation.ts                       Nav item type definitions
│
├── public/
│   ├── favicon.ico
│   └── images/
│       ├── logo.svg
│       └── empty-state.svg
│
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
└── package.json
```

---

## 7. Data Fetching Strategy

### SWR as Primary Data Layer

```typescript
// hooks/use-api.ts — Generic pattern
export function useApi<T>(url: string | null, options?: SWRConfiguration) {
  return useSWR<ApiResponse<T>>(url, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 2000,
    ...options,
  });
}

// hooks/use-conversations.ts — Domain-specific
export function useConversations(filters: ConversationFilters) {
  const params = new URLSearchParams(filters as any);
  return useApi<PaginatedResult<Conversation>>(`/conversations?${params}`);
}

export function useConversation(id: string) {
  return useApi<Conversation>(id ? `/conversations/${id}` : null);
}

export function useConversationMessages(id: string, page = 1) {
  return useApi<PaginatedResult<Message>>(
    id ? `/conversations/${id}/messages?page=${page}` : null
  );
}
```

### Data Fetching Rules

| Concern | Approach |
|---------|----------|
| **List pages** | SWR with query params for filters/pagination. Server-side pagination always. |
| **Detail pages** | SWR with ID. Preload from list data via `fallbackData`. |
| **Mutations** | `api.post/patch/delete` → on success, call `mutate()` to revalidate SWR cache |
| **Optimistic updates** | For quick actions (mark as read, status change). Revert on error. |
| **Polling** | `/conversations` polls every 10s for new messages (Phase 1). Replace with WebSocket in Phase 2. |
| **Auth** | JWT in memory (Zustand store). Refresh token in httpOnly cookie. Auto-refresh on 401. |

### Server Components vs Client Components

| Type | Use For |
|------|---------|
| **Server Components** (default) | Page layouts, static content, SEO pages (login, register) |
| **Client Components** (`'use client'`) | Interactive pages: data tables, forms, chat threads, calendar |

In practice, most dashboard pages will be client components because they need SWR, interactivity, and real-time updates.

```
app/(dashboard)/page.tsx                 → Server component (shell)
  └── components/dashboard/stat-cards.tsx → Client component ('use client', uses SWR)
  └── components/dashboard/recent.tsx    → Client component
```

---

## 8. Sidebar Navigation Structure

```typescript
// lib/navigation.ts

export const NAV_ITEMS: NavSection[] = [
  {
    title: null,  // no section title for top items
    items: [
      { label: '主頁', icon: Home, href: '/', phase: 1 },
    ],
  },
  {
    title: '收件箱',
    items: [
      { label: '對話', icon: MessageSquare, href: '/conversations', phase: 1, badge: 'unreadCount' },
      { label: '交接', icon: UserCheck, href: '/handoffs', phase: 2 },
    ],
  },
  {
    title: 'CRM',
    items: [
      { label: '客戶', icon: Users, href: '/contacts', phase: 1 },
      { label: '訂單', icon: ShoppingBag, href: '/orders', phase: 1 },
      { label: '預約', icon: Calendar, href: '/bookings', phase: 1 },
      { label: '銷售管道', icon: Kanban, href: '/pipeline', phase: 2 },
    ],
  },
  {
    title: '任務',
    items: [
      { label: '跟進', icon: ListTodo, href: '/follow-ups', phase: 1 },
    ],
  },
  {
    title: 'AI 設定',
    items: [
      { label: '知識庫', icon: BookOpen, href: '/knowledge-base', phase: 1 },
      { label: '銷售劇本', icon: FileText, href: '/playbooks', phase: 2 },
      { label: '異議處理', icon: Shield, href: '/objection-rules', phase: 2 },
      { label: '追加銷售', icon: TrendingUp, href: '/upsell-rules', phase: 3 },
    ],
  },
  {
    title: '分析',
    items: [
      { label: '數據分析', icon: BarChart3, href: '/analytics', phase: 3 },
    ],
  },
  {
    title: '設定',
    items: [
      { label: '設定', icon: Settings, href: '/settings', phase: 1 },
    ],
  },
];
```

Phase-based visibility: items with `phase > currentTenantPlan` are hidden (not shown at all, not grayed out). This keeps the UI clean for Starter users.

---

## 9. Phase-Based Feature Gating

```typescript
// hooks/use-feature-gate.ts

const PLAN_FEATURES: Record<TenantPlan, number> = {
  STARTER: 1,
  GROWTH: 2,
  ELITE: 3,
};

export function useFeatureGate() {
  const { tenant } = useAuth();
  const planLevel = PLAN_FEATURES[tenant.plan];

  return {
    hasPhase: (phase: number) => planLevel >= phase,
    plan: tenant.plan,
  };
}

// Usage in sidebar:
const { hasPhase } = useFeatureGate();
const visibleItems = NAV_ITEMS.map(section => ({
  ...section,
  items: section.items.filter(item => hasPhase(item.phase)),
}));
```

Pages also check feature gates. If a user manually navigates to `/pipeline` on a Starter plan, they see an upgrade prompt, not a broken page.

---

## 10. Responsive Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| **Mobile** | < 768px | Bottom tab nav, full-screen pages, no split view |
| **Tablet** | 768–1024px | Collapsible sidebar, split view for conversations |
| **Desktop** | > 1024px | Fixed sidebar (240px), split views, multi-column layouts |

### Mobile-Specific Adaptations

| Page | Desktop | Mobile |
|------|---------|--------|
| Conversations | Split view (list + thread side by side) | Full-screen list → tap → full-screen thread |
| Dashboard | 4-column stat cards | 2-column stat cards, stacked sections |
| Bookings | Week calendar | Day view or list view |
| Settings | Sidebar tabs | Stacked sections or full-screen pages |
| Contact detail | Profile header + tabs inline | Profile header → tab pages |

---

## 11. Technology Choices

| Concern | Choice | Reason |
|---------|--------|--------|
| CSS | Tailwind CSS 4 | Utility-first, consistent, fast iteration |
| Component lib | shadcn/ui | Not a dependency — components are copied into project, fully customizable |
| Icons | Lucide React | Clean, consistent, tree-shakeable |
| Data fetching | SWR | Lightweight, cache-first, stale-while-revalidate pattern |
| Client state | Zustand | Minimal — only auth state. Server data in SWR. |
| Forms | React Hook Form + Zod | Validation, performance, type inference |
| Date handling | date-fns | Tree-shakeable, immutable, locale support (zh-HK) |
| Calendar | Custom or @schedule-x/react | Lightweight week/day calendar (not FullCalendar — too heavy) |
| Charts (Phase 2+) | Recharts | Simple, React-native, responsive |
| Rich text editor | Tiptap or Textarea (Phase 1) | Phase 1: plain textarea for knowledge docs. Phase 2: upgrade to Tiptap if needed. |
| Toast | Sonner | Beautiful, lightweight toast notifications |
| Drag-and-drop (Phase 2) | @dnd-kit | For kanban board, playbook step reorder |

---

## 12. Phase 1 Build Order

What to build first for the fastest path to a working demo:

```
Week 1: Foundation
  ├── Next.js setup, Tailwind, shadcn/ui primitives
  ├── Auth pages (login, register)
  ├── Dashboard layout (sidebar, topbar)
  ├── API client + SWR hooks
  └── Auth flow (JWT, protected routes)

Week 2: Core Pages
  ├── Dashboard home (stat cards + recent conversations + upcoming bookings)
  ├── Conversation list + detail (split view + message thread)
  ├── Contact list + detail
  └── Message input (human agent takeover)

Week 3: Business Pages
  ├── Booking list + calendar + detail
  ├── Order list + detail
  ├── Follow-up task list
  └── Knowledge base (list + editor)

Week 4: Settings + Polish
  ├── Settings pages (general, AI, team, channels)
  ├── Notification bell + dropdown
  ├── Empty states, loading states, error states
  ├── Mobile responsive pass
  └── Demo-ready polish
```
