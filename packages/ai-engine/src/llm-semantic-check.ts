import type { LlmPlannerOutput, LlmPlannerIntent } from './llm-contract';
import type { BookingDraft, ServiceEntry, ServiceMatchResult } from './types';
import { extractSlots } from './booking-state';
import { foldIntentMessage, isBookingSlotFollowUp, resolveRepairedRuleIntent, type MessageIntent } from './intent-classifier';

function emptyDraftShape(): BookingDraft {
  return {
    serviceName: null,
    serviceDisplayName: null,
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };
}

function bookingDraftHasProgress(d: BookingDraft | null | undefined): boolean {
  return !!(d && (d.serviceName || d.date || d.time || d.customerName || d.phone));
}

function stripForOverlap(s: string): string {
  return foldIntentMessage(s)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]/g, '');
}

/**
 * Planner named a service string that should align with the resolved catalog entry.
 */
function mentionAlignsWithService(mention: string, service: ServiceEntry): boolean {
  const m = stripForOverlap(mention);
  if (m.length < 2) return true;
  const display = stripForOverlap(service.displayName);
  if (display.includes(m) || m.includes(display)) return true;
  for (const a of service.aliases) {
    const an = stripForOverlap(a);
    if (an.length >= 2 && (an.includes(m) || m.includes(an))) return true;
  }
  return false;
}

function isNonBookingPlanner(intent: LlmPlannerIntent): boolean {
  return (
    intent === 'PRICE' ||
    intent === 'DETAIL' ||
    intent === 'INQUIRY' ||
    intent === 'GREETING' ||
    intent === 'OTHER' ||
    intent === 'CONTACT_INFO'
  );
}

/**
 * v1 semantic gates after JSON schema validation. Failure → full rule fallback.
 */
export function runLlmSemanticChecks(args: {
  foldedMsg: string;
  priorDraft: BookingDraft | undefined;
  planner: LlmPlannerOutput;
  mergedDraft: BookingDraft;
  serviceMatch: ServiceMatchResult;
}): { ok: true } | { ok: false; reason: string } {
  const { foldedMsg, priorDraft, planner, mergedDraft, serviceMatch } = args;
  const ruleIntent = resolveRepairedRuleIntent(foldedMsg, priorDraft);

  if (!isPlannerIntentCompatibleWithRule(planner.intent, ruleIntent, foldedMsg, priorDraft)) {
    return { ok: false, reason: 'intent_rule_mismatch' };
  }

  const mention = planner.serviceMention?.trim() ?? '';
  if (mention.length >= 2) {
    if (serviceMatch.type === 'none' && needsServiceResolution(planner.intent)) {
      return { ok: false, reason: 'mention_unresolved' };
    }
    if (serviceMatch.type === 'exact' || serviceMatch.type === 'close') {
      const top = serviceMatch.matches[0].service;
      if (!mentionAlignsWithService(mention, top)) {
        return { ok: false, reason: 'mention_service_mismatch' };
      }
    }
  }

  if (planner.intent === 'BOOKING_SLOT_FILL' && !bookingDraftHasProgress(priorDraft)) {
    return { ok: false, reason: 'slot_fill_without_draft' };
  }

  const detSlots = extractSlots(foldedMsg);
  if (isNonBookingPlanner(planner.intent)) {
    if (mergedDraft.date && !detSlots.date && !priorDraft?.date) {
      return { ok: false, reason: 'non_booking_date_leak' };
    }
    if (mergedDraft.time && !detSlots.time && !priorDraft?.time) {
      return { ok: false, reason: 'non_booking_time_leak' };
    }
  }

  /** Planner JSON must not carry full date+time extraction on non-booking intents (booking leakage). */
  if (isNonBookingPlanner(planner.intent) && planner.intent !== 'CONTACT_INFO') {
    if (planner.extracted.date && planner.extracted.time) {
      return { ok: false, reason: 'booking_datetime_in_non_booking_planner' };
    }
  }

  return { ok: true };
}

function needsServiceResolution(intent: LlmPlannerIntent): boolean {
  return intent === 'PRICE' || intent === 'DETAIL' || intent === 'BOOKING';
}

