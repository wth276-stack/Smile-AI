# Implementation Note: Conversation Thread Visibility

> Version: 2026-03-28
> Scope: `apps/web/app/(dashboard)/dashboard/conversations/[id]/page.tsx`
> Related: `docs/acceptance-notes.md`, Priority A/B/C

This document outlines small, focused improvements to the conversation thread page without broad refactoring.

---

## Current State

The conversation detail page (`conversations/[id]/page.tsx`) displays:
- Contact name or phone
- Channel and status (raw strings)
- Message list (customer/AI bubbles)

**Missing:**
- AI intent and action visibility
- Extracted slots display
- Booking link when booking was created
- Styled status badge
- AiRun context (signals, side effects)

---

## Proposed Changes

### 1. Status Badge (Small, Additive)

**File:** `apps/web/app/(dashboard)/dashboard/conversations/[id]/page.tsx`

**Change:** Replace raw status string with styled badge.

```tsx
// Current
<p>{conv.channel} · {conv.status} · {conv.messages.length} 則訊息</p>

// After
function ConversationStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    OPEN: 'bg-green-100 text-green-800',
    CLOSED: 'bg-gray-100 text-gray-600',
    HANDOFF: 'bg-yellow-100 text-yellow-800',
  };
  const labels: Record<string, string> = {
    OPEN: '進行中',
    CLOSED: '已結束',
    HANDOFF: '轉交',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  );
}

// Usage
<p className="text-sm text-[var(--muted-foreground)]">
  <ChannelBadge channel={conv.channel} />
  <ConversationStatusBadge status={conv.status} />
  <span className="ml-2">{conv.messages.length} 則訊息</span>
</p>
```

**Impact:** ~10 lines added, no refactor.

---

### 2. Extracted Slots Display (Medium, Additive)

**Prerequisite:** API must return `AiRun` data for conversation. Check if `/api/conversations/:id` includes `aiRuns` or similar.

**If API returns `aiRuns`:**

```tsx
interface AiRun {
  id: string;
  status: string;
  signals: {
    intents: string[];
    action: string;
    bookingDraft?: {
      serviceName: string | null;
      serviceDisplayName: string | null;
      date: string | null;
      time: string | null;
      customerName: string | null;
      phone: string | null;
    };
  };
  sideEffects: Array<{ type: string; data: Record<string, unknown> }>;
  createdAt: string;
}

function SlotDisplay({ draft }: { draft: BookingDraft }) {
  if (!draft || !draft.serviceName) return null;

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
      <h4 className="text-sm font-medium text-blue-800">提取的預約資料</h4>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        {draft.serviceDisplayName && (
          <>
            <dt className="text-blue-600">服務</dt>
            <dd>{draft.serviceDisplayName}</dd>
          </>
        )}
        {draft.date && (
          <>
            <dt className="text-blue-600">日期</dt>
            <dd>{draft.date}</dd>
          </>
        )}
        {draft.time && (
          <>
            <dt className="text-blue-600">時間</dt>
            <dd>{draft.time}</dd>
          </>
        )}
        {draft.customerName && (
          <>
            <dt className="text-blue-600">姓名</dt>
            <dd>{draft.customerName}</dd>
          </>
        )}
        {draft.phone && (
          <>
            <dt className="text-blue-600">電話</dt>
            <dd>{draft.phone}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
```

**Location:** Above or below message list.

**Impact:** ~30 lines added, requires API check.

---

### 3. Booking Link (Small, Conditional)

**Prerequisite:** Check if conversation has related booking via side effects or separate API.

```tsx
function BookingLink({ sideEffects }: { sideEffects: SideEffect[] }) {
  const booking = sideEffects.find(e => e.type === 'CREATE_BOOKING');
  if (!booking) return null;

  // Note: booking.data may not include ID; may need separate lookup
  return (
    <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3">
      <p className="text-sm text-green-800">
        📅 已建立預約
        {/* Link to booking detail if ID available */}
        {/* <Link href={`/dashboard/bookings/${bookingId}`} className="ml-2 underline">查看詳情</Link> */}
      </p>
    </div>
  );
}
```

**Impact:** ~15 lines, may require backend work to expose booking ID.

---

### 4. Intent Badge (Small, Additive)

Display detected intent on AI messages.

```tsx
function IntentBadge({ intent }: { intent: string }) {
  const styles: Record<string, string> = {
    BOOKING_REQUEST: 'bg-purple-100 text-purple-800',
    PRICE_INQUIRY: 'bg-blue-100 text-blue-800',
    PRODUCT_INQUIRY: 'bg-green-100 text-green-800',
    GREETING: 'bg-gray-100 text-gray-600',
    FAQ: 'bg-yellow-100 text-yellow-800',
    OTHER: 'bg-gray-50 text-gray-500',
  };
  const labels: Record<string, string> = {
    BOOKING_REQUEST: '預約',
    PRICE_INQUIRY: '價格查詢',
    PRODUCT_INQUIRY: '產品查詢',
    GREETING: '問候',
    FAQ: 'FAQ',
    OTHER: '其他',
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${styles[intent] || 'bg-gray-50'}`}>
      {labels[intent] || intent}
    </span>
  );
}
```

**Location:** In AI message bubble, below text.

**Impact:** ~20 lines, requires API to return intent per message or per AiRun.

---

## API Requirements

To fully implement slots and intent display, the API needs to return:

```tsx
// GET /api/conversations/:id response enhancement
interface ConversationDetailWithAiRuns extends ConversationDetail {
  aiRuns?: AiRun[];  // Latest AiRun per turn
  latestSignals?: {
    intents: string[];
    action: string;
    bookingDraft: BookingDraft | null;
  };
  relatedBookingId?: string | null;
}
```

**If API doesn't support this yet:**
- Document as "requires backend work"
- Implement badge-only changes now
- File follow-up issue for API enhancement

---

## Implementation Order

1. **Status Badge** — No dependencies, ~10 lines
2. **Intent Badge** — Requires API check, ~20 lines
3. **Slot Display** — Requires API check, ~30 lines
4. **Booking Link** — Requires backend work, ~15 lines

**Recommendation:** Start with Status Badge, verify API support before proceeding.

---

## Files to Change

| File | Change Type | Lines |
|------|-------------|-------|
| `apps/web/app/(dashboard)/dashboard/conversations/[id]/page.tsx` | Enhance | ~75 total |

---

## Testing

```bash
# Seed demo data
cd packages/database && npx tsx prisma/seed-demo.ts

# Test conversation page
# 1. Send chat message via API
# 2. Navigate to /dashboard/conversations/{id}
# 3. Verify status badge, slots (if API supports), booking link (if any)
```

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2026-03-28 | Initial version | frontend-docs-status |