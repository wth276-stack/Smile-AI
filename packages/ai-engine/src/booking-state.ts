import type { BookingDraft } from './types';

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
  return extractSlotsWithReferenceDate(msg, new Date());
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

export function isBookingComplete(draft: BookingDraft): boolean {
  return getMissingSlots(draft).length === 0;
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseYmd(ymd: string): Date {
  const [y, m, day] = ymd.split('-').map(Number);
  return startOfDay(new Date(y, m - 1, day));
}

function resolveZhMonthDay(month: number, day: number, ref: Date): string {
  let y = ref.getFullYear();
  let candidate = startOfDay(new Date(y, month - 1, day));
  const refDay = startOfDay(ref);
  if (candidate < refDay) {
    y += 1;
    candidate = startOfDay(new Date(y, month - 1, day));
  }
  return formatDate(candidate);
}

function ensureDateNotBeforeRef(ymd: string, ref: Date): string | null {
  if (parseYmd(ymd) < startOfDay(ref)) return null;
  return ymd;
}

// ── Date extraction ───────────────────────────────────────────────────────────

function extractDate(msg: string, ref: Date): string | null {
  let out: string | null = null;

  // Match today/tomorrow/day after keywords
  // Added "今日" (Cantonese) alongside "今天" (Mandarin)
  if (/今天|今日|today|今晚/i.test(msg)) {
    out = formatDate(startOfDay(ref));
  } else if (/明天|明日|聽日|tomorrow/i.test(msg)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 1);
    out = formatDate(startOfDay(d));
  } else if (/後天|后天/i.test(msg)) {
    const d = new Date(ref);
    d.setDate(d.getDate() + 2);
    out = formatDate(startOfDay(d));
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
  const now = new Date(ref);
  const currentDay = now.getDay();
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

  const result = new Date(now);
  result.setDate(result.getDate() + daysAhead);
  return formatDate(startOfDay(result));
}

// ── Time extraction ───────────────────────────────────────────────────────────

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

  const zhBare = msg.match(/(\d{1,2})[點:時]半?(\d{1,2})?/);
  if (zhBare) {
    const hour = parseInt(zhBare[1], 10);
    const hasHalf = msg.includes('半');
    const minute = hasHalf ? 30 : zhBare[2] ? parseInt(zhBare[2], 10) : 0;
    if (hour >= 13 && hour <= 23)
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (hour === 12)
      return `12:${String(minute).padStart(2, '0')}`;
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

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatTimeDisplay(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h < 12 ? '上午' : '下午';
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${period}${dh}:${String(m).padStart(2, '0')}`;
}

export function formatDateDisplay(date: string, ref: Date = new Date()): string {
  const today = formatDate(startOfDay(ref));
  const tmr = new Date(ref);
  tmr.setDate(tmr.getDate() + 1);
  const tomorrowStr = formatDate(startOfDay(tmr));
  const dayAfter = new Date(ref);
  dayAfter.setDate(dayAfter.getDate() + 2);
  const dayAfterStr = formatDate(startOfDay(dayAfter));

  if (date === today) return '今天';
  if (date === tomorrowStr) return '明天';
  if (date === dayAfterStr) return '後天';

  const [, month, day] = date.split('-').map(Number);
  const dateObj = new Date(parseInt(date.split('-')[0], 10), month - 1, day);
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const weekday = weekdays[dateObj.getDay()];
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

  expectTime('bare 7點 ambiguous', '明天7點', null);
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
