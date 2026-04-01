import type {
  BookingDraft,
  SideEffect,
  AiIntent,
  AiAction,
  ServiceEntry,
  ServiceMatchResult,
} from './types';
import type { ConversationMode } from './conversation-mode';
import type { DetailType } from './intent-classifier';
import {
  emptyDraft, isBookingComplete,
  buildBookingDateTime,
} from './booking-state';
import {
  buildAmbiguousServicePrompt,
  buildConfirmationSummaryReply,
  buildPostBookingSubmittedReply,
  buildSlotCollectionPrompt,
} from './booking-conversation-policy';

// ── Response shape returned by every compose function ──

export interface EngineResponse {
  reply: string;
  intents: AiIntent[];
  extractedFields: Record<string, string>;
  action: AiAction;
  bookingDraft: BookingDraft;
  bookingData?: {
    serviceName: string;
    startTime: string;
    endTime?: string;
    notes?: string;
  };
  conversationMode?: ConversationMode;
  confirmationPending?: boolean;
  // Decision Engine v1: signals and strategy
  conversationStage?: string;
  customerSignals?: {
    emotion: string;
    resistance: string;
    readiness: number;
    trust: number;
    style: string;
    engagementScore: number;
    riskScore: number;
  };
  strategy?: string;
  strategyMustDo?: string[];
  strategyForbidden?: string[];
}	

// ── Greeting ──

export function composeGreeting(
  contactName: string,
  draft: BookingDraft,
  fields: Record<string, string>,
): EngineResponse {
  const name = contactName && contactName !== '你' ? `${contactName}` : '你好';
  return {
    reply: `${name}～有咩可以幫到你？想了解服務、查價錢，定係想預約，都可以直接講 😊`,
    intents: ['GREETING'],
    extractedFields: fields,
    action: 'REPLY_ONLY',
    bookingDraft: draft,
  };
}

// ── Booking flow (state machine) ──

export function composeBookingResponse(
  draft: BookingDraft,
  serviceMatch: ServiceMatchResult,
  fields: Record<string, string>,
): EngineResponse {
  if (serviceMatch.type === 'ambiguous') {
    const options = serviceMatch.matches.map((m) => m.service.displayName).join('、');
    return {
      reply: buildAmbiguousServicePrompt(options),
      intents: ['BOOKING_REQUEST'],
      extractedFields: fields,
      action: 'ASK_INFO',
      bookingDraft: draft,
    };
  }

  if (isBookingComplete(draft)) {
    const dateTime = buildBookingDateTime(draft.date!, draft.time!);
    const svc = draft.serviceDisplayName || draft.serviceName || '服務';

    return {
      reply: buildPostBookingSubmittedReply(draft),
      intents: ['BOOKING_REQUEST'],
      extractedFields: fields,
      action: 'REQUEST_BOOKING',
      bookingData: {
        serviceName: svc,
        startTime: dateTime.toISOString(),
      },
      bookingDraft: draft,
    };
  }

  return composeNextSlotQuestion(draft, fields);
}

function composeNextSlotQuestion(draft: BookingDraft, fields: Record<string, string>): EngineResponse {
  return {
    reply: buildSlotCollectionPrompt(draft),
    intents: ['BOOKING_REQUEST'],
    extractedFields: fields,
    action: 'ASK_INFO',
    bookingDraft: draft,
  };
}

// ── Confirmation summary (P3: Fixed template for booking confirmation) ──
// Per ChatGPT safety advice: use fixed template to avoid AI over-promising.
// Vocabulary rules:
//   - Before confirmation: only use "已記低", "已更新", "幫你整理"
//   - Never use: "已提交", "已預約成功", "已確認排期"
//   - After explicit confirmation: can use "已幫你提交預約申請"

/**
 * Composes a fixed-format booking summary for confirmation.
 * Used in CONFIRMATION_PENDING state and when user updates slots.
 */
export function composeConfirmationSummary(
  draft: BookingDraft,
  options?: { updatedField?: string; updatedValue?: string },
): { reply: string; intents: AiIntent[]; action: AiAction; bookingDraft: BookingDraft } {
  return {
    reply: buildConfirmationSummaryReply(draft, options),
    intents: ['BOOKING_REQUEST'],
    action: 'ASK_INFO',
    bookingDraft: draft,
  };
}

/**
 * Used when customer asks about availability (咩時間有位, 幾時有位 etc.)
 * We don't have real availability — ask them to propose a time instead.
 */
