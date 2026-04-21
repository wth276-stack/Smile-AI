import type { BookingDraft, KnowledgeChunk } from '../types';
import { bookingDraftHasAllRequiredSlots } from '../booking-state';
import { buildServiceCatalog, matchService } from '../service-matcher';
import { isBookingConfirmationRejectionMessage } from './booking-confirmation-rejection';
import { getHKTToday } from './date-utils';

/** Issue string when SUBMIT_BOOKING is coerced to REPLY_ONLY (duplicate affirm / no confirmation pending). */
export const DUPLICATE_AFFIRM_GUARD_ISSUE =
  'SUBMIT_BOOKING without confirmationPending — not finalizing (duplicate-affirm guard)';

/**
 * True if the service string matches KB via catalog matcher or title/aliases fallback.
 * exact/close/ambiguous all count as recognized (ambiguous is not treated as not-found).
 */
export function isServiceRecognizedInKnowledge(
  candidate: string,
  knowledgeChunks: KnowledgeChunk[],
): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return true;

  const catalog = buildServiceCatalog(knowledgeChunks);
  const m = matchService(trimmed, catalog);
  if (m.type === 'exact' || m.type === 'close' || m.type === 'ambiguous') {
    return true;
  }

  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const b = normalise(trimmed);

  const chunkTitleAliasHit = knowledgeChunks.some((c) => {
    const titles = [c.title, ...(c.aliases ?? [])].filter(Boolean) as string[];
    return titles.some((title) => {
      const a = normalise(title);
      return a.includes(b) || b.includes(a);
    });
  });
  if (chunkTitleAliasHit) return true;

  return catalog.some((s) => {
    const pool = [s.displayName, ...s.aliases];
    return pool.some((p) => {
      const a = normalise(p);
      return a.includes(b) || b.includes(a);
    });
  });
}

/** Normalize empty / whitespace LLM output so ?? fallback keeps prior slots (json_object often sends ""). */
function orNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function hasModifyBookingId(d: BookingDraft | undefined | null): boolean {
  return d?.mode === 'modify' && !!String(d?.bookingId ?? '').trim();
}

export function mergeBookingDraft(
  existing: BookingDraft | undefined | null,
  llmDraft: Partial<BookingDraft> | undefined | null,
): BookingDraft {
  function orMode(v: unknown): BookingDraft['mode'] {
    if (v === 'modify' || v === 'cancel' || v === 'new') return v;
    return null;
  }

  return {
    bookingId: orNull(llmDraft?.bookingId) ?? orNull(existing?.bookingId) ?? null,
    mode: orMode(llmDraft?.mode) ?? orMode(existing?.mode) ?? null,
    serviceName: orNull(llmDraft?.serviceName) ?? orNull(existing?.serviceName) ?? null,
    serviceDisplayName:
      orNull(llmDraft?.serviceDisplayName) ?? orNull(existing?.serviceDisplayName) ?? null,
    date: orNull(llmDraft?.date) ?? orNull(existing?.date) ?? null,
    time: orNull(llmDraft?.time) ?? orNull(existing?.time) ?? null,
    customerName: orNull(llmDraft?.customerName) ?? orNull(existing?.customerName) ?? null,
    phone: orNull(llmDraft?.phone) ?? orNull(existing?.phone) ?? null,
  };
}

interface ValidateContext {
  currentDraft?: BookingDraft;
  knowledgeChunks: KnowledgeChunk[];
  conversationHistory?: Array<{ role: 'customer' | 'assistant'; content: string }>;
  currentMessage?: string;
  /** Set to true when the previous turn's action was CONFIRM_BOOKING. */
  confirmationPending?: boolean;
}

interface LlmRawOutput {
  replyText?: string;
  intents?: string[];
  newSlots?: Partial<BookingDraft>;
  action?: string;
  bookingDraft?: Partial<BookingDraft>;
}

/**
 * Check if an assistant reply looks like a booking confirmation summary.
 * Catches explicit confirmation phrases, or when the reply lists multiple booking
 * fields (service, date, time, name, phone) — indicators of a summary presented
 * for the customer to confirm. Price alone is NOT a booking summary marker.
 */
function replyHasConfirmationSummary(reply: string): boolean {
  if (!reply) return false;
  const r = reply.toLowerCase();

  // Explicit confirmation request phrases
  if (/請確認|是否正確|確認.*預約|預約.*確認|幫你確認|幫您確認|以上資料|預約詳情|預約資料|預約如下|確認以上|please confirm/i.test(r)) {
    return true;
  }

  // Booking-specific field markers (NOT price)
  const hasService = /hifu|療程|facial|套餐|服務[:：]/i.test(r);
  const hasDate = /\d{4}-\d{2}-\d{2}|\d{1,2}月\d{1,2}日|星期[一二三四五六日]/i.test(r);
  const hasTime = /\d{1,2}:\d{2}|\d{1,2}點/i.test(r);
  const hasName = /客戶姓名|姓名[:：]/i.test(r);
  const hasPhone = /電話[:：]|\b\d{8}\b/i.test(r);

  const fieldCount = [hasService, hasDate, hasTime, hasName, hasPhone].filter(Boolean).length;
  return fieldCount >= 3;
}

