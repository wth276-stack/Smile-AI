import type { BookingDraft } from './types';
import {
  addCalendarDaysHKT,
  formatDateHKYmd,
  getHKTJsWeekday,
  getHKTToday,
} from './v2/date-utils';

// ── Slot extraction result (from a single message) ──

export interface SlotExtraction {
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
}

// ── Extended draft with confirmation state ───────────────────────────────────

export interface BookingDraftState extends BookingDraft {
  confirmationPending: boolean;
  conversationMode: string;
}

// ── Draft management ─────────────────────────────────────────────────────────

export function emptyDraft(): BookingDraft {
  return {
    bookingId: null,
    mode: null,
    serviceName: null,
    serviceDisplayName: null,
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };
}

export function emptyDraftState(): BookingDraftState {
  return {
    ...emptyDraft(),
    confirmationPending: false,
    conversationMode: 'GREETING',
  };
}

/**
 * Full reset after booking is submitted.
 * Clears all fields including confirmation state.
 */
export function resetDraftAfterBooking(): BookingDraftState {
  return {
    ...emptyDraft(),
    confirmationPending: false,
    conversationMode: 'POST_BOOKING',
  };
}

export function extractSlots(msg: string): SlotExtraction {
  return extractSlotsWithReferenceDate(msg, getHKTToday());
}

/** Use fixed `ref` for tests; production should use `extractSlots(msg)`. */
export function extractSlotsWithReferenceDate(msg: string, ref: Date): SlotExtraction {
  return {
    date: extractDate(msg, ref),
    time: extractTime(msg),
    customerName: extractCustomerName(msg),
    phone: extractPhone(msg),
  };
}

export function mergeSlots(draft: BookingDraft, extraction: SlotExtraction): BookingDraft {
  return {
    serviceName: draft.serviceName,
    serviceDisplayName: draft.serviceDisplayName,
    date: extraction.date ?? draft.date,
    time: extraction.time ?? draft.time,
    customerName: extraction.customerName ?? draft.customerName,
    phone: extraction.phone ?? draft.phone,
  };
}

export function getMissingSlots(draft: BookingDraft): (keyof BookingDraft)[] {
  const required: (keyof BookingDraft)[] = ['serviceName', 'date', 'time', 'customerName', 'phone'];
  return required.filter((k) => !draft[k]);
}

/** True when all booking slots needed for confirmation are present (service = code or display). */
export function bookingDraftHasAllRequiredSlots(draft: BookingDraft): boolean {
  const hasService = !!(draft.serviceName?.trim() || draft.serviceDisplayName?.trim());
  return (
    hasService &&
    !!draft.date &&
    !!draft.time &&
    !!draft.customerName?.trim() &&
    !!draft.phone?.trim()
  );
}

/**
 * Provisional `customerName` from confirmed booking(s) in system state — not from channel profile.
 * If draft already has a name (user or prior turn), that wins.
 */
export function provisionalCustomerNameFromExistingBookings(
  draft: Pick<BookingDraft, 'bookingId' | 'customerName'>,
  existing:
    | Array<{ id: string; customerName?: string | null }>
    | undefined
    | null,
): string | null {
  if (draft.customerName?.trim()) return draft.customerName.trim();
  if (!existing?.length) return null;
  if (draft.bookingId) {
    const m = existing.find((b) => b.id === draft.bookingId);
    if (m?.customerName?.trim()) return m.customerName.trim();
  }
  if (existing.length === 1) return existing[0]!.customerName?.trim() ?? null;
  return null;
}

/** Which required slots are still missing (service satisfied by code or display name). */
export function getMissingBookingSlots(draft: BookingDraft): string[] {
  const missing: string[] = [];
  if (!draft.serviceName?.trim() && !draft.serviceDisplayName?.trim()) missing.push('serviceName');
  if (!draft.date) missing.push('date');
  if (!draft.time) missing.push('time');
  if (!draft.customerName?.trim()) missing.push('customerName');
  if (!draft.phone?.trim()) missing.push('phone');
  return missing;
}

