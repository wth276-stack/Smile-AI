import type { BookingDraft } from './types';
import { extractSlots } from './booking-state';

/** Full-width punctuation / Latin → half-width so ７／？／ａ match extractors & intent regex. */
export function foldIntentMessage(str: string): string {
  return str
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export type MessageIntent =
  | 'GREETING'
  | 'BOOKING'
  | 'PRICE'
  | 'INQUIRY'
  | 'DETAIL_QUESTION'
  | 'CONTACT_INFO'
  | 'OTHER';

export type DetailType = 'effect' | 'duration' | 'ingredient' | 'process' | 'general';

function bookingDraftHasProgress(d: BookingDraft | null | undefined): boolean {
  return !!(d && (d.serviceName || d.date || d.time || d.customerName || d.phone));
}

/**
 * When a draft already has booking progress, treat messages that mainly contribute
 * date/time/name/phone as BOOKING so signals match the booking composer (not OTHER).
 * Stronger intents (DETAIL / PRICE / …) still win first.
 */
export function isBookingSlotFollowUp(msg: string, bookingDraft?: BookingDraft | null): boolean {
  if (!bookingDraftHasProgress(bookingDraft)) return false;
  const slots = extractSlots(foldIntentMessage(msg));
  return !!(slots.date || slots.time || slots.customerName || slots.phone);
}

/**
 * Intent priority (first match wins). Plain language:
 * 1 GREETING — 極短問候專用
 * 2 DETAIL_QUESTION — 功效/成份/時長等細節，優先於泛詢問
 * 3 PRICE — 明確問價（幾錢、how much…），優先於「約」類用語（例如 想約下幾錢）
 * 4 BOOKING — 預約/想約/約唔約到，或「星期/日期 + 約」
 * 5 INQUIRY — 想了解/想做療程等（優先於「純補 slot」，避免「想了解…電話」變 BOOKING）
 * 6 BOOKING（補 slot）— 已有 draft 進度，而本句主要係日期/時間/名/電話
 * 7 CONTACT_INFO — 僅在沒有上述更強意圖時，且內容主要是留名/電話
 * 8 OTHER
 *
 * @param bookingDraft — optional incoming draft; when set, slot-only follow-ups map to BOOKING.
 */
export function detectIntent(msg: string, bookingDraft?: BookingDraft | null): MessageIntent {
  const t = foldIntentMessage(msg.trim());
  if (/^(hi|hello|你好|嗨|hey|哈囉)[,，。！!\s]*$/i.test(t)) {
    return 'GREETING';
  }

  if (isDetailQuestion(t)) {
    return 'DETAIL_QUESTION';
  }

  if (hasStrongPriceIntent(t)) {
    return 'PRICE';
  }

  if (hasBookingIntent(t)) {
    return 'BOOKING';
  }

  if (hasInquiryIntent(t)) {
    return 'INQUIRY';
  }

  if (isBookingSlotFollowUp(msg, bookingDraft)) {
    return 'BOOKING';
  }

  if (isPrimarilyContactInfo(t)) {
    return 'CONTACT_INFO';
  }

  if (/產品|product|服務|service|有什麼|有咩|推薦|recommend|療程|treatment/i.test(t)) {
    return 'INQUIRY';
  }

  return 'OTHER';
}

/**
 * 明確問價（簡繁 + 常見口語）。用 fold 後字串比對，避免全形標點阻擋命中。
 * 刻意避免單獨裸「價」字，減少命中正文「正價」等；但「價錢/价钱/价格」等詞組保留。
 */
export function hasStrongPriceIntent(rawMsg: string): boolean {
  const msg = foldIntentMessage(rawMsg.trim());
  return /幾錢|几多钱|几钱|几多|多少钱|多少錢|钱多少|价钱|價錢|价格|價格|什么价|什麼價|怎么收费|怎麼收費|怎樣收費|点收费|點收費|how\s*much|how\s*much\s*is|\bprice\b|\bcost\b|收費|收费|收幾多|收几多|幾多錢|幾銀|pricing|what('?s)?\s+the\s+price/i.test(
    msg,
  );
}

/**
 * 預約意圖：預約/book/想約/約唔約…；或「星期/日期」與「約/預約」並存。
 * 不用裸「約」一字，減少誤判。
 */
function hasBookingIntent(msg: string): boolean {
  if (
    /預約|book(ing)?\b|訂位|訂座|想約|約唔約|約唔約到|可唔可以約|約到|有冇位|有冇得約|約嗎|可以約|約定時間/i.test(
      msg,
    )
  ) {
    return true;
  }
  const hasTimeHint =
    /星期|週|周|礼拜|禮拜|明天|今日|今天|聽日|後天|后天|下[個个]?(?:星期|週|周|禮拜)|\d{1,2}月\d{1,2}/.test(
      msg,
    );
  if (hasTimeHint && /約|預約|book/i.test(msg)) {
    return true;
  }
  return false;
}

function hasInquiryIntent(msg: string): boolean {
  return /我想(做|試|了解|問)|想了解|想問|想要|想做|想試|有什麼|有咩|推薦|recommend|邊個好|邊隻好|介紹下|介紹一下/i.test(
    msg,
  );
}

function isPrimarilyContactInfo(msg: string): boolean {
  const hasIdentity = /我(叫|係|是|姓)\s*[a-zA-Z\u4e00-\u9fff]/.test(msg);
  const hasPhoneCue = /電話|手提|whatsapp|whats\s*app|聯絡|聯繫|contact|tel\.?|mobile|手機/i.test(msg);
  const hasPhoneDigits = /\d{8,11}/.test(msg);
  if (!hasIdentity && !hasPhoneCue && !hasPhoneDigits) {
    return false;
  }
  if (hasStrongPriceIntent(msg) || hasBookingIntent(msg) || hasInquiryIntent(msg) || isDetailQuestion(msg)) {
    return false;
  }
  return true;
}

export function classifyDetailQuestion(msg: string): DetailType {
  const t = foldIntentMessage(msg.trim());
  if (/功效|效果|effect|有咩用|有什麼用|好處|benefit/i.test(t)) return 'effect';
  if (/時長|幾耐|幾長|多長|做幾耐|分鐘|小時|duration|how long/i.test(t)) return 'duration';
  if (/成[份分]|ingredient|材料|配方/i.test(t)) return 'ingredient';
  if (/過程|步驟|流程|做法|process|procedure/i.test(t)) return 'process';
  return 'general';
}

export function isDetailQuestion(msg: string): boolean {
  const t = foldIntentMessage(msg.trim());
  return /功效|效果|成[份分]|時長|幾耐|幾長|多長|做幾耐|要幾耐|幾多分鐘|包[括含]什麼|有咩功效|有什麼效果|適合|注意|做法|過程|步驟|details|effect|duration|how long|ingredient/i.test(
    t,
  );
}

/**
 * Same intent repair chain as rule `processMessage` (expects **folded** message like the orchestrator).
 * Used for LLM semantic cross-checks.
 */
export function resolveRepairedRuleIntent(
  foldedMsg: string,
  bookingDraft?: BookingDraft | null,
): MessageIntent {
  let intent = detectIntent(foldedMsg, bookingDraft);
  if (isDetailQuestion(foldedMsg)) {
    intent = 'DETAIL_QUESTION';
  } else if (hasStrongPriceIntent(foldedMsg)) {
    intent = 'PRICE';
  } else if (
    (intent === 'OTHER' || intent === 'CONTACT_INFO') &&
    isBookingSlotFollowUp(foldedMsg, bookingDraft)
  ) {
    intent = 'BOOKING';
  }
  return intent;
}

// ── Regression: node -e "const m=require('./packages/ai-engine/dist/intent-classifier.js'); const r=m.verifyIntentRegression(); console.log(JSON.stringify(r,null,2)); process.exit(r.ok?0:1);"

export function verifyIntentRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const cases: { label: string; text: string; want: MessageIntent }[] = [
    { label: 'booking+price', text: '想約下幾錢', want: 'PRICE' },
    { label: 'contact+service', text: '我電話係 91234567，我想做美白', want: 'INQUIRY' },
    { label: 'weekday+booking', text: '星期三約唔約到 Focus HIFU？', want: 'BOOKING' },
    { label: 'service+price', text: 'Eye Treatment 幾錢？', want: 'PRICE' },
    { label: 'detail', text: '我想了解 Eye Treatment 功效', want: 'DETAIL_QUESTION' },
    { label: 'pure contact', text: '我叫 Amy，電話 91234567', want: 'CONTACT_INFO' },
    { label: 'price beats weak yue', text: '約時間都要先問幾錢', want: 'PRICE' },
    { label: 'inquiry with phone trailing', text: '我想了解HIFU，打比我91234567', want: 'INQUIRY' },
    { label: 'simplified 多少钱', text: 'HIFU 多少钱？', want: 'PRICE' },
    { label: 'fullwidth price punct', text: 'Eye Treatment 幾錢？', want: 'PRICE' },
  ];

  for (const { label, text, want } of cases) {
    const got = detectIntent(text);
    if (got !== want) {
      failures.push(`${label}: ${JSON.stringify(text)} => ${got}, want ${want}`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/** Draft-context intent: node -e "const m=require('./packages/ai-engine/dist/intent-classifier.js'); const r=m.verifyIntentDraftContextRegression(); console.log(JSON.stringify(r,null,2)); process.exit(r.ok?0:1);" */

export function verifyIntentDraftContextRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const partialDraft: BookingDraft = {
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
    date: '2026-06-15',
    time: null,
    customerName: null,
    phone: null,
  };

  const cases: { label: string; text: string; draft: BookingDraft | undefined; want: MessageIntent }[] = [
    { label: 'slot time only', text: '晚上7點', draft: partialDraft, want: 'BOOKING' },
    { label: 'slot weekday only', text: '下星期三', draft: partialDraft, want: 'BOOKING' },
    { label: 'slot phone only', text: '91234567', draft: partialDraft, want: 'BOOKING' },
    { label: 'price still wins', text: 'HIFU 幾錢？', draft: partialDraft, want: 'PRICE' },
    { label: 'detail still wins', text: '有咩功效', draft: partialDraft, want: 'DETAIL_QUESTION' },
    { label: 'inquiry+phone beats slot', text: '我想了解HIFU，打比我91234567', draft: partialDraft, want: 'INQUIRY' },
    { label: 'no draft time only', text: '晚上7點', draft: undefined, want: 'OTHER' },
    { label: 'simplified price with draft', text: 'HIFU 多少钱？', draft: partialDraft, want: 'PRICE' },
    { label: 'fullwidth slot 7pm', text: '晚上７點', draft: partialDraft, want: 'BOOKING' },
  ];

  for (const { label, text, draft, want } of cases) {
    const got = detectIntent(text, draft);
    if (got !== want) {
      failures.push(`${label}: ${JSON.stringify(text)} => ${got}, want ${want}`);
    }
  }

  return { ok: failures.length === 0, failures };
}
