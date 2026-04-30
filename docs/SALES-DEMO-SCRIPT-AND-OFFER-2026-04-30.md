# Sales Demo Script and Pilot Offer - 2026-04-30

## Positioning

One-line pitch:

> We help appointment-based service businesses turn WhatsApp into a 24/7 AI receptionist that answers enquiries, quotes prices from your service list, collects booking details, confirms bookings, and hands off to staff when needed.

Use this positioning:
- Appointment AI for service businesses.
- AI WhatsApp receptionist for enquiry + booking.
- Guided setup, not self-serve SaaS yet.

Avoid this positioning:
- General chatbot.
- Fully self-serve SaaS.
- Replacement for all staff.
- Medical/legal/financial advice AI.
- Full CRM/dashboard replacement.

## Demo Goal

The demo should prove three things:

1. The AI can answer service and price questions from KB.
2. The AI can collect booking details and confirm before creating a booking.
3. The AI can modify/cancel bookings safely.

Keep the demo under 12 minutes.

## Pre-Demo Checklist

Before a real customer demo:

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
- Public demo chat.
- Dashboard bookings page.
- Dashboard conversations page.
- Dashboard KB/service page if needed.

Do not start by explaining the whole dashboard. Start with the chat.

## Opening Talk Track

Say:

> Most service businesses lose customers because WhatsApp replies are slow, prices are repeated manually, and booking details are collected back and forth. This demo shows how the AI can answer common questions and collect bookings automatically, while still using only your approved service list and FAQs.

Then:

> I will show a beauty salon example first, then briefly show cleaning and yoga to prove it is not hardcoded to one industry.

## Live Demo Scene 1: Price and Effect

Type:

```text
HIFU 幾錢？效果可以維持幾耐？
```

Expected:
- Reply includes exact price / promo price from KB.
- Reply mentions effect duration.
- Reply is short.
- No emoji.

Say:

> Price and treatment facts come from the business knowledge base. If the business has no approved price for a service, the AI should not make one up.

## Live Demo Scene 2: FAQ

Type:

```text
你哋地址喺邊？可以點付款？
```

Expected:
- Reply answers address/payment from KB.
- No long explanation.

Say:

> This removes repetitive staff replies. The business can update these answers in the KB.

## Live Demo Scene 3: Recommendation

Type:

```text
我面有啲鬆，想提升輪廓，有咩推介？
```

Expected:
- Reply recommends a relevant service such as HIFU / lifting / facial.
- Does not invent a new treatment.

Say:

> The AI can sell naturally, but it stays grounded to the services the business actually offers.

## Live Demo Scene 4: Unknown Service Guardrail

Type:

```text
你哋有冇牙齒美白？幾錢？
```

Expected:
- Reply does not quote an invented price.
- Reply says info is not available / staff can help check.

Say:

> This is important. We do not want the AI inventing prices or services. It should only quote approved business facts.

## Live Demo Scene 5: Create Booking

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
- It does not create booking yet.

Then type:

```text
確認
```

Expected:
- Booking is created.
- Dashboard booking appears.

Say:

> The important part is confirmation. The AI collects details first, then only creates the booking after the customer clearly confirms.

## Live Demo Scene 6: Modify Booking

Type:

```text
我想改去5月18號下晝3點
```

Expected:
- AI confirms the new date/time.
- It does not modify yet.

Then type:

```text
確認
```

Expected:
- Booking time changes in DB/dashboard.

Say:

> Customers often change time. The AI can handle rescheduling without staff going back and forth.

## Live Demo Scene 7: Cancel Booking

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
- Booking status changes to cancelled.

Say:

> Again, the AI asks before making a change. This avoids accidental cancellation.

## Live Demo Scene 8: Multi-Industry Proof

Switch to Cleaning.

Type:

```text
全屋深層清潔幾錢？包唔包清潔用品？
```

Expected:
- Reply quotes cleaning price.
- Reply answers FAQ.

Switch to Yoga.

Type:

```text
私人瑜珈課幾錢？我係初學者適唔適合？
```

Expected:
- Reply quotes yoga price.
- Reply answers suitability.

Say:

> Same engine, different service list and FAQ. That is why this works for appointment-based service businesses, not only beauty salons.

## Closing Talk Track

Say:

> For pilot customers, we do not ask you to build the system yourself. You send us your services, prices, FAQs, opening hours, and booking rules. We set it up, test it, and give you a working AI receptionist for your business.

Then ask:

> If this can answer your repeated WhatsApp questions and collect bookings after hours, would it be useful for your team?

## Common Objections

### "會唔會亂答價錢？"

Answer:

> The AI is instructed to quote only approved prices from your KB. If the service or price is missing, it should say staff can help check instead of inventing.

### "如果客人想改期或者取消點算？"

Answer:

