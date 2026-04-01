import type { KnowledgeChunk } from '../types';
import type { ThinLlmOutput, ThinNextAction } from './thin-types';
import { emptyThinBookingSlots } from './thin-types';
import type { ThinRetrievalResult } from './thin-retriever';

const NEXT_ACTIONS: ThinNextAction[] = [
  'reply',
  'booking_collect',
  'booking_confirm',
  'booking_submit',
  'handoff',
];

function normalizeDigits(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * If reply cites a concrete HKD-like amount not present in KB price strings, flag for soft repair (prefix disclaimer).
 */
export function detectSuspiciousPriceFigures(reply: string, kbPriceBlob: string): boolean {
  const kbNorm = normalizeDigits(kbPriceBlob);
  const amounts = reply.match(/\$?\s*[\d,]+(?:\.\d+)?/g) ?? [];
  for (const a of amounts) {
    const d = normalizeDigits(a);
    if (d.length < 3) continue;
    if (!kbNorm.includes(d)) return true;
  }
  return false;
}

export function parseThinLlmJson(raw: string): { ok: true; value: ThinLlmOutput } | { ok: false; error: string } {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'json_parse' };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'not_object' };

  const o = obj as Record<string, unknown>;
  const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
  if (!reply) return { ok: false, error: 'missing_reply' };

  const intent = typeof o.intent === 'string' ? o.intent : 'other';
  const matchedEntityId =
    o.matchedEntityId === null || o.matchedEntityId === undefined
      ? null
      : typeof o.matchedEntityId === 'string'
        ? o.matchedEntityId
        : null;
  const confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0;

  const na = o.nextAction;
  const nextAction = typeof na === 'string' && NEXT_ACTIONS.includes(na as ThinNextAction) ? (na as ThinNextAction) : 'reply';

  const bs = o.bookingSlots;
  const slots = emptyThinBookingSlots();
  if (bs && typeof bs === 'object') {
    const b = bs as Record<string, unknown>;
    slots.serviceName = typeof b.serviceName === 'string' ? b.serviceName : null;
    slots.serviceDisplayName = typeof b.serviceDisplayName === 'string' ? b.serviceDisplayName : null;
    slots.date = typeof b.date === 'string' ? b.date : null;
    slots.time = typeof b.time === 'string' ? b.time : null;
    slots.customerName = typeof b.customerName === 'string' ? b.customerName : null;
    slots.phone = typeof b.phone === 'string' ? b.phone.replace(/\s/g, '') : null;
  }

  const handoffRequired = o.handoffRequired === true;

  return {
    ok: true,
    value: {
      intent,
      matchedEntityId,
      confidence,
      nextAction: handoffRequired ? 'handoff' : nextAction,
      bookingSlots: slots,
      handoffRequired,
      reply,
    },
  };
}

export interface ThinValidationContext {
  retrieval: ThinRetrievalResult;
  /** Merged draft after code fills slots — used for booking_submit gate */
  bookingComplete: boolean;
}

/**
 * Thin validation only: entity id exists, handoff preserved, booking_submit gated by completeness.
 * Does not interpret natural language.
 */
export function applyThinValidators(
  parsed: ThinLlmOutput,
  ctx: ThinValidationContext,
): ThinLlmOutput {
  let out = { ...parsed };

  const validIds = new Set(ctx.retrieval.entities.map((e) => e.documentId));
  if (out.matchedEntityId && !validIds.has(out.matchedEntityId)) {
    out = { ...out, matchedEntityId: null };
  }

  if (out.handoffRequired) {
    out = { ...out, nextAction: 'handoff' };
  }

  if ((out.nextAction === 'booking_submit' || out.nextAction === 'booking_confirm') && !ctx.bookingComplete) {
    out = { ...out, nextAction: 'booking_collect' };
  }

  let chunk: KnowledgeChunk | undefined;
  if (out.matchedEntityId) {
    chunk = ctx.retrieval.entityById.get(out.matchedEntityId);
  }
  const priceBlob = [chunk?.price, chunk?.discountPrice, chunk?.content?.slice(0, 500)]
    .filter(Boolean)
    .join(' ');

  if (priceBlob && detectSuspiciousPriceFigures(out.reply, priceBlob)) {
    out = {
      ...out,
      reply: `（以上價錢請以店內最新資料為準。）\n${out.reply}`,
    };
  }

  return out;
}
