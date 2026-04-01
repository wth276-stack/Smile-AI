/**
 * question-router.ts
 *
 * Phase 1.5A — deterministic question type classifier.
 * No LLM calls. Pattern-based only.
 *
 * Scope (1.5A): global FAQ types only.
 * Service-detail types (service_effect, service_unsuitable_for, etc.)
 * are defined here for future phases but NOT routed yet.
 */

// ── Question type taxonomy ────────────────────────────────────────────────────

export type QuestionType =
  // Global FAQ — handled in 1.5A
  | 'faq_deposit'        // 訂金、預付、留位費
  | 'faq_payment'        // 信用卡、付款方式、PayMe 等
  | 'faq_first_visit'    // 第一次到店、首次做美容

  // Global FAQ — defined for future phases
  | 'faq_cancellation'   // 取消、改期
  | 'faq_hours'          // 營業時間
  | 'faq_safety'         // 安全、副作用、懷孕
  | 'faq_general'        // 其他通用政策

  // Service detail — defined for 1.5C
  | 'service_effect'
  | 'service_price'
  | 'service_suitable_for'
  | 'service_unsuitable_for'
  | 'service_procedure'
  | 'service_precaution'
  | 'service_aftercare'
  | 'service_duration'
  | 'service_expected_result'

  | 'unknown';

export interface QuestionRouteResult {
  questionType: QuestionType;
  isGlobalFaq: boolean;
  /** True when the question needs a resolved service to answer */
  needsServiceContext: boolean;
  confidence: number;
}

// ── Global FAQ types set ──────────────────────────────────────────────────────

const GLOBAL_FAQ_TYPES = new Set<QuestionType>([
  'faq_deposit',
  'faq_payment',
  'faq_first_visit',
  'faq_cancellation',
  'faq_hours',
  'faq_safety',
  'faq_general',
]);

// ── Pattern definitions ───────────────────────────────────────────────────────
// Each entry: [QuestionType, regex, confidence]
// Evaluated in order — first match wins.

const PATTERNS: [QuestionType, RegExp, number][] = [

  // ── faq_deposit ────────────────────────────────────────────────────────────
  // Strictly deposit-specific vocabulary only.
  // Generic payment phrases (要付款/要俾錢/預付) must NOT match here —
  // they fall through to faq_payment or unknown.
  [
    'faq_deposit',
    /訂金|留位費|deposit/i,
    0.95,
  ],

  // ── faq_payment ────────────────────────────────────────────────────────────
  [
    'faq_payment',
    /信用卡|credit.?card|visa|master|八達通|octopus|payme|wechat.?pay|付款方式|點俾錢|點付款|接唔接受/i,
    0.95,
  ],

  // ── faq_first_visit ────────────────────────────────────────────────────────
  // Pattern matches generic "first visit" language only.
  // Service-keyword guard is applied in classifyQuestion() — if the message
  // contains a specific service name suffix (療程/Facial/激光/HIFU etc.),
  // this type is suppressed and falls through to service_precaution (1.5C).
  [
    'faq_first_visit',
    /第一次做美容|初次到店|首次到店|新客.*注意|第一次黎(?!做)|新嚟(?!做)/i,
    0.9,
  ],

  // ── faq_cancellation ──────────────────────────────────────────────────────
  [
    'faq_cancellation',
    /取消|改期|更改預約|cancel|reschedule|退訂/i,
    0.9,
  ],

  // ── faq_hours ─────────────────────────────────────────────────────────────
  [
    'faq_hours',
    /幾點開門|幾點關門|營業時間|幾時開|幾時閂|opening.?hour|business.?hour/i,
    0.9,
  ],

  // ── faq_safety ────────────────────────────────────────────────────────────
  [
    'faq_safety',
    /安唔安全|安全嗎|副作用|懷孕.*做|孕婦|會唔會有問題|有冇問題/i,
    0.85,
  ],

  // ── service_unsuitable_for ────────────────────────────────────────────────
  // Defined now, routed in 1.5C
  [
    'service_unsuitable_for',
    /唔適合|邊啲人唔.*做|邊類人唔|唔啱做|禁忌|不建議|做唔做得|可唔可以做|有咩人.*唔/i,
    0.9,
  ],

  // ── service_suitable_for ──────────────────────────────────────────────────
  [
    'service_suitable_for',
    /適合咩人|邊啲人.*適合|邊類人.*做|適合.*人士|邊個適合|我適唔適合|啱唔啱我|啱咩人/i,
    0.9,
  ],

  // ── service_procedure ─────────────────────────────────────────────────────
  [
    'service_procedure',
    /步驟|流程|點做|做咩|會做啲咩|procedure|怎麼做|會點樣/i,
    0.9,
  ],

  // ── service_aftercare ─────────────────────────────────────────────────────
  [
    'service_aftercare',
    /做完.*注意|術後|aftercare|護理.*之後|完成.*後.*點|療程後/i,
    0.9,
  ],

  // ── service_precaution ────────────────────────────────────────────────────
  [
    'service_precaution',
    /注意事項|注意咩|要注意|術前|before.*treatment|需要準備|做完.*會點|做.*會點樣|第一次做.*會點/i,
    0.85,
  ],

  // ── service_effect ────────────────────────────────────────────────────────
  [
    'service_effect',
    /功效|效果|有咩用|有咩好|點樣改善|改善.*咩|作用|benefit/i,
    0.9,
  ],

  // ── service_price ─────────────────────────────────────────────────────────
  [
    'service_price',
    /幾錢|價錢|收費|價格|試做價|正價|多少錢|price|cost|fee/i,
    0.9,
  ],

  // ── service_duration ─────────────────────────────────────────────────────
  [
    'service_duration',
    /幾耐|要幾長時間|時長|duration|幾個鐘|幾分鐘/i,
    0.85,
  ],

  // ── service_expected_result ───────────────────────────────────────────────
  [
    'service_expected_result',
    /幾次見效|幾耐見到效果|效果持續|維持幾耐|持久|long.?lasting/i,
    0.85,
  ],
];

