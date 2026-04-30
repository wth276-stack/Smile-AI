# Production Sell-Ready Snapshot - 2026-04-30

## Status

Status: **Production MVP core smoke passed**.

This snapshot records the first production-level sell-ready checkpoint for the Service Booking AI MVP.

Product positioning:

> Appointment AI for service businesses.
> A 24/7 WhatsApp / webchat assistant that answers service questions, quotes prices from KB, collects booking details, confirms bookings, handles reschedule/cancel, and hands off to staff.

Primary demo verticals:
- Beauty / salon.
- Cleaning / home service.
- Yoga / fitness / wellness.

Do not expand the product scope before sales outreach.

## Git Checkpoint

Branch:

```text
codex/mvp-sell-ready-core
```

Commit:

```text
2fa53b8 Stabilize sell-ready MVP demos and KB protection
```

Pull request:

```text
#2 Stabilize sell-ready MVP demos and KB protection
```

PR content was checked to exclude unfinished onboarding/schema work.

## Production API

Production API tested:

```text
https://atsapi-production-ad45.up.railway.app
```

Smoke command used:

```powershell
$env:API_BASE="https://atsapi-production-ad45.up.railway.app"
pnpm run smoke:industries
```

The command was run twice against the production API and passed both times.

## Production Smoke Result

Result:

```text
Multi-industry smoke passed (beauty, cleaning, yoga).
```

Booking window used by smoke:

```text
create: 2026-05-16 11:00 HK
modify: 2026-05-18 15:00 HK
```

Tenant KB audit:

```text
beauty   demo-tenant           SERVICE=25 FAQ=11
cleaning demo-tenant-cleaning  SERVICE=4  FAQ=4
yoga     demo-tenant-yoga      SERVICE=4  FAQ=4
```

## Smoke Coverage

Beauty:
- Price question passed with currency + amount grounding.
- Effect duration answer passed.
- FAQ answer passed.
- Service recommendation passed.
- Unknown service did not invent price.
- Booking create side effect fired.
- Booking modify side effect fired.
- Booking row changed to `2026-05-18 15:00`.
- Booking cancel side effect fired.

Cleaning:
- Price question passed with currency + amount grounding.
- FAQ answer passed.
- Service detail/recommendation passed.
- Unknown service did not invent price.
- Booking create/modify/cancel lifecycle passed.
- Booking row changed to `2026-05-18 15:00`.

Yoga:
- Price question passed with currency + amount grounding.
- FAQ answer passed.
- Service detail/recommendation passed.
- Unknown service did not invent price.
- Booking create/modify/cancel lifecycle passed.
- Booking row changed to `2026-05-18 15:00`.

## Sell-Ready Boundary

This is sell-ready for guided pilots, not full self-serve SaaS.

Safe to sell:
- Assisted setup for appointment-based service businesses.
- AI answers services, prices, FAQs, and booking questions from KB.
- Booking flow collects service/date/time/name/phone.
- Booking confirmation is required before create/modify/cancel.
- KB is protected from routine demo reset.
- Beauty, cleaning, and yoga demos can be used as proof of generic engine.

Do not promise yet:
- Fully self-serve onboarding.
- PWA install flow.
- Push notifications.
- Advanced analytics.
- Multi-role permission.
- External calendar sync.
- Payment integration.
- Medical/legal/financial advice handling.
- Complex renovation-style quoting.

## Sales Positioning

Short pitch:

> We help appointment-based service businesses turn WhatsApp into a 24/7 AI receptionist. It answers customer questions, quotes prices from your service list, collects booking details, confirms bookings, and hands off to staff when needed.

Best first customers:
- Beauty salons.
- Spas / massage.
- Yoga / Pilates / personal trainers.
- Cleaning / home service businesses.

First sales target:

```text
Contact 10 businesses.
Book 3-5 demos.
Close 1-3 guided pilots.
```

## Demo Order

Primary demo:
1. Beauty price/effect question.
2. Beauty FAQ.
3. Beauty recommendation.
4. Beauty booking create.
5. Beauty booking modify.
6. Beauty booking cancel.

Proof of generic engine:
7. Cleaning price + FAQ.
8. Yoga private class price + booking.

Keep the live demo short. The product value is immediate reply + booking capture, not dashboard polish.

## Next Work

Immediate next phase: **Sales Kit**, not new product features.

Create:
- 1-page offer.
- Demo script.
- Pricing sheet.
- Assisted onboarding checklist.
- Objection handling sheet.

Then start outreach.

## Notes

The local worktree still contains separate unfinished onboarding/schema work. Keep it out of this sell-ready checkpoint unless it is reviewed and intentionally scoped into a later PR.
