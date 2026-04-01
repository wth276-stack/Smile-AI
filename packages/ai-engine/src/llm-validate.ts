import type { LlmPlannerIntent, LlmPlannerOutput, LlmNextSlot } from './llm-contract';

const INTENTS: Set<LlmPlannerIntent> = new Set([
  'GREETING',
  'INQUIRY',
  'PRICE',
  'DETAIL',
  'BOOKING',
  'BOOKING_SLOT_FILL',
  'CONTACT_INFO',
  'OTHER',
]);

const NEXT_SLOTS: Set<LlmNextSlot> = new Set([
  'serviceName',
  'date',
  'time',
  'customerName',
  'phone',
  null,
]);

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function asString(v: unknown, maxLen: number): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

/** YYYY-MM-DD */
function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** HH:mm */
function isHHmm(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

function normalizePhone(s: string): string | null {
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length <= 11) return digits;
  return null;
}

export type ValidateFailureReason =
  | 'not_object'
  | 'bad_schema_version'
  | 'bad_intent'
  | 'missing_replyText'
  | 'bad_extracted'
  | 'bad_next_slot'
  | 'bad_boolean';

/**
 * Deterministic validation only (v1). No confidence threshold.
 */
export function validateLlmPlannerJson(raw: unknown): { ok: true; value: LlmPlannerOutput } | { ok: false; reason: ValidateFailureReason } {
  if (!isObject(raw)) return { ok: false, reason: 'not_object' };

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== 1) return { ok: false, reason: 'bad_schema_version' };

  const intent = raw.intent as LlmPlannerIntent;
  if (typeof intent !== 'string' || !INTENTS.has(intent)) return { ok: false, reason: 'bad_intent' };

  if (typeof raw.replyText !== 'string') return { ok: false, reason: 'missing_replyText' };

  const extractedIn = raw.extracted;
  if (!isObject(extractedIn)) return { ok: false, reason: 'bad_extracted' };

  const dateRaw = asString(extractedIn.date, 32);
  const timeRaw = asString(extractedIn.time, 8);
  const nameRaw = asString(extractedIn.customerName, 80);
  const phoneRaw = asString(extractedIn.phone, 32);

  const extracted = {
    date: dateRaw && isIsoDate(dateRaw) ? dateRaw : null,
    time: timeRaw && isHHmm(timeRaw) ? timeRaw : null,
    customerName: nameRaw,
    phone: phoneRaw ? normalizePhone(phoneRaw) : null,
  };

  const nextExpectedSlot = (raw.nextExpectedSlot ?? null) as LlmNextSlot;
  if (!NEXT_SLOTS.has(nextExpectedSlot)) return { ok: false, reason: 'bad_next_slot' };

  const usesDraftContext = raw.usesDraftContext;
  const switchedAwayFromDraftService = raw.switchedAwayFromDraftService;
  const needsClarification = raw.needsClarification;
  if (
    typeof usesDraftContext !== 'boolean' ||
    typeof switchedAwayFromDraftService !== 'boolean' ||
    typeof needsClarification !== 'boolean'
  ) {
    return { ok: false, reason: 'bad_boolean' };
  }

  const clarificationReason = asString(raw.clarificationReason, 500);
  const serviceMention = asString(raw.serviceMention, 200);

  const value: LlmPlannerOutput = {
    schemaVersion: 1,
    intent,
    replyText: raw.replyText,
    serviceMention,
    extracted,
    usesDraftContext,
    switchedAwayFromDraftService,
    needsClarification,
    clarificationReason: needsClarification ? clarificationReason : null,
    nextExpectedSlot,
  };

  return { ok: true, value };
}

/** node -e "const v=require('./dist/llm-validate.js'); const r=v.verifyLlmValidationRegression(); console.log(r); process.exit(r.ok?0:1);" */
export function verifyLlmValidationRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  if (validateLlmPlannerJson(null).ok) failures.push('null should fail');
  if (validateLlmPlannerJson({}).ok) failures.push('empty should fail');

  const minimal = {
    schemaVersion: 1,
    intent: 'PRICE',
    replyText: 'test',
    serviceMention: 'HIFU',
    extracted: { date: null, time: null, customerName: null, phone: null },
    usesDraftContext: false,
    switchedAwayFromDraftService: false,
    needsClarification: false,
    clarificationReason: null,
    nextExpectedSlot: null,
  };
  if (!validateLlmPlannerJson(minimal).ok) failures.push('minimal valid object should pass');

  const badIntent = { ...minimal, intent: 'INVALID' };
  if (validateLlmPlannerJson(badIntent).ok) failures.push('bad intent should fail');

  const badDate = { ...minimal, extracted: { ...minimal.extracted, date: 'not-a-date' } };
  const vd = validateLlmPlannerJson(badDate);
  if (!vd.ok || vd.value.extracted.date !== null) failures.push('invalid date string should become null');

  const rawJson = '{"schemaVersion":1,"intent":"INQUIRY","replyText":"hi","serviceMention":null,"extracted":{"date":null,"time":null,"customerName":null,"phone":null},"usesDraftContext":true,"switchedAwayFromDraftService":false,"needsClarification":false,"clarificationReason":null,"nextExpectedSlot":null}';
  const p = parseLlmJson('prefix ' + rawJson + ' tail');
  if (!p.ok) failures.push('parseLlmJson should extract object');
  else if (!validateLlmPlannerJson(p.parsed).ok) failures.push('parsed should validate');

  return { ok: failures.length === 0, failures };
}

export function parseLlmJson(content: string): { ok: true; parsed: unknown } | { ok: false } {
  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false };
  try {
    return { ok: true, parsed: JSON.parse(trimmed.slice(start, end + 1)) };
  } catch {
    return { ok: false };
  }
}