// ── Core classifier ───────────────────────────────────────────────────────────

/**
 * Classify a user message into a QuestionType.
 * Deterministic — no LLM, no async.
 */
// ── Service keyword guard ────────────────────────────────────────────────────
// If the message contains a specific service term, faq_first_visit should NOT
// fire — the question is service-specific (handled in 1.5C as service_precaution).
const SERVICE_KEYWORD_PATTERN =
  /療程|facial|Facial|激光|HIFU|hifu|脫毛|祛斑|嫩膚|暗瘡|敏感肌|補水|美白|彩光|IPL|ipl|眼部|抗衰老/i;

export function classifyQuestion(message: string): QuestionRouteResult {
  const msg = message.trim();
  console.log(`[QR] raw input: "${msg}"`);
  console.log(`[QR] length: ${msg.length}, char codes: ${Array.from(msg).map(c => c.charCodeAt(0)).slice(0, 15).join(',')}`);
  console.log(`[QR] includes 幾: ${msg.includes('幾')}, includes 錢: ${msg.includes('錢')}`);

  // Direct test
  const pricePattern = /幾錢|價錢|收費|價格|試做價|正價|多少錢|price|cost|fee/i;
  console.log(`[QR] pricePattern.test: ${pricePattern.test(msg)}`);

  for (const [type, pattern, confidence] of PATTERNS) {
    if (pattern.test(msg)) {
      console.log(`[QUESTION-ROUTER] matched: type=${type} pattern=${pattern}`);
      // Guard: faq_first_visit must not fire when message has a service keyword.
      // "第一次做激光祛斑要注意咩" is service_precaution, not a global FAQ.
      if (type === 'faq_first_visit' && SERVICE_KEYWORD_PATTERN.test(msg)) {
        // Fall through — let service_precaution pattern catch it below
        continue;
      }

      const isGlobalFaq = GLOBAL_FAQ_TYPES.has(type);
      return {
        questionType: type,
        isGlobalFaq,
        needsServiceContext: !isGlobalFaq,
        confidence,
      };
    }
  }

  console.log(`[QUESTION-ROUTER] no match found, returning unknown`);
  return {
    questionType: 'unknown',
    isGlobalFaq: false,
    needsServiceContext: false,
    confidence: 0,
  };
}

/**
 * Returns true only for the 3 FAQ types handled in Phase 1.5A.
 * Other types fall through to existing handlers until 1.5B/1.5C.
 */
export function isPhase15AFaqType(type: QuestionType): boolean {
  return type === 'faq_deposit' || type === 'faq_payment' || type === 'faq_first_visit';
}

