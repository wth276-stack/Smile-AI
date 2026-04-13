import type { BookingDraft, KnowledgeChunk } from '../types';

/** Normalize empty / whitespace LLM output so ?? fallback keeps prior slots (json_object often sends ""). */
function orNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

function mergeDraft(
  existing: BookingDraft | undefined | null,
  llmDraft: Partial<BookingDraft> | undefined | null,
): BookingDraft {
  return {
    bookingId: orNull(llmDraft?.bookingId) ?? orNull(existing?.bookingId) ?? null,
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

function isDraftComplete(draft: BookingDraft): boolean {
  return (
    !!draft.serviceName &&
    !!draft.date &&
    !!draft.time &&
    !!draft.customerName &&
    !!draft.phone
  );
}

/**
 * Check if the user's message is a confirmation / affirmation.
 * Handles Cantonese, Mandarin, and English variations.
 */
function isConfirmationMessage(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;

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
        /(請確認|確認.*預約|以下係|預約詳情|預約資料|是否.*確認|預約.*如下|麻煩.*確認|幫你確認|核對|幫你整理|以上.*確認|啱唔啱)/.test(
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
  let action = raw.action ?? 'REPLY_ONLY';
  const intent = raw.intents?.[0] ?? 'OTHER';
  let newSlots = raw.newSlots ?? raw.bookingDraft ?? {};

  // ── Date/time swap detection (Bug 1 fix) ──
  if (ctx.currentMessage) {
    newSlots = detectAndCorrectDateTimeSwap(ctx.currentMessage, newSlots, issues);
  }

  const mergedDraft = mergeDraft(ctx.currentDraft, newSlots);
  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const kbTitles = ctx.knowledgeChunks.map((c) => c.title);
  const isFuzzyServiceMatch = (candidate: string) => {
    const b = normalise(candidate);
    return kbTitles.some((title) => {
      const a = normalise(title);
      return a.includes(b) || b.includes(a);
    });
  };

  if (newSlots.serviceDisplayName) {
    if (!isFuzzyServiceMatch(newSlots.serviceDisplayName)) {
      issues.push(`Service "${newSlots.serviceDisplayName}" not found in KB`);
    }
  }

  if (newSlots.serviceName) {
    if (!isFuzzyServiceMatch(newSlots.serviceName)) {
      issues.push(`Service "${newSlots.serviceName}" not found in KB`);
    }
  }

  if (newSlots.date) {
    const parsed = new Date(newSlots.date + 'T00:00:00');
    const today = new Date();
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

  // Simple fallback: confirmation text + full draft already on currentDraft, but LLM said REPLY
  const currentMessage = ctx.currentMessage ?? '';
  const cd = ctx.currentDraft;
  if (
    action === 'REPLY' &&
    cd?.serviceName &&
    cd?.date &&
    cd?.time &&
    cd?.customerName &&
    cd?.phone &&
    /好|ok|確認|confirm|係呀|係啊|係嘅|冇問題|無問題|submit|啱|正確|得|可以|搞掂/i.test(currentMessage)
  ) {
    action = 'SUBMIT_BOOKING';
    issues.push('Override: REPLY → SUBMIT_BOOKING (all slots filled + user confirmed)');
    console.warn('[v2/validator] Override: REPLY → SUBMIT_BOOKING (simple guard: currentDraft + confirmation text)');
  }

  // ── SUBMIT_BOOKING override (Bug 2 fix) ──
  // Primary signal: confirmationPending flag from previous turn's AiRun.signals
  // Fallback: regex-based detection of booking summary in conversation history
  const confirmationDetected =
    ctx.confirmationPending || lastAssistantLooksLikeBookingConfirmation(ctx);

  if (
    action !== 'SUBMIT_BOOKING' &&
    isDraftComplete(mergedDraft) &&
    confirmationDetected &&
    ctx.currentMessage &&
    isConfirmationMessage(ctx.currentMessage) &&
    (raw.action === 'REPLY' || raw.action === 'REPLY_ONLY')
  ) {
    console.warn(
      '[v2/validator] Overriding action to SUBMIT_BOOKING: draft complete + confirmation detected' +
      ` (flag=${!!ctx.confirmationPending}, regex=${lastAssistantLooksLikeBookingConfirmation(ctx)})` +
      ` LLM returned action=${raw.action}`,
    );
    action = 'SUBMIT_BOOKING';
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