> The AI can handle reschedule and cancellation, but it confirms before changing the booking.

### "我唔想完全交俾 AI。"

Answer:

> That is fine. The first version is designed as AI receptionist + human handoff. Staff can still intervene when needed.

### "Setup 會唔會好麻煩？"

Answer:

> We use assisted setup. You give us your service list, prices, FAQs, opening hours, and booking rules. We import and test it for you.

### "Dashboard 有咩用？"

Answer:

> For MVP, dashboard mainly lets you see bookings, customer information, conversations, and KB. The core value is AI helping you reply and collect bookings.

## Pricing Recommendation

Your direction is good: charge setup fee, keep the monthly price accessible, and sell assisted pilots first.

Recommended wording:

### Starter

For businesses that want to try AI booking without monthly commitment.

```text
HK$998 setup
HK$0 / month
150 AI replies / month
1 WhatsApp account
Limited dashboard: bookings + customer info
Assisted setup included
```

Notes:
- Do not call it simply "Free Tier" in sales copy. Say "Starter: $0 monthly after setup".
- Make it clear that HK$998 setup is still required.
- Define the limit as "AI replies" or "AI messages", not vague "sentences".
- If average booking uses 5 AI replies, 150 replies is around 30 booking conversations.

### Pro Pilot

Main offer.

```text
Regular price: HK$1,498 / month
Launch ramp:
- Month 1: HK$1,496 total = HK$998 setup + HK$498 platform fee
- Month 2: HK$500 platform fee
- Month 3 onward: HK$1,498 / month
1,500 AI replies / month
Up to 3 WhatsApp accounts
Full MVP dashboard
Assisted setup included
Best for active salons / service businesses
```

Notes:
- Make the regular price clear first: HK$1,498/month.
- Frame the first two months as a launch ramp, not the real monthly price.
- Month 1 includes setup fee + discounted platform fee.
- Keep this as the main plan you want customers to choose.

### Max Pilot

Next-phase / high-touch offer.

```text
Regular price: HK$2,498 / month
Launch ramp:
- Month 1: HK$1,996 total = HK$998 setup + HK$998 platform fee
- Month 2: HK$1,500 platform fee
- Month 3 onward: HK$2,498 / month
Fair-use high-volume AI replies
Up to 10 WhatsApp accounts
Custom chatbot tuning
Business insights and recommendations
Human-in-the-loop booking intervention flow
Priority support
```

Notes:
- Avoid saying "unlimited conversations" without a fair-use policy.
- Use "fair-use high-volume" first, then define a limit later.
- Keep Max as next-phase target or invite-only until the ops flow is stable.

## Founder Offer

Your "first 100 customers free upgrade to Max" idea is strong for urgency, but too generous if it is unlimited.

Recommended version:

```text
Founder Offer:
First 30 pilot customers get Max features at Pro price for the first 3 months.
After 3 months, they can stay on Pro or upgrade to Max.
```

Alternative:

```text
First 100 customers lock founder pricing for 12 months.
```

Avoid:

```text
First 100 customers get free Max forever.
```

Reason:
- It trains customers to undervalue Max.
- It can create support load before Max is operationally mature.
- It makes future pricing harder to explain.

## Recommended Public Pricing Table

Use this simpler version when selling:

| Plan | First Month | Monthly After | Usage | Best For |
| --- | ---: | ---: | --- | --- |
| Starter | HK$998 | HK$0 | 150 AI replies, 1 WhatsApp | Trial / low-volume shop |
| Pro Pilot | HK$1,496 | Month 2: HK$500; Month 3+: HK$1,498 | 1,500 AI replies, up to 3 WhatsApp | Main pilot customers |
| Max Pilot | HK$1,996 | Month 2: HK$1,500; Month 3+: HK$2,498 | Fair-use high volume, up to 10 WhatsApp | High-touch / multi-branch |

## Pricing Rules

Use these rules in sales:
- Setup fee is not optional because KB quality decides AI quality.
- Extra WhatsApp/Meta template charges, if any, are pass-through or billed separately.
- Usage limit counts AI replies, not customer messages.
- If customer exceeds usage, upgrade plan instead of surprise overage for MVP.
- Custom integration, calendar sync, payment, and advanced dashboard are separate add-ons.

## My Recommendation

Use Pro Pilot as the hero offer.

Say:

> Most customers start with Pro Pilot: regular price HK$1,498/month, with a launch ramp of HK$1,496 in month 1 including setup, HK$500 in month 2, then HK$1,498/month from month 3. We set up your services, prices, FAQs, and booking flow, then you can test it with real customers.

Keep Starter as a low-friction entry point, but do not lead with it unless the customer is very price sensitive.

Keep Max as an invite-only upgrade until the human-in-the-loop and analytics features are truly ready.
