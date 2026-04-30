# Assisted Onboarding Checklist

## Goal

Set up a customer's AI receptionist safely and quickly without building full self-serve onboarding yet.

Target onboarding time:

```text
1-3 working days for a simple pilot
```

## Customer Must Provide

### Business Basics

- Business name.
- Industry.
- Main WhatsApp number.
- Website / Instagram / Facebook if available.
- Address.
- Opening hours.
- Public holiday rules if any.
- Handoff contact person.
- Handoff phone/email/WhatsApp.

### Services

For each service:
- Service name.
- Category.
- Price.
- Discount / promotion if any.
- Duration.
- What is included.
- Suitable for who.
- Not suitable for who.
- Important precautions.
- Common aliases customers may use.

Example:

```text
Service: HIFU 緊緻療程
Price: HK$3,680
Promo: HK$2,680
Duration: 60 minutes
Suitable: face lifting / contour improvement
Precaution: pregnant customers should ask staff first
Aliases: HIFU, lifting, 緊緻, 提升輪廓
```

### FAQs

Collect at least 8-12 FAQs if available:
- Address.
- Opening hours.
- Payment methods.
- Booking policy.
- Cancellation policy.
- Reschedule policy.
- Late arrival policy.
- First-time customer questions.
- Service preparation.
- Aftercare.

### Booking Rules

- Required booking fields.
- Earliest booking lead time.
- Same-day booking rules.
- Available days/times.
- Services that need manual confirmation.
- Services that cannot be booked online.
- Cancellation deadline.
- Reschedule deadline.

MVP required fields:

```text
service
date
time
customerName
phone
```

### Tone

Ask:
- Should the AI sound friendly, premium, professional, playful, or direct?
- Cantonese only, English only, or mixed?
- Any words to avoid?
- Any phrases the business commonly uses?

## Internal Setup Steps

1. Create or confirm tenant.
2. Import services into KB.
3. Import FAQs into KB.
4. Configure business facts and opening hours.
5. Configure handoff instruction.
6. Run price/FAQ/recommendation test.
7. Run booking create test.
8. Run reschedule test.
9. Run cancel test.
10. Review dashboard booking visibility.

## Quality Check

Before handover, test:

- Price question answers exact KB price.
- Unknown service does not invent price.
- FAQ answer is correct.
- Booking asks for missing slots.
- Booking confirms before create.
- Modify confirms before change.
- Cancel confirms before cancellation.
- Reply is short and no emoji.

## Customer UAT Script

Ask the customer to test:

```text
1. Ask one price question.
2. Ask one FAQ.
3. Ask for a recommendation.
4. Try booking a service.
5. Confirm the booking.
6. Try changing the time.
7. Try cancelling.
8. Ask about a service they do not provide.
```

## Go-Live Checklist

Before go-live:

- Customer approves service list.
- Customer approves prices.
- Customer approves FAQs.
- Customer approves tone.
- Customer confirms handoff process.
- Customer confirms booking flow.
- Smoke test passes.
- Backup created.

## Data Protection Notes

Do not ask customer to send:
- Credit card numbers.
- HKID/passport numbers.
- Medical records.
- Sensitive legal/financial documents.

For MVP, collect only normal booking information:
- Name.
- Phone.
- Service.
- Date.
- Time.
- Basic notes if needed.
