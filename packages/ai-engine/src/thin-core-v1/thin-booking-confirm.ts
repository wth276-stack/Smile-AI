/**
 * Explicit booking confirmation detection (deterministic). No NLU — pattern only.
 */

import type { ThinLlmOutput } from './thin-types';
import type { BookingDraft } from '../types';
import { isBookingComplete, isValidHkPhone } from '../booking-state';

const EXPLICIT_CONFIRM = new RegExp(
  [
    '^\\s*',
    '(?:',
    '確認預約',
    '|OK確認',
    '|ok[,，]?\\s*確認',
    '|冇問題[,，]?\\s*確認',
    '|yes\\s*confirm',
    '|confirm\\s*booking',
    '|confirm\\s*預約',
    '|確認',
    ')',
    '\\s*[!.！。]?\\s*$',
  ].join(''),
  'i',
);

export function isExplicitBookingConfirmation(message: string): boolean {
  const t = message.trim();
  if (t.length === 0) return false;
  if (t.length > 80) return false;
  return EXPLICIT_CONFIRM.test(t);
}

function draftReadyForSubmit(draft: BookingDraft): boolean {
  return isBookingComplete(draft) && isValidHkPhone(draft.phone);
}

/**
 * Enforces: full slots alone → booking_confirm; submit only on explicit confirmation
 * (or same message containing confirmation patterns).
 */
export function applyThinBookingGate(params: {
  thin: ThinLlmOutput;
  mergedDraft: BookingDraft;
  priorConfirmationPending: boolean;
  explicitConfirm: boolean;
}): ThinLlmOutput {
  const { mergedDraft, priorConfirmationPending, explicitConfirm } = params;
  let out = { ...params.thin };

  if (explicitConfirm && !draftReadyForSubmit(mergedDraft)) {
    if (out.nextAction === 'booking_submit' || out.nextAction === 'booking_confirm') {
      out = { ...out, nextAction: 'booking_collect' };
    }
    return out;
  }

  const complete = draftReadyForSubmit(mergedDraft);
  if (!complete) {
    if (out.nextAction === 'booking_submit' || out.nextAction === 'booking_confirm') {
      out = { ...out, nextAction: 'booking_collect' };
    }
    return out;
  }

  if (explicitConfirm) {
    return { ...out, nextAction: 'booking_submit' };
  }

  if (priorConfirmationPending) {
    if (out.nextAction === 'booking_submit') {
      out = { ...out, nextAction: 'booking_confirm' };
    }
    return out;
  }

  return { ...out, nextAction: 'booking_confirm' };
}
