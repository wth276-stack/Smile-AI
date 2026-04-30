# Multi-Industry MVP Snapshot - 2026-04-29

## Product Decision

The next phase is **MVP Sell-Ready Phase**, not more product expansion.

Positioning:

> Appointment AI for service businesses.
> A 24/7 WhatsApp / webchat assistant that answers service questions, quotes prices from KB, collects booking details, confirms bookings, handles reschedule/cancel, and hands off to staff.

Do not position the product as:
- A fully self-serve SaaS platform.
- An all-industry AI agent.
- A complete CRM/dashboard replacement.
- A medical/legal/financial decision assistant.

The sellable boundary is:

> High-frequency WhatsApp enquiries + booking workflows for appointment-based service businesses.

## Current Technical Reality

Core engine:
- V2 AI engine is active by default.
- Core booking flow works for service/date/time/name/phone.
- Create / modify / cancel booking side effects pass MVP smoke.
- Booking confirmation is required before booking mutation.
- Duplicate booking confirmation is guarded.
- KB top-k retrieval exists.
- Current booking service is pinned in KB retrieval.
- Prompt v3 compact is in place.
- Booking replies are deterministically compacted.
- Emoji is stripped from engine replies.

KB protection:
- Beauty KB restored to 36 active docs: 25 SERVICE, 11 FAQ.
- KB backup / restore scripts exist.
- `/api/demo/reset` preserves KB by default.

Smoke:
- `pnpm run smoke:mvp` exists.
- Latest verified fresh API smoke passed against `API_BASE=http://localhost:3002`.
- Smoke checks price/FAQ/recommendation/unknown service/create/modify/cancel/KB reset.
- Modify smoke verifies DB row changed to `2026-05-11 15:00`.

Frontend:
- Web local app loads at `http://localhost:3000` and redirects to `/login`.
- `apps/web/.env.local` points to `NEXT_PUBLIC_API_URL=http://localhost:3002`.
- A `401 /api/auth/me` on `/login` is normal when not logged in.

## Existing Industry Seeds

Existing mapping:
- `beauty` -> `demo-tenant`
- `cleaning` -> `demo-tenant-cleaning`
- `yoga` -> `demo-tenant-yoga`
- `consulting` -> `demo-tenant-consulting`
- `renovation` -> `demo-tenant-renovation`

Existing seed file:

```text
packages/database/src/industry-seeds.ts
```

Existing seed applier:

```text
packages/database/src/apply-industry-seed.ts
```

Sell-ready decision:
- Keep Beauty as the primary demo.
- Add Cleaning and Yoga/Fitness as controlled demo verticals.
- Do not sell Consulting / Renovation in this MVP phase.
- Consulting includes legal/financial/psychological style risk.
- Renovation has complex quote logic and longer sales cycle.

## Phase 1: Freeze MVP Core

Goal:

Beauty demo must remain 100% demonstrable.

Acceptance:
- WhatsApp / Webchat answers price, FAQ, and service questions.
- "我想預約 HIFU / Botox / 深層清潔 Facial" enters booking flow.
- System collects service/date/time/name/phone.
- System confirms before creating booking.
- Confirmation creates one booking only.
- Modify/cancel changes the real DB row.
- KB cannot be accidentally reset.
- KB backup/restore exists and is documented.

Do not add:
- PWA.
- Self-serve onboarding.
- Push notification.
- Advanced analytics.
- Multi-role RBAC.
- Large dashboard redesign.

## Phase 2A: Multi-Industry Demo Pack

Goal:

Three demo industries can be shown reliably:
- Beauty / Salon.
- Cleaning / home service.
- Yoga / Fitness / Wellness.

Scope:
- Keep one generic engine.
- Do not fork prompt per industry.
- Keep industry behavior data-driven through tenant settings + KB.
- Keep each demo small and clean.

