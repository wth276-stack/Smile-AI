/**
 * conversation-mode.ts
 *
 * Defines ConversationMode enum, transition rules, and reset conditions.
 * This is the single source of truth for mode logic — rules must NOT leak
 * back into orchestrator.ts or llm-pipeline.ts as ad-hoc if-else chains.
 *
 * Patch v1.1 — merge-safety fixes:
 *   - Blocker 2: narrow BOOKING_CONFIRM_PATTERN (removed 確認/好的/submit/confirm alone)
 *   - Blocker 3: removed bare 唔係 from INQUIRY_OVERRIDE_PATTERN
 */

import type { BookingDraft } from './types';
import type { MessageIntent } from './intent-classifier';

// ── Mode definitions ─────────────────────────────────────────────────────────

export type ConversationMode =
  | 'GREETING'              // First contact or pure greeting
  | 'INQUIRY'               // Asking about services, price, effects, suitability
  | 'RECOMMENDATION'        // Undecided — needs help narrowing down
  | 'BOOKING_DRAFT'         // Expressed booking intent, collecting slots
  | 'CONFIRMATION_PENDING'  // All slots filled, awaiting explicit user confirm
  | 'POST_BOOKING'          // Booking submitted successfully
  | 'HANDOFF';              // Needs human agent

// ── Signals used in transition decisions ────────────────────────────────────

export interface ModeTransitionInput {
  currentMode: ConversationMode;
  intent: MessageIntent;
  message: string;
  bookingDraft: BookingDraft | null | undefined;
  allSlotsPresent: boolean;
}

// ── Explicit booking confirmation phrases ────────────────────────────────────
//
// BLOCKER 2 FIX: Only full explicit submit phrases trigger booking.
// Removed: 確認, 好的, 好, submit, confirm (too vague, cause false positives)
// Kept: only phrases where user clearly means "submit this booking"

const BOOKING_CONFIRM_PATTERN =
  /確認預約|幫我提交預約|可以，幫我預約|係，幫我預約|幫我約落去|confirm booking|submit booking|冇問題，幫我約|ok，幫我預約/i;

// ── Explicit inquiry / exit booking path phrases ─────────────────────────────
//
// BLOCKER 3 FIX: Removed bare 唔係 — too broad, causes false overrides.
// e.g. "唔係暗瘡，係敏感" should NOT exit booking mode.
// Only full explicit "I don't want to book" phrases are kept.

const INQUIRY_OVERRIDE_PATTERN =
  /我只係想了解|先了解下|唔係想預約|只想問下|想了解詳情先|唔預約|只係想問|不是想預約|唔係要預約|我係想問/i;

// ── Explicit handoff triggers ────────────────────────────────────────────────

const HANDOFF_PATTERN =
  /真人|人工|客服|manager|投訴|complaint|唔滿意|有問題想問真人/i;

// ── Booking intent phrases ───────────────────────────────────────────────────

const BOOKING_START_PATTERN =
  /預約|book|訂位|想約|幫我約|可唔可以約|約一個|約下/i;

// ── Core transition function ─────────────────────────────────────────────────

/**
 * Determines the next ConversationMode based on current state and new message.
 * All mode transition logic lives here — not in orchestrator, not in pipeline.
 */