// ── FAQ answer map (sourced directly from KB-14) ─────────────────────────────
// Hard-coded for 1.5A — no retrieval needed for these 3 types.
// Replace with retriever lookup in 1.5C if KB content changes.

const FAQ_ANSWERS: Partial<Record<QuestionType, string>> = {
  faq_deposit:
    '首次預約係唔需要訂金嘅 😊 套餐或激光療程可能需要少量訂金，同事確認預約時會跟你講清楚。',

  faq_payment:
    '我哋接受多種付款方式：Visa、Mastercard、八達通、PayMe 同 WeChat Pay 都得 💳 有其他問題隨時問！',

  faq_first_visit:
    '第一次嚟，建議預約前告知美容師你嘅皮膚狀況、過敏史同正在服用嘅藥物。' +
    '首次一般建議選擇溫和療程，例如深層清潔或補水療程，咁效果同舒適度都會更好 😊',
};

/**
 * Get the hard-coded FAQ answer for a given type.
 * Returns null if type is not handled in 1.5A.
 */
export function getFaqAnswer(type: QuestionType): string | null {
  return FAQ_ANSWERS[type] ?? null;
}

// ── Regression tests ──────────────────────────────────────────────────────────

export function verifyQuestionRouterRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function check(label: string, msg: string, expectedType: QuestionType, expectFaq: boolean) {
    const result = classifyQuestion(msg);
    if (result.questionType !== expectedType) {
      failures.push(
        `${label}: got type="${result.questionType}", want "${expectedType}" (msg="${msg}")`,
      );
    }
    if (result.isGlobalFaq !== expectFaq) {
      failures.push(
        `${label}: got isGlobalFaq=${result.isGlobalFaq}, want ${expectFaq} (msg="${msg}")`,
      );
    }
  }

  // ── 1.5A target cases ───────────────────────────────────────────────────────

  // faq_deposit: must match
  check('deposit 1', '需要預付訂金嗎', 'faq_deposit', true);
  check('deposit 2', '要唔要俾訂金', 'faq_deposit', true);
  check('deposit 3', '有冇留位費', 'faq_deposit', true);

  // faq_payment: must match
  check('payment 1', '可以用信用卡付款嗎', 'faq_payment', true);
  check('payment 2', '接唔接受八達通', 'faq_payment', true);
  check('payment 3', '可以PayMe嗎', 'faq_payment', true);

  // faq_first_visit: must match (no service keyword)
  check('first_visit 1', '第一次做美容需要注意咩', 'faq_first_visit', true);
  check('first_visit 2', '初次到店要準備咩', 'faq_first_visit', true);

  // ── Negative cases (must NOT be FAQ) ─────────────────────────────────────

  // Deposit guard: generic payment phrases must NOT become faq_deposit
  check('not deposit 1', '要付款嗎', 'unknown', false);
  check('not deposit 2', '可以先付款嗎', 'unknown', false);    // asks about timing, not payment method → not faq_payment

  // first_visit guard: service keyword present → NOT global FAQ
  check('not first_visit 1', '第一次做激光祛斑要注意咩', 'service_precaution', false);
  check('not first_visit 2', '第一次做暗瘡療程會點', 'service_precaution', false);
  check('not first_visit 3', '第一次嚟做facial需要準備咩', 'service_precaution', false);

  // payment still works
  check('payment still ok', '可以用信用卡付款嗎', 'faq_payment', true);

  // Service detail: must NOT be classified as any FAQ
  check('service unsuitable', '有咩人唔適合做激光祛斑', 'service_unsuitable_for', false);
  check('service effect', '暗瘡療程有咩功效', 'service_effect', false);
  check('service price', '敏感肌修護療程幾錢', 'service_price', false);

  // ── isPhase15AFaqType guard ───────────────────────────────────────────────
  if (!isPhase15AFaqType('faq_deposit')) failures.push('isPhase15AFaqType: faq_deposit should be true');
  if (!isPhase15AFaqType('faq_payment')) failures.push('isPhase15AFaqType: faq_payment should be true');
  if (!isPhase15AFaqType('faq_first_visit')) failures.push('isPhase15AFaqType: faq_first_visit should be true');
  if (isPhase15AFaqType('faq_cancellation')) failures.push('isPhase15AFaqType: faq_cancellation should be false');
  if (isPhase15AFaqType('service_effect')) failures.push('isPhase15AFaqType: service_effect should be false');

  return { ok: failures.length === 0, failures };
}