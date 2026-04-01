import type { BookingDraft, AiEngineResult, AiIntent, AiAction } from '../types';
import type { ConversationMode } from '../conversation-mode';
import {
  emptyDraft,
  extractSlots,
  mergeSlots,
  isBookingComplete,
  buildBookingDateTime,
  isValidHkPhone,
  formatDateDisplay,
  formatTimeDisplay,
} from '../booking-state';
import { collectSideEffects, type EngineResponse } from '../response-composer';
import type { ThinLlmOutput } from './thin-types';
import { getThinBookingReferenceDate } from './thin-deterministic-datetime';

function mapIntentToAiIntent(intent: string, nextAction: ThinLlmOutput['nextAction']): AiIntent[] {
  if (nextAction === 'handoff') return ['OTHER'];
  if (
    nextAction === 'booking_collect' ||
    nextAction === 'booking_confirm' ||
    nextAction === 'booking_submit'
  ) {
    return ['BOOKING_REQUEST'];
  }
  if (/price|價|幾錢/i.test(intent)) return ['PRICE_INQUIRY'];
  if (/faq|問|資訊|地址|營業|聯絡/i.test(intent)) return ['FAQ'];
  return ['OTHER'];
}

export function mergeBookingDraftFromThin(
  prior: BookingDraft | undefined,
  thin: ThinLlmOutput,
  currentMessage: string,
): BookingDraft {
  const base = prior ?? emptyDraft();
  const fromLlm: BookingDraft = {
    serviceName: thin.bookingSlots.serviceName ?? base.serviceName,
    serviceDisplayName: thin.bookingSlots.serviceDisplayName ?? base.serviceDisplayName,
    date: thin.bookingSlots.date ?? base.date,
    time: thin.bookingSlots.time ?? base.time,
    customerName: thin.bookingSlots.customerName ?? base.customerName,
    phone: thin.bookingSlots.phone ?? base.phone,
  };
  const fromCode = extractSlots(currentMessage);
  let merged = mergeSlots(fromLlm, fromCode);
  merged = {
    ...merged,
    serviceName: merged.serviceName ?? base.serviceName,
    serviceDisplayName: merged.serviceDisplayName ?? base.serviceDisplayName,
  };
  return merged;
}

export function isBookingReadyForSubmit(draft: BookingDraft): boolean {
  return isBookingComplete(draft) && isValidHkPhone(draft.phone);
}

export function buildThinConfirmationSummary(draft: BookingDraft): string {
  const ref = getThinBookingReferenceDate();
  const svc = draft.serviceDisplayName || draft.serviceName || '（療程）';
  const dateTxt = draft.date ? formatDateDisplay(draft.date, ref) : '—';
  const timeTxt = draft.time ? formatTimeDisplay(draft.time) : '—';
  return [
    '預約資料如下，請核對：',
    `療程：${svc}`,
    `日期：${dateTxt}`,
    `時間：${timeTxt}`,
    `姓名：${draft.customerName ?? '—'}`,
    `電話：${draft.phone ?? '—'}`,
    '',
    '如無問題，請回覆「確認預約」以正式提交。',
  ].join('\n');
}

function modeFromThin(nextAction: ThinLlmOutput['nextAction'], handoff: boolean): ConversationMode {
  if (handoff || nextAction === 'handoff') return 'HANDOFF';
  if (nextAction === 'booking_submit') return 'POST_BOOKING';
  if (nextAction === 'booking_confirm') return 'CONFIRMATION_PENDING';
  if (nextAction === 'booking_collect') return 'BOOKING_DRAFT';
  return 'INQUIRY';
}

function actionFromThin(nextAction: ThinLlmOutput['nextAction'], complete: boolean): AiAction {
  if (nextAction === 'handoff') return 'REPLY_ONLY';
  if (nextAction === 'booking_submit' && complete) return 'REQUEST_BOOKING';
  if (nextAction === 'booking_confirm') return 'REPLY_ONLY';
  if (nextAction === 'booking_collect' || (nextAction === 'booking_submit' && !complete)) return 'ASK_INFO';
  return 'REPLY_ONLY';
}

export function thinOutputToEngineResponse(
  thin: ThinLlmOutput,
  draft: BookingDraft,
  priorMode: ConversationMode | undefined,
): EngineResponse {
  const complete = isBookingReadyForSubmit(draft);
  const action = actionFromThin(thin.nextAction, complete);

  const extractedFields: Record<string, string> = {};
  if (draft.customerName) extractedFields.name = draft.customerName;
  if (draft.phone) extractedFields.phone = draft.phone;

  let bookingData: EngineResponse['bookingData'];
  if (action === 'REQUEST_BOOKING' && complete && draft.date && draft.time) {
    const svc = draft.serviceDisplayName || draft.serviceName || '服務';
    bookingData = {
      serviceName: svc,
      startTime: buildBookingDateTime(draft.date, draft.time).toISOString(),
    };
  }

  const confirmationPending = thin.nextAction === 'booking_confirm';

  return {
    reply: thin.reply,
    intents: mapIntentToAiIntent(thin.intent, thin.nextAction),
    extractedFields,
    action,
    bookingDraft: draft,
    bookingData,
    conversationMode: modeFromThin(thin.nextAction, thin.handoffRequired),
    confirmationPending,
  };
}

export function buildThinCoreResult(params: {
  thin: ThinLlmOutput;
  mergedDraft: BookingDraft;
  priorMode: ConversationMode | undefined;
  inputTokens: number;
  outputTokens: number;
  startTime: number;
}): AiEngineResult {
  const { thin, mergedDraft, priorMode, inputTokens, outputTokens, startTime } = params;

  const response = thinOutputToEngineResponse(thin, mergedDraft, priorMode);
  const sideEffects = collectSideEffects(response);

  return {
    replyText: response.reply,
    signals: {
      intents: response.intents,
      extractedFields: response.extractedFields,
      action: response.action,
      bookingDraft: response.bookingDraft,
      conversationMode: response.conversationMode ?? priorMode,
      confirmationPending: response.confirmationPending ?? false,
    },
    sideEffects,
    shouldHandoff: response.conversationMode === 'HANDOFF',
    analytics: {
      model: process.env.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o-mini',
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startTime,
    },
    enginePath: 'thin-core-v1',
    fallbackReason: undefined,
  };
}