export function composeAvailabilityResponse(
  draft: BookingDraft,
  fields: Record<string, string>,
): EngineResponse {
  const svc = draft.serviceDisplayName || draft.serviceName || '呢個服務';
  return {
    reply: `${svc}嘅排期由同事確認，你可以講個心儀時間，我幫你記落，同事會盡快回覆你是否可以安排 😊`,
    intents: ['BOOKING_REQUEST'],
    extractedFields: fields,
    action: 'ASK_INFO',
    bookingDraft: draft,
  };
}

// ── Detail question (follow-up about a service) ──

export function composeDetailResponse(
  msg: string,
  detailType: DetailType,
  draft: BookingDraft,
  serviceMatch: ServiceMatchResult,
  catalog: ServiceEntry[],
  fields: Record<string, string>,
  allowDraftServiceFallback = true,
): EngineResponse {
  if (serviceMatch.type === 'ambiguous') {
    const options = serviceMatch.matches.map((m) => m.service.displayName).join('、');
    return {
      reply: `你想了解邊一項？我哋有：${options}`,
      intents: ['PRODUCT_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  let service: ServiceEntry | null = null;

  if (serviceMatch.type === 'exact' || serviceMatch.type === 'close') {
    service = serviceMatch.matches[0].service;
  } else if (allowDraftServiceFallback && draft.serviceName) {
    service = catalog.find((s) => s.code === draft.serviceName) || null;
  }

  if (!service) {
    return {
      reply: `想了解邊個服務嘅詳情呢？可以話我知～`,
      intents: ['PRODUCT_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  const detail = extractDetailFromContent(service.fullInfo, detailType);
  const content = (
    detail || service.fullInfo.split('\n').filter((l) => l.trim()).slice(0, 4).join('\n')
  ).trim();

  const body = content.length > 0 ? content : '呢部分資料暫時未有更多詳情。';
  return {
    reply: `${service.displayName}\n${body}\n\n想預約或有其他問題，隨時話我知 😊`,
    intents: ['PRODUCT_INQUIRY'],
    extractedFields: fields,
    action: 'REPLY_ONLY',
    bookingDraft: draft,
  };
}

// ── Price inquiry ──

export function composePriceResponse(
  serviceMatch: ServiceMatchResult,
  draft: BookingDraft,
  fields: Record<string, string>,
): EngineResponse {
  if (serviceMatch.type === 'exact' || serviceMatch.type === 'close') {
    const svc = serviceMatch.matches[0].service;
    const price = svc.priceInfo || svc.fullInfo.split('\n').slice(0, 3).join('\n');
    return {
      reply: `${svc.displayName} 價錢如下：\n${price}\n\n有興趣預約嗎？話我知想約邊日，幫你記低 😊`,
      intents: ['PRICE_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  if (serviceMatch.type === 'ambiguous') {
    const options = serviceMatch.matches.map((m) => m.service.displayName).join('、');
    return {
      reply: `你想查邊個嘅價錢呢？我哋有：${options}`,
      intents: ['PRICE_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  return {
    reply: `想查邊個服務嘅價錢呢？可以話我知服務名稱～`,
    intents: ['PRICE_INQUIRY'],
    extractedFields: fields,
    action: 'REPLY_ONLY',
    bookingDraft: draft,
  };
}

// ── Service inquiry (with match → show overview) ──

export function composeInquiryResponse(
  serviceMatch: ServiceMatchResult,
  catalog: ServiceEntry[],
  draft: BookingDraft,
  fields: Record<string, string>,
): EngineResponse {
  if (serviceMatch.type === 'exact' || serviceMatch.type === 'close') {
    const svc = serviceMatch.matches[0].service;
    const infoLines = svc.fullInfo.split('\n').filter((l) => l.trim());
    const summary = infoLines.slice(0, 5).join('\n').trim();

    if (summary.length >= 12) {
      return {
        reply: `${svc.displayName}\n${summary}\n\n想了解更多或預約，可以直接話我知 😊`,
        intents: ['PRODUCT_INQUIRY'],
        extractedFields: fields,
        action: 'REPLY_ONLY',
        bookingDraft: draft,
      };
    }

    return {
      reply: `「${svc.displayName}」想了解咩？價錢、功效，定係想預約？`,
      intents: ['PRODUCT_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  if (serviceMatch.type === 'ambiguous') {
    const options = serviceMatch.matches.map((m) => m.service.displayName).join('、');
    return {
      reply: `你想了解邊個呢？我哋有：${options}`,
      intents: ['PRODUCT_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  if (catalog.length > 0) {
    const names = catalog.slice(0, 6).map((s) => s.displayName).join('、');
    return {
      reply: `我哋有以下服務：${names}。\n想了解邊個，或者想預約，可以話我知 😊`,
      intents: ['PRODUCT_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    };
  }

  return {
    reply: `有咩想了解？可以問我服務詳情、價錢，或者安排預約 😊`,
    intents: ['PRODUCT_INQUIRY'],
    extractedFields: fields,
    action: 'REPLY_ONLY',
    bookingDraft: draft,
  };
}

// ── Contact info / fallback ──

export function composeContactInfoResponse(
  draft: BookingDraft,
  fields: Record<string, string>,
): EngineResponse {
  return {
    reply: `收到！想查服務資料，定係想預約？話我知可以幫你 😊`,
    intents: ['CONTACT_INFO'],
    extractedFields: fields,
    action: 'REPLY_ONLY',
    bookingDraft: draft,
  };
}

export function composeFallback(
  draft: BookingDraft,
  fields: Record<string, string>,
): EngineResponse {
  return {
    reply: `收到～有咩可以幫到你？想了解服務或預約都可以話我知 😊`,
    intents: ['OTHER'],
    extractedFields: fields,
    action: 'REPLY_ONLY',
    bookingDraft: draft,
  };
}

// ── Side effects ──

export function collectSideEffects(response: EngineResponse): SideEffect[] {
  const effects: SideEffect[] = [];

  if (
    (response.action === 'REQUEST_BOOKING' || response.action === 'CREATE_BOOKING') &&
    response.bookingData
  ) {
    effects.push({
      type: 'CREATE_BOOKING',
      data: {
        serviceName: response.bookingData.serviceName,
        startTime: response.bookingData.startTime,
      },
    });
  }

  const { name, phone } = response.extractedFields;
  if (name || phone) {
    effects.push({ type: 'UPDATE_CONTACT', data: { name, phone } });
  }

  return effects;
}

// ── Helpers ──

export function getDisplayName(name: string | undefined): string {
  if (!name) return '你';
  if (/^(demo|test|visitor|guest|customer|user|unknown)/i.test(name.trim())) return '你';
  return name;
}

function extractDetailFromContent(fullInfo: string, detailType: DetailType): string | null {
  const lines = fullInfo.split('\n').filter((l) => l.trim());

  const patterns: Record<DetailType, RegExp> = {
    effect: /功效|效果|benefit|好處/i,
    duration: /時長|時間|分鐘|小時|duration/i,
    ingredient: /成[份分]|配方|ingredient|材料/i,
    process: /過程|步驟|流程|做法|process/i,
    general: /$^/,
  };

  const pattern = patterns[detailType];
  const matched = lines.filter((l) => pattern.test(l));
  if (matched.length > 0) return matched.join('\n');

  if (detailType === 'general') {
    const nonPriceLines = lines.filter((l) => !/價|price|\$|HKD|零售|優惠|折/i.test(l));
    return nonPriceLines.slice(0, 4).join('\n');
  }

  return null;
}

// ── Booking flow regression (run after build) ──

const SUCCESS_CLAIM_PATTERN = /搞掂|成功預約|已經預約|預約咗/;

export function verifyBookingFlowRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const completeDraft: BookingDraft = {
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
    date: '2026-03-25',
    time: '14:00',
    customerName: 'Amy',
    phone: '91234567',
  };

  const rComplete = composeBookingResponse(completeDraft, { type: 'exact', matches: [] }, {});
  if (SUCCESS_CLAIM_PATTERN.test(rComplete.reply)) {
    failures.push(`complete draft: reply must not claim confirmed booking: ${rComplete.reply.slice(0, 80)}…`);
  }
  if (rComplete.action !== 'REQUEST_BOOKING') {
    failures.push(`complete draft: expected action REQUEST_BOOKING, got ${rComplete.action}`);
  }
  const fx = collectSideEffects(rComplete);
  if (!fx.some((e) => e.type === 'CREATE_BOOKING')) {
    failures.push('complete draft: expected CREATE_BOOKING side effect for downstream');
  }

  const mockSvc: ServiceEntry = {
    code: 'a',
    displayName: 'Service A',
    aliases: [],
    priceInfo: null,
    fullInfo: '',
  };
  const ambiguous: ServiceMatchResult = {
    type: 'ambiguous',
    matches: [
      { service: mockSvc, confidence: 0.8 },
      { service: { ...mockSvc, code: 'b', displayName: 'Service B' }, confidence: 0.76 },
    ],
  };
  const rAmb = composeBookingResponse(completeDraft, ambiguous, {});
  if (!rAmb.reply.includes('想預約邊一項')) {
    failures.push(`ambiguous: expected clarification question, got: ${rAmb.reply.slice(0, 80)}`);
  }
  if (rAmb.action !== 'ASK_INFO') {
    failures.push(`ambiguous: expected ASK_INFO, got ${rAmb.action}`);
  }

  const partial = emptyDraft();
  partial.serviceName = 'x';
  partial.serviceDisplayName = 'Eye Treatment';
  partial.date = '2026-03-25';
  partial.time = '10:00';
  partial.customerName = 'Bob';
  const rMissing = composeBookingResponse(partial, { type: 'exact', matches: [] }, {});
  if (!rMissing.reply.includes('電話')) {
    failures.push(`missing phone: expected phone prompt, got: ${rMissing.reply}`);
  }
  if (rMissing.action !== 'ASK_INFO') {
    failures.push(`missing slot: expected ASK_INFO, got ${rMissing.action}`);
  }

  return { ok: failures.length === 0, failures };
}

/** Misleading marketing / fake availability — must not appear in customer-facing replies. */
const MISLEADING_PHRASE_PATTERNS: RegExp[] = [/聽日仲有位/, /好受歡迎/, /仲有位㗎/];

function assertNoMisleadingPhrases(reply: string, label: string, failures: string[]): void {
  for (const re of MISLEADING_PHRASE_PATTERNS) {
    if (re.test(reply)) {
      failures.push(`${label}: reply must not match ${re}: ${reply.slice(0, 120)}…`);
    }
  }
}

export function verifyResponseQualityRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const mockSvcPrice: ServiceEntry = {
    code: 'facial_a',
    displayName: '嫩膚療程',
    aliases: [],
    priceInfo: '單次 HKD 880（參考）',
    fullInfo: '功效：深層補濕\n時長：約 60 分鐘',
  };

  const rPrice = composePriceResponse(
    { type: 'exact', matches: [{ service: mockSvcPrice, confidence: 1 }] },
    emptyDraft(),
    {},
  );
  assertNoMisleadingPhrases(rPrice.reply, 'price', failures);
  if (!rPrice.reply.includes('HKD 880')) {
    failures.push('price: expected HKD 880 in reply');
  }

  const mockSvcRich: ServiceEntry = {
    code: 'facial_b',
    displayName: '水潤療程',
    aliases: [],
    priceInfo: null,
    fullInfo: '功效：深層補濕，改善乾紋\n流程：潔面 → 導入 → 鎖水膜\n時長：約 50 分鐘',
  };

  const rInq = composeInquiryResponse(
    { type: 'exact', matches: [{ service: mockSvcRich, confidence: 1 }] },
    [],
    emptyDraft(),
    {},
  );
  assertNoMisleadingPhrases(rInq.reply, 'inquiry', failures);
  if (!rInq.reply.includes('深層補濕')) {
    failures.push('inquiry: expected concrete summary (深層補濕) before generic prompt');
  }

  const rDetail = composeDetailResponse(
    '有咩功效',
    'effect',
    emptyDraft(),
    { type: 'exact', matches: [{ service: mockSvcRich, confidence: 1 }] },
    [],
    {},
  );
  assertNoMisleadingPhrases(rDetail.reply, 'detail', failures);
  if (!rDetail.reply.includes('功效')) {
    failures.push('detail: expected effect content in reply');
  }

  const draftTimeMissing: BookingDraft = {
    serviceName: 'facial_a',
    serviceDisplayName: '嫩膚療程',
    date: '2026-04-10',
    time: null,
    customerName: '阿明',
    phone: '91234567',
  };
  const rBook = composeBookingResponse(draftTimeMissing, { type: 'exact', matches: [] }, {});
  assertNoMisleadingPhrases(rBook.reply, 'booking-time', failures);
  if (!/幾點|具體時間|15:00|下午/.test(rBook.reply)) {
    failures.push('booking-time: expected time prompt');
  }

  const rGreet = composeGreeting('阿詩', emptyDraft(), {});
  assertNoMisleadingPhrases(rGreet.reply, 'greeting', failures);

  return { ok: failures.length === 0, failures };
}
