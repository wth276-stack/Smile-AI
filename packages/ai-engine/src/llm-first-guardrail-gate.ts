import type { BookingDraft, KBFactBundle, LLMBrainOutput, UserPhase } from './types';
import { extractSlots, isValidHkPhone } from './booking-state';
import { checkHandoffTrigger } from './handoff-trigger';
import { foldIntentMessage } from './intent-classifier';

function extractFirstPrice(reply: string): string | null {
  const m = reply.match(/(?:HKD|\$)\s*\d+/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : null;
}

function patchPrice(reply: string, exactPrice: string): string {
  if (/(?:HKD|\$)\s*\d+/i.test(reply)) {
    return reply.replace(/(?:HKD|\$)\s*\d+/gi, exactPrice);
  }
  return `${reply}\n（參考價：${exactPrice}）`;
}

const SERVICE_PLACEHOLDERS = new Set(['', 'null', 'undefined', 'unknown', 'n/a', 'none']);
const GENERIC_SERVICE_WORDS = new Set([
  'hi',
  'hello',
  'hey',
  'facial',
  'treatment',
  'service',
  '療程',
  '服務',
  '祛斑',
  '袪斑',
  '祛斑服務',
  '袪斑服務',
]);

function normalizeServiceCandidate(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (!t) return null;
  if (SERVICE_PLACEHOLDERS.has(t.toLowerCase())) return null;
  if (GENERIC_SERVICE_WORDS.has(t.toLowerCase())) return null;
  return t;
}

function normalizeGenericServicePhrase(v: string): string {
  return v.replace(/服務|療程/g, '').trim();
}

export function applyGuardrailGate(input: {
  userMessage: string;
  kbFacts: KBFactBundle;
  draft: BookingDraft;
  brain: LLMBrainOutput;
}): {
  reply: string;
  issues: string[];
  phaseAfter: UserPhase;
  slots: Partial<BookingDraft>;
  shouldHandoff: boolean;
  hardBlock?: { reason: string };
} {
  const issues: string[] = [];
  let reply = input.brain.reply;
  let phaseAfter: UserPhase = input.brain.decisions.phaseTransition ?? 'exploring';
  let shouldHandoff = false;
  let hardBlock: { reason: string } | undefined;

  const folded = foldIntentMessage(input.userMessage);
  const extracted = extractSlots(folded);
  const slots: Partial<BookingDraft> = {
    serviceName: input.brain.decisions.detectedSlots.serviceName ?? input.draft.serviceName ?? null,
    date: input.brain.decisions.detectedSlots.date ?? extracted.date ?? null,
    time: input.brain.decisions.detectedSlots.time ?? extracted.time ?? null,
    customerName: input.brain.decisions.detectedSlots.customerName ?? extracted.customerName ?? null,
    phone: input.brain.decisions.detectedSlots.phone ?? extracted.phone ?? null,
    serviceDisplayName: input.draft.serviceDisplayName ?? null,
  };

  // Price safety: patch to exact KB price when mismatch.
  if (input.kbFacts.exactPrice) {
    const spoken = extractFirstPrice(reply);
    if (spoken && spoken.toLowerCase() !== input.kbFacts.exactPrice.toLowerCase()) {
      issues.push(`price_patched:${spoken}->${input.kbFacts.exactPrice}`);
      reply = patchPrice(reply, input.kbFacts.exactPrice);
    }
  }

  // Handoff enforcement.
  const handoff = checkHandoffTrigger({
    message: folded,
    draft: {
      ...input.draft,
      date: slots.date ?? input.draft.date,
      time: slots.time ?? input.draft.time,
      customerName: slots.customerName ?? input.draft.customerName,
      phone: slots.phone ?? input.draft.phone,
    },
    serviceMatch: { type: 'none', matches: [] },
    correctionCount: 0,
    conversationMode: 'BOOKING_DRAFT',
  });
  if (handoff.shouldHandoff || input.brain.decisions.nextMove === 'handoff') {
    issues.push('handoff_forced');
    shouldHandoff = true;
    phaseAfter = 'handoff';
    reply = handoff.reply ?? '明白，我幫你轉交同事跟進。請稍等，同事會盡快聯絡你 🙏';
  }

  // Service hallucination detection against whitelist.
  const resolvedServiceRaw = normalizeServiceCandidate(input.brain.decisions.resolvedService);
  const resolvedService = resolvedServiceRaw ? normalizeGenericServicePhrase(resolvedServiceRaw) : null;
  const aliasMappedService = resolvedService
    ? input.kbFacts.serviceAliasLookup[resolvedService.toLowerCase()] ?? null
    : null;
  const candidateForCheck = aliasMappedService ?? resolvedService;
  if (
    candidateForCheck &&
    reply.toLowerCase().includes(candidateForCheck.toLowerCase()) &&
    !input.kbFacts.serviceWhitelist.some((s) => s.toLowerCase() === candidateForCheck.toLowerCase())
  ) {
    issues.push(`service_hallucination:${candidateForCheck}`);
    hardBlock = { reason: `service_hallucination:${candidateForCheck}` };
  }

  // Slot validation
  if (slots.phone && !isValidHkPhone(slots.phone)) {
    issues.push('invalid_phone_slot');
    slots.phone = null;
  }
  if ((slots.date && !slots.time) || (!slots.date && slots.time)) {
    issues.push('slot_conflict_date_time_incomplete');
  }

  return { reply, issues, phaseAfter, slots, shouldHandoff, hardBlock };
}