/**
 * Check if the user's message is a confirmation / affirmation.
 * Handles Cantonese, Mandarin, and English variations.
 */
export function isConfirmationMessage(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

  // Cancel flow: explicit consent (contains 取消 but affirms cancellation — must run before negative 取消)
  if (/確認取消|確定取消|確認要取消|確定要取消|confirm\s*cancel/i.test(t)) return true;

  // Negative signals override any affirmation
  if (/但|不過|唔係|不是|改|取消|等等|唔好|算|唔要|等一等|慢|唔啱/.test(t)) return false;

  const exactAffirm = [
    '確認', '好', 'ok', 'yes', '係', '冇問題', '可以', '同意', 'y',
    '得', '啱', '好嘅', '好呀', '好啊', '無問題', '就咁', '搞掂',
    'sure', 'confirm', 'yeah', 'yep', 'yup', '確定', '冇錯',
    '對', '啱嘅', '正確', '係呀', '好的', '是', '是的',
    'ok!', 'ok！', '👍', '👌',
  ];
  if (exactAffirm.some((a) => t === a)) return true;

  // Short messages (≤ 10 chars) with affirmation keyword
  if (t.length <= 10) {
    const partialAffirm = [
      '確認', '好', '可以', '冇問題', '同意', '得', '搞掂', '確定',
      '無問題', 'ok', 'yes', '啱',
    ];
    if (partialAffirm.some((a) => t.includes(a))) return true;
  }

  return false;
}

export { isBookingConfirmationRejectionMessage } from './booking-confirmation-rejection';

/**
 * Fallback: check if the last assistant turn looks like a booking confirmation summary.
 * Used when confirmationPending flag is not available (older conversations).
 */
