# Demo Script

## Goal

Keep the demo under 12 minutes.

Prove:
1. The AI answers real service, price, and FAQ questions.
2. The AI collects booking details and confirms before creating a booking.
3. The AI can reschedule and cancel safely.
4. The same engine works beyond one industry.

## Before The Demo

Run:

```powershell
$env:API_BASE="https://atsapi-production-ad45.up.railway.app"
pnpm run smoke:industries
```

Expected:

```text
Multi-industry smoke passed (beauty, cleaning, yoga).
```

Latest local smoke also passed on `http://localhost:3002`:

```powershell
$env:API_BASE="http://localhost:3002"
pnpm run smoke:mvp
pnpm run smoke:industries
```

Open:
- Demo chat.
- Bookings dashboard.
- Conversations dashboard.
- KB page only if the customer asks how answers are controlled.

## Opening

Say:

> Most service businesses lose customers because WhatsApp replies are slow, staff repeat the same answers all day, and booking details are collected back and forth. I will show how the AI answers questions, collects bookings, and confirms before making changes.

Then:

> I will use a beauty salon first, then show cleaning and yoga quickly to prove this is a generic appointment engine, not a hardcoded beauty chatbot.

## Scene 1: Price And Effect

Type:

```text
HIFU 幾錢？效果可以維持幾耐？
```

Expected:
- Exact price / promo price from KB.
- Effect duration.
- Short reply.
- No emoji.

Say:

> These facts come from the approved business knowledge base. If the price is not in the KB, the AI should not invent one.

## Scene 2: FAQ

Type:

```text
你哋地址喺邊？可以點付款？
```

Expected:
- Address/payment answered from KB.
- No long explanation.

Say:

> This removes repetitive staff replies for common questions.

## Scene 3: Recommendation

Type:

```text
我面有啲鬆，想提升輪廓，有咩推介？
```

Expected:
- Recommends relevant service.
- Does not invent a service.

Say:

> The AI can sell naturally, but only from services the business actually offers.

## Scene 4: Unknown Service Guardrail

Type:

```text
你哋有冇牙齒美白？幾錢？
```

Expected:
- No invented price.
- Says info is not available / staff can help check.

Say:

> This is one of the most important safety points: no made-up price.

## Scene 5: Create Booking

Type:

```text
我想預約深層清潔 Facial
```

Expected:
- AI enters booking flow.
- AI asks for missing details.

Then type:

```text
5月16號11點，我叫陳小明，電話91234567
```

Expected:
- AI summarizes service/date/time/name/phone.
- AI asks for confirmation.
- No booking is created yet.

Then type:

```text
確認
```

Expected:
- Booking is created.
- Booking appears in dashboard.

Say:

> The AI only creates the booking after the customer confirms.

## Scene 6: Reschedule

Type:

```text
我想改去5月18號下晝3點
```

Expected:
- AI confirms new date/time.
- It does not modify yet.

Then type:

```text
確認
```

Expected:
- Booking time changes in dashboard.

Say:

> Rescheduling is one of the common staff time drains. This flow handles it with confirmation.

## Scene 7: Cancel

Type:

```text
取消呢個booking
```

Expected:
- AI asks for cancellation confirmation.

Then type:

```text
確認取消
```

Expected:
- Booking is cancelled.

Say:

> Same principle: the AI confirms before changing the booking.

## Scene 8: Multi-Industry Proof

Switch to Cleaning.

Type:

```text
全屋深層清潔幾錢？包唔包清潔用品？
```

Expected:
- Price and FAQ are answered from cleaning KB.

Switch to Yoga.

Type:

```text
私人瑜珈課幾錢？我係初學者適唔適合？
```

Expected:
- Price and suitability are answered from yoga KB.

Say:

> Same engine, different service list and FAQs. That is why this works for appointment-based businesses, not only beauty salons.

## Close

Say:

> For pilot customers, we do assisted setup. You send us your services, prices, FAQs, opening hours, and booking rules. We set it up, test it, and hand over a working AI receptionist.

Ask:

> If this can reduce missed WhatsApp enquiries and help collect bookings after hours, would it be useful for your team?