export function resolveNextMode(input: ModeTransitionInput): ConversationMode {
  const { currentMode, intent, message, bookingDraft, allSlotsPresent } = input;

  // ── Handoff always wins ──────────────────────────────────────────────────
  if (HANDOFF_PATTERN.test(message)) return 'HANDOFF';

  // ── Explicit inquiry override: exit booking path ─────────────────────────
  if (INQUIRY_OVERRIDE_PATTERN.test(message)) return 'INQUIRY';

  // ── CONFIRMATION_PENDING: only explicit confirm advances ─────────────────
  if (currentMode === 'CONFIRMATION_PENDING') {
    if (BOOKING_CONFIRM_PATTERN.test(message)) return 'POST_BOOKING';
    // If user adds/changes a slot and slots are still incomplete, drop back to draft.
    // But if all slots are present (user is correcting existing data), stay in
    // CONFIRMATION_PENDING to ask for re-confirmation.
    if ((intent === 'BOOKING' || intent === 'CONTACT_INFO') && !allSlotsPresent) {
      return 'BOOKING_DRAFT';
    }
    // Ambiguous replies (好的, 確認, OK alone) → stay pending, re-show summary
    return 'CONFIRMATION_PENDING';
  }

  // ── POST_BOOKING: stay unless new booking starts ─────────────────────────
  if (currentMode === 'POST_BOOKING') {
    if (BOOKING_START_PATTERN.test(message)) return 'BOOKING_DRAFT';
    if (intent === 'INQUIRY' || intent === 'DETAIL_QUESTION' || intent === 'PRICE') return 'INQUIRY';
    return 'POST_BOOKING';
  }

  // ── BOOKING_DRAFT: advance to confirmation if slots complete ─────────────
  if (currentMode === 'BOOKING_DRAFT') {
    if (allSlotsPresent) return 'CONFIRMATION_PENDING';
    return 'BOOKING_DRAFT';
  }

  // ── Fresh transitions (GREETING / INQUIRY / RECOMMENDATION) ─────────────

  // Explicit booking intent → start draft
  if (BOOKING_START_PATTERN.test(message) || intent === 'BOOKING') {
    return 'BOOKING_DRAFT';
  }

  // Service name only (without booking intent) → inquiry, not booking
  if (intent === 'INQUIRY' || intent === 'DETAIL_QUESTION' || intent === 'PRICE') {
    return 'INQUIRY';
  }

  if (intent === 'GREETING') return 'GREETING';

  // Default: stay in current mode or fall to INQUIRY
  if (currentMode === 'GREETING') return 'GREETING';
  return currentMode === 'RECOMMENDATION' ? 'RECOMMENDATION' : 'INQUIRY';
}

// ── Draft reset rules ────────────────────────────────────────────────────────

/**
 * Returns true when the booking draft should be fully reset.
 * Called AFTER submittedDraft snapshot is taken and booking is prepared.
 */
export function shouldResetDraft(
  prevMode: ConversationMode,
  nextMode: ConversationMode,
): boolean {
  return prevMode === 'CONFIRMATION_PENDING' && nextMode === 'POST_BOOKING';
}

/**
 * Returns true when confirmationPending flag should be cleared.
 */
export function shouldClearConfirmationPending(
  currentMode: ConversationMode,
  nextMode: ConversationMode,
  message: string,
): boolean {
  if (INQUIRY_OVERRIDE_PATTERN.test(message)) return true;
  if (currentMode === 'CONFIRMATION_PENDING' && nextMode === 'POST_BOOKING') return true;
  if (currentMode === 'CONFIRMATION_PENDING' && nextMode === 'INQUIRY') return true;
  return false;
}

// ── Mode persistence helpers ─────────────────────────────────────────────────

export function serializeMode(mode: ConversationMode): string {
  return mode;
}

export function deserializeMode(raw: unknown): ConversationMode {
  const valid: ConversationMode[] = [
    'GREETING', 'INQUIRY', 'RECOMMENDATION',
    'BOOKING_DRAFT', 'CONFIRMATION_PENDING', 'POST_BOOKING', 'HANDOFF',
  ];
  if (typeof raw === 'string' && valid.includes(raw as ConversationMode)) {
    return raw as ConversationMode;
  }
  return 'INQUIRY';
}

// ── Debug log helper ─────────────────────────────────────────────────────────

export function logModeTransition(
  prev: ConversationMode,
  next: ConversationMode,
  intent: string,
  draft: BookingDraft | null | undefined,
  allSlotsPresent: boolean,
  confirmationPending: boolean,
  createBookingTriggered: boolean,
): void {
  const CONV_LOG = '[CONV-MODE]';
  console.log(
    `${CONV_LOG} mode=${prev}->${next} intent=${intent} ` +
    `service=${draft?.serviceDisplayName ?? 'null'} ` +
    `date=${draft?.date ?? 'null'} time=${draft?.time ?? 'null'} ` +
    `name=${draft?.customerName ?? 'null'} phone=${draft?.phone ?? 'null'} ` +
    `allSlots=${allSlotsPresent} confirmPending=${confirmationPending} ` +
    `createBooking=${createBookingTriggered}`,
  );
}

// ── Targeted regression tests (Blocker 2 + 3) ───────────────────────────────