function lastAssistantLooksLikeBookingConfirmation(ctx: ValidateContext): boolean {
  const hist = ctx.conversationHistory;
  if (!hist?.length) return false;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].role !== 'assistant') continue;
    const raw = hist[i].content?.trim() ?? '';
    if (!raw.startsWith('{')) return false;
    try {
      const parsed = JSON.parse(raw) as { action?: string; reply?: string; replyText?: string };
      if (parsed.action === 'CONFIRM_BOOKING') return true;
      const reply = parsed.reply ?? parsed.replyText ?? '';
      if (
        reply &&
        /(請確認|確認.*預約|以下係|預約詳情|預約資料|是否.*確認|預約.*如下|麻煩.*確認|幫你確認|幫您確認|核對|幫你整理|以上.*確認|啱唔啱)/.test(
          reply,
        )
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Detect and auto-correct date/time swap.
 *
 * When user says "X號Y點", LLM sometimes outputs date with day=Y and time=X:00.
 * This function detects the pattern and corrects the swap.
 */
function detectAndCorrectDateTimeSwap(
  userMessage: string,
  newSlots: Partial<BookingDraft>,
  issues: string[],
): Partial<BookingDraft> {
  if (!newSlots.date || !newSlots.time) return newSlots;

  // Match "X號Y點" or "X号Y点" pattern
  const pattern = /(\d{1,2})[號号]\s*(\d{1,2})[點点]/;
  const match = userMessage.match(pattern);
  if (!match) return newSlots;

  const expectedDay = parseInt(match[1], 10);
  const expectedHour = parseInt(match[2], 10);
  if (expectedDay === expectedHour) return newSlots; // same number, can't be swapped

  const dateParts = newSlots.date.split('-');
  if (dateParts.length !== 3) return newSlots;
  const slotDay = parseInt(dateParts[2], 10);
  const slotHour = parseInt(newSlots.time.split(':')[0], 10);

  // Full swap: day and hour both swapped
  if (slotDay === expectedHour && slotHour === expectedDay) {
    const correctedDate = `${dateParts[0]}-${dateParts[1]}-${String(expectedDay).padStart(2, '0')}`;
    const correctedTime = `${String(expectedHour).padStart(2, '0')}:00`;
    console.warn(
      `[v2/validator] Date/time swap corrected: "${match[0]}" → date=${correctedDate} time=${correctedTime} (was date=${newSlots.date} time=${newSlots.time})`,
    );
    issues.push(`Date/time swap auto-corrected from ${newSlots.date}/${newSlots.time}`);
    return { ...newSlots, date: correctedDate, time: correctedTime };
  }

  // Partial: only day is wrong (LLM put hour number as day)
  if (slotDay !== expectedDay && slotDay === expectedHour) {
    const correctedDate = `${dateParts[0]}-${dateParts[1]}-${String(expectedDay).padStart(2, '0')}`;
    console.warn(
      `[v2/validator] Date swap corrected: "${match[0]}" → date=${correctedDate} (was ${newSlots.date})`,
    );
    issues.push(`Date swap auto-corrected from ${newSlots.date}`);
    return { ...newSlots, date: correctedDate };
  }

  return newSlots;
}

export function validateOutput(
  raw: LlmRawOutput,
  ctx: ValidateContext,
) {
  const issues: string[] = [];
  let reply = raw.replyText ?? '抱歉，我唔太明白你嘅意思，可以再講多少少嗎？';
  const intent = raw.intents?.[0] ?? 'OTHER';
  let newSlots = raw.newSlots ?? raw.bookingDraft ?? {};
  const earlyMerged = mergeBookingDraft(ctx.currentDraft, newSlots);

  // After CONFIRM_BOOKING, 好/確認 → SUBMIT (new booking) — modify/cancel flows must become MODIFY/CANCEL_BOOKING.
  if (
    ctx.confirmationPending &&
    ctx.currentMessage &&
    isConfirmationMessage(ctx.currentMessage) &&
    ctx.currentDraft
  ) {
    if (hasModifyBookingId(ctx.currentDraft) || hasModifyBookingId(earlyMerged)) {
      newSlots = {};
      raw.action = 'MODIFY_BOOKING';
      issues.push(
        'Affirmation after modify confirmation summary: forced MODIFY_BOOKING (cleared LLM slot noise)',
      );
      console.warn(
        '[v2/validator] Forced MODIFY_BOOKING: confirmationPending + modify mode + bookingId + affirmation',
      );
    } else if (ctx.currentDraft.mode === 'cancel' && ctx.currentDraft.bookingId) {
      newSlots = {};
      raw.action = 'CANCEL_BOOKING';
      issues.push('Affirmation after cancel confirmation: forced CANCEL_BOOKING');
      console.warn(
        '[v2/validator] Forced CANCEL_BOOKING: confirmationPending + cancel mode + bookingId + affirmation',
      );
    } else if (
      bookingDraftHasAllRequiredSlots(ctx.currentDraft) &&
      !hasModifyBookingId(ctx.currentDraft) &&
      !hasModifyBookingId(earlyMerged)
    ) {
      newSlots = {};
      raw.action = 'SUBMIT_BOOKING';
      issues.push('Affirmation after confirmation summary: cleared LLM slot merges (SUBMIT_BOOKING)');
      console.warn(
        '[v2/validator] Forced SUBMIT_BOOKING: confirmationPending + full draft + affirmation — ignoring slot rewrites',
      );
    }
  }

  let action = raw.action ?? 'REPLY_ONLY';

  if (
    ctx.confirmationPending &&
    ctx.currentMessage &&
    isBookingConfirmationRejectionMessage(ctx.currentMessage) &&
    (action === 'CONFIRM_BOOKING' ||
      action === 'REPLY' ||
      action === 'REPLY_ONLY' ||
      action === 'CANCEL_BOOKING')
  ) {
    action = 'COLLECT_BOOKING';
    issues.push(
      'User rejected or wants to modify booking confirmation — COLLECT_BOOKING (not CONFIRM_BOOKING)',
    );
  }

  // ── Date/time swap detection (Bug 1 fix) ──
  if (ctx.currentMessage) {
    newSlots = detectAndCorrectDateTimeSwap(ctx.currentMessage, newSlots, issues);
  }

  const mergedDraft = mergeBookingDraft(ctx.currentDraft, newSlots);

  if (newSlots.serviceDisplayName) {
    if (!isServiceRecognizedInKnowledge(newSlots.serviceDisplayName, ctx.knowledgeChunks)) {
      issues.push(`Service "${newSlots.serviceDisplayName}" not found in KB`);
    }
  }

  if (newSlots.serviceName) {
    if (!isServiceRecognizedInKnowledge(newSlots.serviceName, ctx.knowledgeChunks)) {
      issues.push(`Service "${newSlots.serviceName}" not found in KB`);
    }
  }

  if (newSlots.date) {
    const parsed = new Date(newSlots.date + 'T00:00:00');
    const today = getHKTToday();
    today.setHours(0, 0, 0, 0);
    if (isNaN(parsed.getTime()) || parsed < today) {
      issues.push('Invalid or past date');
      reply += '\n請提供今日或之後嘅日期 🙏';
    }
  }

  // Validate modify/cancel actions have a bookingId
  if ((action === 'MODIFY_BOOKING' || action === 'CANCEL_BOOKING') && !mergedDraft.bookingId) {
    issues.push(`${action} requires a bookingId`);
    action = 'REPLY_ONLY';
  }

  // ── Deterministic coercion: REPLY with full draft + confirmation summary → CONFIRM_BOOKING ──
  // LLM sometimes returns action=REPLY even when the reply is clearly a booking confirmation summary.
  // Without this, confirmationPending never gets set, and the next user affirmation hits duplicate-affirm guard.
  if (
    (action === 'REPLY' || action === 'REPLY_ONLY') &&
    mergedDraft.mode !== 'modify' &&
    mergedDraft.mode !== 'cancel' &&
    bookingDraftHasAllRequiredSlots(mergedDraft) &&
    replyHasConfirmationSummary(reply)
  ) {
    action = 'CONFIRM_BOOKING';
    issues.push('Override: REPLY → CONFIRM_BOOKING (full draft + reply is confirmation summary)');
    console.warn('[v2/validator] Override: REPLY → CONFIRM_BOOKING (deterministic: full draft + summary)');
  }

  // Simple fallback: confirmation text + full draft already on currentDraft, but LLM said REPLY
  const currentMessage = ctx.currentMessage ?? '';
  const cd = ctx.currentDraft;
  if (
    action === 'REPLY' &&
    cd &&
    cd.mode !== 'modify' &&
    cd.mode !== 'cancel' &&
    bookingDraftHasAllRequiredSlots(cd) &&
    /好|ok|確認|confirm|係呀|係啊|係嘅|冇問題|無問題|submit|啱|正確|得|可以|搞掂/i.test(currentMessage)
  ) {
    action = 'SUBMIT_BOOKING';
    issues.push('Override: REPLY → SUBMIT_BOOKING (all slots filled + user confirmed)');
    console.warn('[v2/validator] Override: REPLY → SUBMIT_BOOKING (simple guard: currentDraft + confirmation text)');
  }

  // ── SUBMIT_BOOKING override (Bug 2 fix) ──
  // Use only confirmationPending from the server; regex fallback on history caused duplicate
  // CREATE_BOOKING after a successful create when the same assistant reply still "looks like" confirmation.
  // Include COLLECT_BOOKING / CONFIRM_BOOKING: model may re-confirm or re-collect instead of submit
  // after 好 (e.g. multi-booking stress); REPLY-only override would miss that.
  if (
    action !== 'SUBMIT_BOOKING' &&
    mergedDraft.mode !== 'modify' &&
    mergedDraft.mode !== 'cancel' &&
    bookingDraftHasAllRequiredSlots(mergedDraft) &&
    !!ctx.confirmationPending &&
    ctx.currentMessage &&
    isConfirmationMessage(ctx.currentMessage) &&
    (raw.action === 'REPLY' ||
      raw.action === 'REPLY_ONLY' ||
      raw.action === 'COLLECT_BOOKING' ||
      raw.action === 'CONFIRM_BOOKING')
  ) {
    console.warn(
      '[v2/validator] Overriding action to SUBMIT_BOOKING: draft complete + confirmationPending' +
        ` (flag=${!!ctx.confirmationPending}, regex=${lastAssistantLooksLikeBookingConfirmation(ctx)})` +
        ` LLM returned action=${raw.action}`,
    );
    action = 'SUBMIT_BOOKING';
  }

  // Modify flow: model/prompt may output SUBMIT_BOOKING after a modify summary — must persist as MODIFY_BOOKING.
  if (
    ctx.currentMessage &&
    isConfirmationMessage(ctx.currentMessage) &&
    hasModifyBookingId(mergedDraft) &&
    (ctx.confirmationPending || lastAssistantLooksLikeBookingConfirmation(ctx)) &&
    action === 'SUBMIT_BOOKING'
  ) {
    action = 'MODIFY_BOOKING';
    raw.action = 'MODIFY_BOOKING';
    newSlots = {};
    issues.push('Modify context: SUBMIT_BOOKING coerced to MODIFY_BOOKING');
    console.warn(
      '[v2/validator] SUBMIT_BOOKING → MODIFY_BOOKING (modify + bookingId + affirmation + confirmation context)',
    );
  }

  // Duplicate affirm / stray SUBMIT: model may emit SUBMIT_BOOKING + full newSlots when confirmationPending
  // is already false (e.g. after successful CREATE). Do not emit a second CREATE without a new CONFIRM turn.
  if (
    action === 'SUBMIT_BOOKING' &&
    !ctx.confirmationPending &&
    mergedDraft.mode !== 'modify' &&
    mergedDraft.mode !== 'cancel'
  ) {
    action = 'REPLY_ONLY';
    issues.push(DUPLICATE_AFFIRM_GUARD_ISSUE);
  }

  return {
    action,
    intent,
    newSlots,
    validatedReply: reply,
    mergedDraft,
    validationIssues: issues,
  };
}