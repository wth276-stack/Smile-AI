/**
 * Deterministic date/time extraction for thin-core-v1 booking.
 * Uses THIN_CORE_V1_TZ (default Asia/Hong_Kong) for weekday-relative phrases.
 * Prefer these values over LLM bookingSlots when they conflict.
 */

import type { BookingDraft } from '../types';
import { extractSlotsWithReferenceDate, type SlotExtraction } from '../booking-state';

export interface ThinDeterministicApplyResult {
  draft: BookingDraft;
  /** User hinted at a relative date but parser found none — slot incomplete for booking */
  dateAmbiguous: boolean;
}

function getHkCalendarYmd(now: Date): { y: number; m: number; d: number } {
  const tz = process.env.THIN_CORE_V1_TZ?.trim() || 'Asia/Hong_Kong';
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);
  return { y, m, d };
}

/** Noon on the given HK civil date as UTC instant (HK has no DST). */
function hkYmdToUtcNoon(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
}

/**
 * Reference `Date` for booking-state extractors so weekday math matches HK "today".
 */
export function getThinBookingReferenceDate(now: Date = new Date()): Date {
  const { y, m, d } = getHkCalendarYmd(now);
  return hkYmdToUtcNoon(y, m, d);
}

/**
 * Extra time patterns (下晝, 夜晚, 聽日7點, weekday+7點 in booking context).
 */
function extractThinExtraTime(msg: string): string | null {
  // 下晝 N點
  const ha = msg.match(/(?:下晝)\s*(\d{1,2})\s*[點時](\d{1,2})?/);
  if (ha) {
    let hour = parseInt(ha[1], 10);
    const minute = ha[2] ? parseInt(ha[2], 10) : msg.includes('半') ? 30 : 0;
    if (hour >= 1 && hour <= 11) hour += 12;
    if (hour >= 0 && hour <= 23)
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // 夜晚 / 晚上 / 晚 + N點
  const night = msg.match(/(?:夜晚|晚上|晚)\s*(\d{1,2})\s*[點時](\d{1,2})?/);
  if (night) {
    let hour = parseInt(night[1], 10);
    const minute = night[2] ? parseInt(night[2], 10) : msg.includes('半') ? 30 : 0;
    if (hour >= 1 && hour <= 11) hour += 12;
    if (hour >= 0 && hour <= 23)
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  // 聽日/明日/明天 + bare N點 → default to PM-style 12h in many booking contexts (e.g. appointments)
  if (/(?:聽日|明日|明天)/.test(msg)) {
    const bare = msg.match(/(\d{1,2})\s*[點時](\d{1,2})?/);
    if (bare && !/(?:上午|早上|凌晨|中午|下午|下晝|晚上|夜晚|晚|今晚)/.test(msg)) {
      let hour = parseInt(bare[1], 10);
      const minute = bare[2] ? parseInt(bare[2], 10) : msg.includes('半') ? 30 : 0;
      if (hour >= 1 && hour <= 11) hour += 12;
      if (hour >= 13 && hour <= 23)
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  // 星期/禮拜 + ... + bare N點 (booking context) → evening
  if (/(?:約|預約|book|訂位)/i.test(msg) && /(?:星期|禮拜|週)/.test(msg)) {
    const bare = msg.match(/(\d{1,2})\s*[點時](\d{1,2})?/);
    if (bare && !/(?:上午|早上|凌晨|中午|下午|下晝|晚上|夜晚|晚|今晚)/.test(msg)) {
      let hour = parseInt(bare[1], 10);
      const minute = bare[2] ? parseInt(bare[2], 10) : msg.includes('半') ? 30 : 0;
      if (hour >= 1 && hour <= 11) hour += 12;
      if (hour >= 13 && hour <= 23)
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Apply deterministic date/time from the latest user message; overrides LLM when both exist.
 */
export function applyDeterministicDateTimeToDraft(draft: BookingDraft, msg: string): ThinDeterministicApplyResult {
  const ref = getThinBookingReferenceDate();
  const code: SlotExtraction = extractSlotsWithReferenceDate(msg, ref);
  const extraTime = extractThinExtraTime(msg);

  const next = { ...draft };
  if (code.date) {
    next.date = code.date;
  }
  const timePick = extraTime ?? code.time;
  if (timePick) {
    next.time = timePick;
  }

  const hintsDate =
    /聽日|明日|明天|今日|今天|後天|星期|禮拜|週|\d{1,2}月\d{1,2}/.test(msg);
  const dateAmbiguous = hintsDate && !code.date;

  return { draft: next, dateAmbiguous };
}