function isPlannerIntentCompatibleWithRule(
  planner: LlmPlannerIntent,
  rule: MessageIntent,
  foldedMsg: string,
  priorDraft: BookingDraft | undefined,
): boolean {
  const draftProg = bookingDraftHasProgress(priorDraft);
  const slotFollow = draftProg && isBookingSlotFollowUp(foldedMsg, priorDraft);

  if (planner === 'BOOKING' || planner === 'BOOKING_SLOT_FILL') {
    // Always trust LLM BOOKING intent when rule agrees
    if (rule === 'BOOKING') return true;
    // Phone number provided during active booking
    if (rule === 'CONTACT_INFO' && draftProg && /\d{8,11}/.test(foldedMsg)) return true;
    // Rule engine says OTHER/CONTACT_INFO but there's an active draft —
    // trust LLM BOOKING_SLOT_FILL: rule engine can't parse natural date/time
    // expressions like 聽晚7點, 後日下午, 聽日早上 etc.
    if (planner === 'BOOKING_SLOT_FILL' && draftProg) return true;
    // Rule sees slot follow-up
    if (rule === 'OTHER' && slotFollow) return true;
    return false;
  }

  if (planner === 'PRICE') return rule === 'PRICE';
  if (planner === 'DETAIL') return rule === 'DETAIL_QUESTION';
  if (planner === 'INQUIRY') return rule === 'INQUIRY';
  if (planner === 'GREETING') return rule === 'GREETING';

  if (planner === 'CONTACT_INFO') {
    if (rule === 'CONTACT_INFO') return true;
    if (rule === 'BOOKING' && draftProg) return true;
    // Name-only message during active booking draft — LLM correctly tags CONTACT_INFO
    if (draftProg && rule === 'OTHER') return true;
    return false;
  }

  if (planner === 'OTHER') {
    if (rule === 'BOOKING') return !!slotFollow;
    return true;
  }

  return false;
}

/** node -e "const s=require('./dist/llm-semantic-check.js'); const r=s.verifyLlmSemanticRegression(); console.log(r); process.exit(r.ok?0:1);" */
export function verifyLlmSemanticRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const prior: BookingDraft = {
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };

  const mockMatch = (type: ServiceMatchResult['type']): ServiceMatchResult =>
    type === 'exact'
      ? {
          type: 'exact',
          matches: [
            {
              service: {
                code: 'hifu',
                displayName: 'HIFU 緊緻',
                aliases: ['hifu'],
                priceInfo: null,
                fullInfo: '',
              },
              confidence: 1,
            },
          ],
        }
      : { type: 'none', matches: [] };

  const basePlanner = (partial: Partial<LlmPlannerOutput> & Pick<LlmPlannerOutput, 'intent'>): LlmPlannerOutput => ({
    schemaVersion: 1,
    replyText: '',
    serviceMention: null,
    extracted: { date: null, time: null, customerName: null, phone: null },
    usesDraftContext: true,
    switchedAwayFromDraftService: false,
    needsClarification: false,
    clarificationReason: null,
    nextExpectedSlot: null,
    ...partial,
  });

  // Mismatch: rule says PRICE, planner says BOOKING (no draft) — should still fail
  const bad = runLlmSemanticChecks({
    foldedMsg: foldIntentMessage('HIFU 幾錢？'),
    priorDraft: undefined,
    planner: basePlanner({ intent: 'BOOKING' }),
    mergedDraft: emptyDraftShape(),
    serviceMatch: mockMatch('none'),
  });
  if (bad.ok) failures.push('expected PRICE vs BOOKING mismatch (no draft)');

  // PRICE intent should pass when rule agrees
  const good = runLlmSemanticChecks({
    foldedMsg: foldIntentMessage('HIFU 幾錢？'),
    priorDraft: prior,
    planner: basePlanner({ intent: 'PRICE', serviceMention: 'HIFU' }),
    mergedDraft: { ...prior, serviceName: 'hifu', serviceDisplayName: 'HIFU 緊緻' },
    serviceMatch: mockMatch('exact'),
  });
  if (!good.ok) failures.push(`expected PRICE pass got ${JSON.stringify(good)}`);

  // BOOKING_SLOT_FILL without any prior draft should still fail
  const slotNoPrior = runLlmSemanticChecks({
    foldedMsg: foldIntentMessage('晚上7點'),
    priorDraft: undefined,
    planner: basePlanner({ intent: 'BOOKING_SLOT_FILL' }),
    mergedDraft: emptyDraftShape(),
    serviceMatch: mockMatch('none'),
  });
  if (slotNoPrior.ok) failures.push('slot fill without draft should fail');

  // BOOKING_SLOT_FILL WITH prior draft should now pass (key fix)
  const slotWithPrior = runLlmSemanticChecks({
    foldedMsg: foldIntentMessage('聽晚7點'),
    priorDraft: prior,
    planner: basePlanner({
      intent: 'BOOKING_SLOT_FILL',
      extracted: { date: null, time: '19:00', customerName: null, phone: null },
    }),
    mergedDraft: { ...prior, time: '19:00' },
    serviceMatch: mockMatch('none'),
  });
  if (!slotWithPrior.ok) failures.push(`slot fill with draft should pass, got: ${JSON.stringify(slotWithPrior)}`);

  // Name-only message during active booking should pass as CONTACT_INFO
  const nameOnly = runLlmSemanticChecks({
    foldedMsg: foldIntentMessage('阿明'),
    priorDraft: prior,
    planner: basePlanner({ intent: 'CONTACT_INFO', extracted: { date: null, time: null, customerName: '阿明', phone: null } }),
    mergedDraft: { ...prior, customerName: '阿明' },
    serviceMatch: mockMatch('none'),
  });
  if (!nameOnly.ok) failures.push(`name-only with draft should pass as CONTACT_INFO, got: ${JSON.stringify(nameOnly)}`);

  return { ok: failures.length === 0, failures };
}