Recommended demo KB size:
- Beauty: can remain full because it is primary.
- Cleaning: 8-12 services max, 8 FAQ max.
- Yoga/Fitness: 8-12 services max, 8 FAQ max.

For MVP, smaller but reliable beats large and brittle.

## Generic Appointment Engine Boundary

Core required slots:
- service.
- date.
- time.
- customerName.
- phone.

Core engine must continue to own:
- booking flow.
- collect slots.
- confirmation.
- submit booking.
- modify booking.
- cancel booking.
- handoff.
- KB retrieval.
- tenant isolation.
- reply grounding.

Industry pack may define:
- service categories.
- service examples.
- common FAQ.
- booking rules.
- tone.
- risky claims / forbidden claims.
- optional extra slots for future phases.

Industry extra slots are **not** required for Phase 2A unless already supported safely.

Examples for later:
- Cleaning: address, home size, number of rooms.
- Yoga/Fitness: goal, experience level.
- Massage/Spa: duration, preferred therapist gender.

Do not implement full dynamic extra-slot architecture until the three demo industries pass smoke.

## Phase 2A Acceptance Criteria

For each of Beauty, Cleaning, Yoga:
- Public chat can use `industryId`.
- Tenant is isolated.
- KB retrieval returns relevant service/FAQ.
- User can ask price.
- User can ask service detail.
- User can ask one FAQ.
- Unknown service does not invent price.
- Booking request enters booking flow.
- Booking create works after confirmation.
- Modify works and DB row changes.
- Cancel works and DB row changes.
- Reply stays compact and no emoji.

Required smoke scripts:
- Keep `smoke:mvp` for Beauty.
- Add one smoke script or parameterized smoke runner for multi-industry.
- Suggested command:

```text
API_BASE=http://localhost:3002 pnpm run smoke:industries
```

## Dashboard Boundary

MVP dashboard should only prove that customers can operate the system:
- Conversations: see what customers asked.
- Bookings: see bookings, status, time.
- KB: view/edit services, prices, FAQ.
- Basic mobile responsive.
- Login and tenant isolation do not break.

Do not build yet:
- PWA install.
- Push notification.
- Advanced reports.
- Multi-role permissions.
- Fancy redesign.

## Assisted Onboarding Boundary

Use assisted onboarding first.

Customer provides:
- Company name.
- Industry.
- WhatsApp number.
- Business hours.
- Address.
- Services.
- Prices.
- FAQ.
- Booking rules.
- Tone requirements.
- Handoff contact.

We setup:
- Tenant.
- KB.
- Business hours.
- Booking rules.
- Demo smoke.
- Handoff process.

Self-serve onboarding is later.

## Landing Boundary

Landing page should only collect leads.

Hero:

```text
24/7 AI WhatsApp sales assistant for service businesses
```

Beauty-specific variation:

```text
24/7 AI WhatsApp sales assistant for beauty salons
```

Primary CTA:
- Book a 15-min demo.
- WhatsApp us.

Do not overbuild landing page before outreach.

## Sales Kit Required

Minimum sales kit:
- 1-page PDF.
- Demo script with 8 conversation scenes.
- Pricing sheet.
- Assisted onboarding checklist.
- Objection handling sheet.

No 20-page deck yet.

## 7-Day Metric

The next useful business metric is not feature count.

Target:
- Contact 10 service businesses.
- Book 3-5 demos.
- Close 1-3 paid/discounted pilots.

Suggested first verticals:
- Beauty salon.
- Spa / massage.
- Yoga / Pilates / personal training.
- Cleaning / home service.

Avoid first:
- Medical clinic.
- Lawyers.
- Insurance.
- Financial advisors.
- Complex renovation quotations.

## Next Work Order

1. Freeze Beauty MVP.
2. Build multi-industry smoke for Beauty/Cleaning/Yoga.
3. Verify existing cleaning/yoga seed quality.
4. Hide or deprioritize consulting/renovation in public demo selection.
5. Create sales kit.
6. Do outreach.
