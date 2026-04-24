/**
 * time-ambiguity.ts
 *
 * Candidate-based resolution for bare Chinese hour expressions (e.g. `7點`)
 * that lack explicit meridiem markers. Instead of collapsing to a single
 * interpretation upfront, we generate AM+PM candidates and resolve against
 * tenant business-hours windows for the target date.
 *
 * This module is consumed by v2/engine.ts AFTER slot merge and BEFORE the
 * slot-availability gate, so it only affects the V2 booking path.
 */

import { parseBusinessHoursToWeekly, getJsWeekday0SunInTimeZone, type DayWindows } from './booking-slot-availability';

// ── Detection ────────────────────────────────────────────────────────────────

const MERIDIEM_MARKERS = /上午|下午|早上|晚上|下晝|夜晚|凌晨|中午|今晚|am|pm/i;

const BARE_HOUR_RE = /(\d{1,2})[點時]半?(\d{1,2})?/;

/**
 * Returns true when the user message contains a bare hour (1–11 點)
 * without any meridiem marker — i.e. the time is genuinely ambiguous.
 */
export function hasAmbiguousBareHour(msg: string): boolean {
  if (MERIDIEM_MARKERS.test(msg)) return false;
  if (/\d{1,2}:\d{2}/.test(msg)) return false;
  if (/\d{1,2}\s*(am|pm)\b/i.test(msg)) return false;
  const m = BARE_HOUR_RE.exec(msg);
  if (!m) return false;
  const h = parseInt(m[1], 10);
  return h >= 1 && h <= 11;
}

export interface BareHourCandidates {
  amTime: string;
  pmTime: string;
  bareHour: number;
  minute: number;
}

/**
 * Extract the bare hour and produce two candidate HH:mm strings.
 * Returns null when the message is not ambiguous (has markers, 24h, etc.).
 */
export function extractBareHourCandidates(msg: string): BareHourCandidates | null {
  if (!hasAmbiguousBareHour(msg)) return null;
  const m = BARE_HOUR_RE.exec(msg);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const hasHalf = msg.includes('半');
  const minute = hasHalf ? 30 : (m[2] ? parseInt(m[2], 10) : 0);
  if (minute < 0 || minute > 59) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    amTime: `${pad(hour)}:${pad(minute)}`,
    pmTime: `${pad(hour + 12)}:${pad(minute)}`,
    bareHour: hour,
    minute,
  };
}

// ── Resolution ───────────────────────────────────────────────────────────────

export type AmbiguousTimeResolution =
  | { outcome: 'resolved'; time: string; explanation: string }
  | { outcome: 'clarify'; amTime: string; pmTime: string; explanation: string }
  | { outcome: 'none_valid'; amTime: string; pmTime: string; explanation: string };

function parseTimeToMin(hm: string): number {
  const [h, mm] = hm.split(':').map((x) => parseInt(x, 10));
  return h * 60 + mm;
}

function timeInWindow(tMin: number, day: DayWindows): boolean {
  if (day === 'closed' || day === null) return false;
  for (const w of day) {
    if (tMin >= w.startMin && tMin < w.endMin) return true;
  }
  return false;
}

function resolveDayWindow(weekly: DayWindows[], wIdx: number, hasAny: boolean): DayWindows {
  const raw = weekly[wIdx] ?? null;
  if (raw === null) {
    if (hasAny) return 'closed';
    return [{ startMin: 0, endMin: 24 * 60 }];
  }
  return raw;
}

/**
 * Given a date (YYYY-MM-DD), two candidate times, and tenant business-hours,
 * determine which (if any) is valid and return a resolution.
 */
export function resolveAmbiguousTime(
  dateYmd: string,
  candidates: BareHourCandidates,
  businessHours: unknown,
  timeZone: string,
): AmbiguousTimeResolution {
  const { weekly, hasAny } = parseBusinessHoursToWeekly(businessHours);
  if (!hasAny) {
    return { outcome: 'clarify', amTime: candidates.amTime, pmTime: candidates.pmTime, explanation: '冇營業時間資料，需要確認上午定下午。' };
  }

  const wIdx = getJsWeekday0SunInTimeZone(dateYmd, timeZone);
  const day = resolveDayWindow(weekly, wIdx, hasAny);
  if (day === 'closed') {
    return { outcome: 'none_valid', amTime: candidates.amTime, pmTime: candidates.pmTime, explanation: '該日為休息日。' };
  }

  const amMin = parseTimeToMin(candidates.amTime);
  const pmMin = parseTimeToMin(candidates.pmTime);
  const amValid = timeInWindow(amMin, day);
  const pmValid = timeInWindow(pmMin, day);

  if (amValid && pmValid) {
    return { outcome: 'clarify', amTime: candidates.amTime, pmTime: candidates.pmTime, explanation: '兩個時段都喺營業時間內，需要確認上午定下午。' };
  }
  if (amValid && !pmValid) {
    return { outcome: 'resolved', time: candidates.amTime, explanation: `只有上午 ${candidates.bareHour} 點喺營業時間內。` };
  }
  if (!amValid && pmValid) {
    return { outcome: 'resolved', time: candidates.pmTime, explanation: `只有下午/晚上 ${candidates.bareHour} 點（${candidates.pmTime}）喺營業時間內。` };
  }

  return { outcome: 'none_valid', amTime: candidates.amTime, pmTime: candidates.pmTime, explanation: '兩個時段都唔喺營業時間內。' };
}

// ── Convenience: first valid window start for a day ─────────────────────────

/**
 * Return the earliest HH:mm window start for a given weekday, or null if closed.
 */
export function firstValidWindowStart(
  businessHours: unknown,
  dateYmd: string,
  timeZone: string,
): string | null {
  const { weekly, hasAny } = parseBusinessHoursToWeekly(businessHours);
  if (!hasAny) return null;
  const wIdx = getJsWeekday0SunInTimeZone(dateYmd, timeZone);
  const day = resolveDayWindow(weekly, wIdx, hasAny);
  if (day === 'closed' || day === null || !Array.isArray(day) || day.length === 0) return null;
  const earliest = day.reduce((a, b) => (a.startMin < b.startMin ? a : b));
  const h = Math.floor(earliest.startMin / 60);
  const m = earliest.startMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
