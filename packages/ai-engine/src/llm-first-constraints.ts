import type { BookingDraft, KBFactBundle } from './types';
import { extractSlots, getMissingSlots } from './booking-state';

function hasExplicitBookingIntent(msg: string): boolean {
  if (/想預約|想book|幫我約|我想約時間|預約|book/i.test(msg)) return true;
  const slots = extractSlots(msg);
  return !!(slots.date || slots.time);
}

export function buildConstraints(
  userMessage: string,
  facts: KBFactBundle,
  draft: BookingDraft,
): string {
  const lines: string[] = [];

  if (facts.exactPrice) {
    lines.push(`PRICE_CONSTRAINT: only use exact price "${facts.exactPrice}" for focused service.`);
  }

  if (/真人|人工|客服|同事|manager/i.test(userMessage)) {
    lines.push('HANDOFF_CONSTRAINT: user requested human; must offer transfer now.');
  }

  const missing = getMissingSlots(draft);
  if (missing.length > 0 && (hasExplicitBookingIntent(userMessage) || !!draft.serviceName || !!draft.date || !!draft.time)) {
    lines.push(`BOOKING_MISSING_SLOT: ${missing.join(',')}`);
  }

  if (facts.noData) {
    lines.push('HONESTY_CONSTRAINT: do not fabricate details; ask clarify or offer handoff.');
  }

  return lines.join('\n');
}