export function verifyConversationModeRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const baseDraft: BookingDraft = {
    serviceName: 'whitening',
    serviceDisplayName: '美白嫩膚Facial',
    date: '2026-04-01',
    time: '15:00',
    customerName: '陳大文',
    phone: '91234567',
  };

  function check(label: string, result: ConversationMode, expected: ConversationMode) {
    if (result !== expected)
      failures.push(`${label}: got ${result}, want ${expected}`);
  }

  // Test 1: explicit confirm → POST_BOOKING
  check(
    'T1 確認預約 → POST_BOOKING',
    resolveNextMode({
      currentMode: 'CONFIRMATION_PENDING',
      intent: 'OTHER',
      message: '確認預約',
      bookingDraft: baseDraft,
      allSlotsPresent: true,
    }),
    'POST_BOOKING',
  );

  // Test 2: ambiguous "好的" alone → stay CONFIRMATION_PENDING
  check(
    'T2 好的 alone → CONFIRMATION_PENDING',
    resolveNextMode({
      currentMode: 'CONFIRMATION_PENDING',
      intent: 'OTHER',
      message: '好的',
      bookingDraft: baseDraft,
      allSlotsPresent: true,
    }),
    'CONFIRMATION_PENDING',
  );

  // Test 3: ambiguous "確認" alone → stay CONFIRMATION_PENDING
  check(
    'T3 確認 alone → CONFIRMATION_PENDING',
    resolveNextMode({
      currentMode: 'CONFIRMATION_PENDING',
      intent: 'OTHER',
      message: '確認',
      bookingDraft: baseDraft,
      allSlotsPresent: true,
    }),
    'CONFIRMATION_PENDING',
  );

  // Test 4: "唔係暗瘡，係敏感" should NOT override to INQUIRY
  check(
    'T4 唔係暗瘡，係敏感 → stays BOOKING_DRAFT',
    resolveNextMode({
      currentMode: 'BOOKING_DRAFT',
      intent: 'OTHER',
      message: '唔係暗瘡，係敏感',
      bookingDraft: baseDraft,
      allSlotsPresent: false,
    }),
    'BOOKING_DRAFT',
  );

  // Test 5: "唔係好清楚有咩分別" should NOT override to INQUIRY from BOOKING_DRAFT
  check(
    'T5 唔係好清楚有咩分別 → stays BOOKING_DRAFT',
    resolveNextMode({
      currentMode: 'BOOKING_DRAFT',
      intent: 'OTHER',
      message: '唔係好清楚有咩分別',
      bookingDraft: baseDraft,
      allSlotsPresent: false,
    }),
    'BOOKING_DRAFT',
  );

  // Test 6: explicit inquiry override → INQUIRY
  check(
    'T6 我只係想了解 → INQUIRY',
    resolveNextMode({
      currentMode: 'BOOKING_DRAFT',
      intent: 'OTHER',
      message: '我只係想了解',
      bookingDraft: baseDraft,
      allSlotsPresent: false,
    }),
    'INQUIRY',
  );

  // Test 7: "可以，幫我預約" → POST_BOOKING
  check(
    'T7 可以，幫我預約 → POST_BOOKING',
    resolveNextMode({
      currentMode: 'CONFIRMATION_PENDING',
      intent: 'OTHER',
      message: '可以，幫我預約',
      bookingDraft: baseDraft,
      allSlotsPresent: true,
    }),
    'POST_BOOKING',
  );

  // Test 8: correction in CONFIRMATION_PENDING with all slots present → stay CONFIRMATION_PENDING
  // User says "改為今晚7點" to correct time, all slots are filled, should re-confirm not submit
  check(
    'T8 改為今晚7點 (allSlots=true) → CONFIRMATION_PENDING',
    resolveNextMode({
      currentMode: 'CONFIRMATION_PENDING',
      intent: 'BOOKING', // isBookingSlotFollowUp returns true because date/time extracted
      message: '改為今晚7點',
      bookingDraft: baseDraft,
      allSlotsPresent: true,
    }),
    'CONFIRMATION_PENDING',
  );

  // Test 9: correction in CONFIRMATION_PENDING with missing slots → drop to BOOKING_DRAFT
  // User says "改為今晚7點" but name/phone missing, need to re-collect
  const incompleteDraft: BookingDraft = {
    serviceName: 'whitening',
    serviceDisplayName: '美白嫩膚Facial',
    date: '2026-04-01',
    time: '15:00',
    customerName: null,
    phone: null,
  };
  check(
    'T9 改為今晚7點 (allSlots=false) → BOOKING_DRAFT',
    resolveNextMode({
      currentMode: 'CONFIRMATION_PENDING',
      intent: 'BOOKING',
      message: '改為今晚7點',
      bookingDraft: incompleteDraft,
      allSlotsPresent: false,
    }),
    'BOOKING_DRAFT',
  );

  return { ok: failures.length === 0, failures };
}
