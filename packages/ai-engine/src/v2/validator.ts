import type { BookingDraft, KnowledgeChunk } from '../types';

function mergeDraft(
  existing: BookingDraft | undefined | null,
  llmDraft: Partial<BookingDraft> | undefined | null,
): BookingDraft {
  return {
    bookingId: llmDraft?.bookingId ?? existing?.bookingId ?? null,
    serviceName: llmDraft?.serviceName ?? existing?.serviceName ?? null,
    serviceDisplayName: llmDraft?.serviceDisplayName ?? existing?.serviceDisplayName ?? null,
    date: llmDraft?.date ?? existing?.date ?? null,
    time: llmDraft?.time ?? existing?.time ?? null,
    customerName: llmDraft?.customerName ?? existing?.customerName ?? null,
    phone: llmDraft?.phone ?? existing?.phone ?? null,
  };
}

interface ValidateContext {
  currentDraft?: BookingDraft;
  knowledgeChunks: KnowledgeChunk[];
}

interface LlmRawOutput {
  replyText?: string;
  intents?: string[];
  newSlots?: Partial<BookingDraft>;
  action?: string;
  bookingDraft?: Partial<BookingDraft>;
}

export function validateOutput(
  raw: LlmRawOutput,
  ctx: ValidateContext,
) {
  const issues: string[] = [];
  let reply = raw.replyText ?? '抱歉，我唔太明白你嘅意思，可以再講多少少嗎？';
  let action = raw.action ?? 'REPLY_ONLY';
  const intent = raw.intents?.[0] ?? 'OTHER';
  const newSlots = raw.newSlots ?? raw.bookingDraft ?? {};
  const mergedDraft = mergeDraft(ctx.currentDraft, newSlots);

  if (newSlots.serviceDisplayName) {
    const titles = ctx.knowledgeChunks.map((c) => c.title.toLowerCase());
    if (!titles.includes(newSlots.serviceDisplayName.toLowerCase())) {
      const available = ctx.knowledgeChunks.map((c) => c.title).join('、');
      issues.push(`Service "${newSlots.serviceDisplayName}" not found in KB`);
      reply = `我哋提供嘅服務有：${available}。你想了解邊一個？`;
      action = 'REPLY_ONLY';
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

  return {
    action,
    intent,
    newSlots,
    validatedReply: reply,
    mergedDraft,
    validationIssues: issues,
  };
}