export function isBookingComplete(draft: BookingDraft): boolean {
  return getMissingSlots(draft).length === 0;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function resolveZhMonthDay(month: number, day: number, ref: Date): string {
  const refYmd = formatDateHKYmd(ref);
  const refYear = parseInt(refYmd.slice(0, 4), 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  let y = refYear;
  let candidate = `${y}-${pad(month)}-${pad(day)}`;
  if (candidate < refYmd) {
    y += 1;
    candidate = `${y}-${pad(month)}-${pad(day)}`;
  }
  return candidate;
}

function ensureDateNotBeforeRef(ymd: string, ref: Date): string | null {
  if (ymd < formatDateHKYmd(ref)) return null;
  return ymd;
}

// ── Date extraction ───────────────────────────────────────────────────────────

function extractDate(msg: string, ref: Date): string | null {
  let out: string | null = null;

  const refYmd = formatDateHKYmd(ref);
  // Match today/tomorrow/day after keywords
  // Added "今日" (Cantonese) alongside "今天" (Mandarin)
  if (/今天|今日|today|今晚/i.test(msg)) {
    out = refYmd;
  } else if (/明天|明日|聽日|tomorrow/i.test(msg)) {
    out = addCalendarDaysHKT(refYmd, 1);
  } else if (/大後日|大后日/.test(msg)) {
    out = addCalendarDaysHKT(refYmd, 3);
  } else if (/後天|后天/i.test(msg)) {
    out = addCalendarDaysHKT(refYmd, 2);
  } else {
    const weekdayDate = parseWeekdayReference(msg, ref);
    if (weekdayDate) {
      out = weekdayDate;
    } else {
      const zhDate = msg.match(/(\d{1,2})月(\d{1,2})[日號号]?/);
      if (zhDate) {
        const m = parseInt(zhDate[1], 10);
        const day = parseInt(zhDate[2], 10);
        out = resolveZhMonthDay(m, day, ref);
      } else {
        out = extractBareDayHao(msg, ref);
      }
    }
  }

  if (!out) return null;
  return ensureDateNotBeforeRef(out, ref);
}

function parseWeekdayReference(msg: string, ref: Date): string | null {
  const dayMap: Record<string, number> = {
    '日': 0, '天': 0, '一': 1, '二': 2,
    '三': 3, '四': 4, '五': 5, '六': 6,
  };

  const nextWeekMatch = msg.match(/下[個]?(?:星期|週|周|禮拜)([\u4e00-\u9fff])/);
  if (nextWeekMatch) {
    const targetDay = dayMap[nextWeekMatch[1]];
    if (targetDay !== undefined) return getNextWeekday(targetDay, true, ref);
  }

  const thisWeekMatch = msg.match(/(?:這|今|呢)[個]?(?:星期|週|周|禮拜)([\u4e00-\u9fff])/);
  if (thisWeekMatch) {
    const targetDay = dayMap[thisWeekMatch[1]];
    if (targetDay !== undefined) return getNextWeekday(targetDay, false, ref);
  }

  const plainMatch = msg.match(/(?:星期|週|周|禮拜)([\u4e00-\u9fff])/);
  if (plainMatch) {
    const targetDay = dayMap[plainMatch[1]];
    if (targetDay !== undefined) return getNextWeekday(targetDay, false, ref);
  }

  return null;
}

function getNextWeekday(targetDay: number, forceNextWeek: boolean, ref: Date): string {
  const refYmd = formatDateHKYmd(ref);
  const currentDay = getHKTJsWeekday(ref);
  let daysAhead: number;

  if (forceNextWeek) {
    let daysToNextMonday = (1 - currentDay + 7) % 7;
    if (daysToNextMonday === 0) daysToNextMonday = 7;
    const offset = targetDay === 0 ? 6 : targetDay - 1;
    daysAhead = daysToNextMonday + offset;
  } else {
    daysAhead = (targetDay - currentDay + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
  }

  return addCalendarDaysHKT(refYmd, daysAhead);
}

/**
 * Day-only references like 9號 / 9号 / 9日 (no month). Same month as `ref` if that
 * calendar day is still >= ref; otherwise next month, mirroring v2 `resolveRelativeDates`.
 */
function extractBareDayHao(msg: string, ref: Date): string | null {
  const m = /(\d{1,2})[號号日]/.exec(msg);
  if (!m) return null;
  const dayNum = parseInt(m[1], 10);
  if (dayNum < 1 || dayNum > 31) return null;
  const refYmd = formatDateHKYmd(ref);
  const [y, mon] = refYmd.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');

  const ymdInMonth = (yy: number, month: number, day: number): string | null => {
    const t = new Date(Date.UTC(yy, month - 1, day));
    if (t.getUTCDate() !== day) return null;
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  };

  let ymd = ymdInMonth(y, mon, dayNum);
  if (!ymd) return null;
  if (ymd < refYmd) {
    const nextY = mon === 12 ? y + 1 : y;
    const nextM = mon === 12 ? 1 : mon + 1;
    ymd = ymdInMonth(nextY, nextM, dayNum) ?? null;
  }
  if (!ymd || ymd < refYmd) return null;
  return ymd;
}

// ── Time extraction ───────────────────────────────────────────────────────────

/** Last match wins (e.g. "三點改五點" → 17:00). Handles 十點 / 十一點 / 三點半 (no Arabic digits). */
function extractZhNumeralHourTime(msg: string): string | null {
  const re = /(十二|十一|十|兩|一|二|三|四|五|六|七|八|九)點(半)?/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(msg)) !== null) last = m;
  if (!last) return null;
  const tok = last[1];
  const half = !!last[2];
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12,
  };
  const hour = map[tok];
  if (hour === undefined || hour < 0 || hour > 23) return null;
  const minute = half ? 30 : 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function extractTime(msg: string): string | null {
  const enMatch = msg.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (enMatch) {
    let hour = parseInt(enMatch[1], 10);
    const minute = enMatch[2] ? parseInt(enMatch[2], 10) : 0;
    if (enMatch[3].toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (enMatch[3].toLowerCase() === 'am' && hour === 12) hour = 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // 24-hour format with colon: 15:00
  const h24 = msg.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24) {
    const hour = parseInt(h24[1], 10);
    const minute = parseInt(h24[2], 10);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // 4-digit time without colon: 1500, 0930
  const h24NoColon = msg.match(/\b([01]?\d|2[0-3])([0-5]\d)\b/);
  if (h24NoColon) {
    const hour = parseInt(h24NoColon[1], 10);
    const minute = parseInt(h24NoColon[2], 10);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const zhMatch = msg.match(/(上午|下午|早上|晚上|中午|凌晨|今晚)(\d{1,2})[點:時]半?(\d{1,2})?/);
  if (zhMatch) {
    let hour = parseInt(zhMatch[2], 10);
    const hasHalf = msg.includes('半');
    const minute = hasHalf ? 30 : zhMatch[3] ? parseInt(zhMatch[3], 10) : 0;
    const period = zhMatch[1];
    if (period === '下午' || period === '晚上' || period === '今晚') { if (hour < 12) hour += 12; }
    else if (period === '上午' || period === '早上') { if (hour === 12) hour = 0; }
    else if (period === '凌晨') { if (hour === 12) hour = 0; }
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59)
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const zhNumeral = extractZhNumeralHourTime(msg);
  if (zhNumeral) return zhNumeral;

  const zhBare = msg.match(/(\d{1,2})[點:時]半?(\d{1,2})?/);
  if (zhBare) {
    const hour = parseInt(zhBare[1], 10);
    const hasHalf = msg.includes('半');
    const minute = hasHalf ? 30 : zhBare[2] ? parseInt(zhBare[2], 10) : 0;
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      if (hour >= 13 && hour <= 23)
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      if (hour === 12)
        return `12:${String(minute).padStart(2, '0')}`;
      // Morning-style bare hours 1–11 點 (e.g. 9號11點 → 11:00)
      if (hour >= 1 && hour <= 11)
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  return null;
}

// ── Name extraction ───────────────────────────────────────────────────────────

const NAME_STOP_BEFORE =
  /(?:電話|手機|whatsapp|whats\s*app|聯絡|聯繫|contact|tel\.?|mobile|\d{8,11})/i;

function takeLeadingPersonalName(slice: string): string | null {
  const s = slice.trim().replace(/[，,。．]+$/g, '').trim();
  if (!s) return null;
  if (/^[a-zA-Z]/.test(s)) {
    const m = s.match(/^([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\b/);
    if (m && m[1].trim().length >= 2) return m[1].trim();
    if (m && m[1].trim().length === 1) return null;
  }
  const zh = s.match(/^([\u4e00-\u9fff]{1,10})/);
  return zh ? zh[1] : null;
}

function extractCustomerName(msg: string): string | null {
  /** "Gigi，星期日十點" — leading Latin / common display name before comma */
  const leadComma = msg.match(
    /^\s*([a-zA-Z][a-zA-Z'’.\-]*(?:\s+[a-zA-Z][a-zA-Z'’.\-]*)*)\s*[，,]\s*/,
  );
  if (leadComma) {
    const n = leadComma[1]!.trim();
    if (n.length >= 2) return n;
  }

  const m = msg.match(/我(叫|係|是|姓)\s*/);
  if (m && m.index !== undefined) {
    const from = m.index + m[0].length;
    let tail = msg.slice(from);
    const stopIdx = tail.search(NAME_STOP_BEFORE);
    if (stopIdx >= 0) tail = tail.slice(0, stopIdx);
    const name = takeLeadingPersonalName(tail);
    if (name) return name;
  }

  const m2 = msg.match(/(?:name|名)\s*(?:is|係|:)\s*/i);
  if (m2 && m2.index !== undefined) {
    const from = m2.index + m2[0].length;
    let tail = msg.slice(from);
    const stopIdx = tail.search(NAME_STOP_BEFORE);
    if (stopIdx >= 0) tail = tail.slice(0, stopIdx);
    const name = takeLeadingPersonalName(tail);
    if (name) return name;
  }

  return null;
}

// ── Phone extraction ──────────────────────────────────────────────────────────

/**
 * HK phone validation: 8 digits, typically starting with 2, 3, 5, 6, 7, 8, 9.
 * We accept any 8-digit number for flexibility, but validate length.
 */
const HK_PHONE_PATTERN = /\b([2-9]\d{7})\b/;

function extractPhone(msg: string): string | null {
  // Prefer HK format: 8 digits starting with 2-9
  const hkMatch = msg.match(HK_PHONE_PATTERN);
  if (hkMatch) return hkMatch[1];

  // Fallback: any 8-11 digit number (for international numbers)
  const m = msg.match(/(\d{8,11})/);
  return m ? m[1] : null;
}

/**
 * Validate if phone is a valid HK mobile number.
 * HK mobile: 8 digits starting with 5, 6, 7, 8, or 9.
 */
export function isValidHkPhone(phone: string | null): boolean {
  if (!phone) return false;
  return /^[5-9]\d{7}$/.test(phone);
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function formatTimeDisplay(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? '上午' : '下午';
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${period}${dh}:${String(m).padStart(2, '0')}`;
}

export function formatDateDisplay(date: string, ref: Date = getHKTToday()): string {
  const today = formatDateHKYmd(ref);
  const tomorrowStr = addCalendarDaysHKT(today, 1);
  const dayAfterStr = addCalendarDaysHKT(today, 2);

  if (date === today) return '今天';
  if (date === tomorrowStr) return '明天';
  if (date === dayAfterStr) return '後天';

  const [, month, day] = date.split('-').map(Number);
  const noon = new Date(`${date}T12:00:00+08:00`);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdays[getHKTJsWeekday(noon)];
  return `${month}月${day}日（星期${weekday}）`;
}

export function buildBookingDateTime(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

// ── Regression tests ──────────────────────────────────────────────────────────

export function verifyBookingDateTimeRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const ref = new Date(2026, 2, 19, 15, 0, 0);

  function expectTime(label: string, msg: string, want: string | null): void {
    const got = extractTime(msg);
    if (got !== want)
      failures.push(`${label}: time extract ${JSON.stringify(msg)} => ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }

  function expectDate(label: string, msg: string, want: string | null): void {
    const got = extractDate(msg, ref);
    if (got !== want)
      failures.push(`${label}: date extract ${JSON.stringify(msg)} => ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }

  // Bare 1–11 點 are valid (e.g. book 9號11點); 7點 here resolves to 07:00.
  expectTime('明天7點 bare', '明天7點', '07:00');
  {
    const ex = extractSlotsWithReferenceDate(
      '我想 book 9號11點參加活動',
      new Date('2026-04-01T12:00:00+08:00')
    );
    if (ex.date !== '2026-04-09' || ex.time !== '11:00') {
      failures.push(
        `9號11點 slots: want date 2026-04-09 / time 11:00, got ${JSON.stringify(ex)}`
      );
    }
  }
  expectTime('晚上7點', '晚上7點', '19:00');
  expectTime('早上7點', '早上7點', '07:00');
  expectTime('7:30pm', '7:30pm', '19:30');
  expectTime('19:30', 'see you 19:30 ok', '19:30');

  expectDate('tomorrow', '明天', '2026-03-20');
  expectDate('聽日', '聽日', '2026-03-20');
  expectDate('後天', '後天', '2026-03-21');
  expectDate('星期三', '星期三', '2026-03-25');
  expectDate('下星期三', '下星期三', '2026-03-25');

  // Reset test
  const reset = resetDraftAfterBooking();
  if (reset.serviceName !== null) failures.push('resetDraft: serviceName should be null');
  if (reset.confirmationPending !== false) failures.push('resetDraft: confirmationPending should be false');
  if (reset.conversationMode !== 'POST_BOOKING') failures.push('resetDraft: mode should be POST_BOOKING');

  return { ok: failures.length === 0, failures };
}
