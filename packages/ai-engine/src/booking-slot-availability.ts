/**
 * Generic, industry-agnostic hard gate for "can this slot be presented as confirmable?".
 * Prefers blocking over silently confirming a rule-breaking slot. Future calendar integration: optional hook.
 */
import { getHKTJsWeekday } from './v2/date-utils';
import { buildBookingDateTime } from './booking-state';

/** en-CA YYYY-MM-DD for `d` in `timeZone` (not host-local). */
function formatYmdInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Find a timestamp whose calendar date in `timeZone` equals `ymd` (YYYY-MM-DD). */
function findRepresentativeInstantForYmd(ymd: string, timeZone: string): Date {
  const [Y, M, D] = ymd.split('-').map(Number);
  if (!Y || !M || !D) return new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const start = Date.UTC(Y, M - 1, D, 0, 0, 0) - 12 * 3600 * 1000;
  for (let t = start; t < start + 72 * 3600 * 1000; t += 3600 * 1000) {
    const d = new Date(t);
    if (fmt.format(d) === ymd) return d;
  }
  return new Date(`${ymd}T12:00:00+08:00`);
}

/** JS weekday 0=Sun … 6=Sat for calendar `ymd` in IANA `timeZone`. */
export function getJsWeekday0SunInTimeZone(ymd: string, timeZone: string): number {
  const d = findRepresentativeInstantForYmd(ymd, timeZone);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).formatToParts(d);
  const w = parts.find((p) => p.type === 'weekday')?.value;
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return w !== undefined && w in map ? map[w]! : getHKTJsWeekday(d);
}

function addCalendarDaysGregorian(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

const WEEK_KEYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export interface BookingPolicyInput {
  minLeadHours?: number;
  allowSameDay?: boolean;
  sameDayCutoffHour?: number;
  /** 0=Sun … 6=Sat, extra closed weekdays in addition to per-day "closed" in businessHours */
  extraClosedWeekdays?: number[];
  /** YYYY-MM-DD; blocked dates (e.g. public holidays) */
  blackoutDates?: string[];
  /** Opaque; reserved for e.g. per-service rules */
  serviceRestrictions?: Record<string, { closedWeekdays?: number[] }> | null;
}

/** Parsed weekly schedule: 7 elements [Sun..Sat], null = not configured; empty = closed. */
export type DayWindows = { startMin: number; endMin: number }[] | 'closed' | null;

export interface CalendarAvailabilityContext {
  dateYmd: string;
  timeHm: string;
  service: string | null;
  timeZone: string;
}

/**
 * When implemented, return true = slot is blocked by external calendar (e.g. double-booking).
 * Sync for now; async can be wrapped by callers.
 */
export type CalendarAvailabilityHook = (ctx: CalendarAvailabilityContext) => boolean;

export interface ValidateBookingSlotInput {
  date: string;
  time: string;
  service?: string | null;
  timeZone: string;
  businessHours: unknown;
  closedDays?: unknown;
  blackoutDates?: unknown;
  bookingPolicy?: BookingPolicyInput | null;
  calendarAvailability?: CalendarAvailabilityHook | null;
  now: Date;
}

export interface ValidateBookingSlotResult {
  allowed: boolean;
  reason: string;
  code:
    | 'ok'
    | 'no_config'
    | 'blackout'
    | 'closed_day'
    | 'outside_hours'
    | 'lead_time'
    | 'same_day'
    | 'service_rule'
    | 'calendar_conflict';
  suggestedAlternatives: string;
}

function parseTimeToMin(hm: string): number {
  const [h, m] = hm.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

function parseWindowSpec(spec: string): { startMin: number; endMin: number } | null {
  const s = spec.replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const a = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const b = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
  if (a >= b) return null;
  return { startMin: a, endMin: b };
}

/**
 * Map tenant JSON `businessHours` into per-weekday window lists. Supports:
 * { mon: "10:00-20:00", sun: "closed" | "closed" }
 * { mon: { open: "10:00", close: "20:00" } }
 * Unknown or missing key → `null` (treated as "no data for that day" → if whole row empty, no gate).
 */
export function parseBusinessHoursToWeekly(
  businessHours: unknown,
): { weekly: DayWindows[]; hasAny: boolean } {
  if (!businessHours || typeof businessHours !== 'object') {
    return { weekly: Array(7).fill(null) as DayWindows[], hasAny: false };
  }
  const weekly: DayWindows[] = Array(7).fill(null) as DayWindows[];
  let hasAny = false;
  const obj = businessHours as Record<string, unknown>;
  for (const [k0, v] of Object.entries(obj)) {
    const k = k0.toLowerCase().replace(/\s/g, '');
    const idx = WEEK_KEYS[k];
    if (idx === undefined) continue;
    if (v === 'closed' || v === 'CLOSED' || v === 'rest' || v === '休息' || v === 'none') {
      weekly[idx] = 'closed';
      hasAny = true;
      continue;
    }
    if (typeof v === 'string' && v.trim()) {
      const w = parseWindowSpec(v);
      if (w) {
        weekly[idx] = [w];
        hasAny = true;
      }
      continue;
    }
    if (v && typeof v === 'object' && 'open' in (v as object) && 'close' in (v as object)) {
      const o = v as { open: string; close: string };
      if (typeof o.open === 'string' && typeof o.close === 'string') {
        const w = parseWindowSpec(`${o.open}-${o.close}`);
        if (w) {
          weekly[idx] = [w];
          hasAny = true;
        }
      }
    }
  }
  return { weekly, hasAny };
}

function toBlackoutSet(raw: unknown): Set<string> {
  const s = new Set<string>();
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) s.add(x);
    }
  }
  return s;
}

function toClosedExtra(raw: unknown): Set<number> {
  const s = new Set<number>();
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (typeof x === 'number' && x >= 0 && x <= 6) s.add(x);
    }
  }
  return s;
}

function timeInAnyWindow(
  tMin: number,
  day: DayWindows,
): { ok: boolean; inHours: boolean } {
  if (day === 'closed' || day === null) {
    return { ok: false, inHours: false };
  }
  for (const w of day) {
    if (tMin >= w.startMin && tMin < w.endMin) {
      return { ok: true, inHours: true };
    }
  }
  return { ok: false, inHours: false };
}

/** Missing weekday in partial JSON while other keys exist → not open that day. */
function resolveDayWindow(weekly: DayWindows[], wIdx: number, hasAny: boolean): DayWindows {
  const raw = weekly[wIdx] ?? null;
  if (raw === null) {
    if (hasAny) return 'closed';
    return [{ startMin: 0, endMin: 24 * 60 }];
  }
  return raw;
}

function normalizeTimeHm(t: string): string {
  const p = t.trim().split(':');
  if (p.length < 2) return t;
  const h = Math.min(23, Math.max(0, parseInt(p[0]!, 10) || 0));
  const m = Math.min(59, Math.max(0, parseInt(p[1]!, 10) || 0));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Return the first valid window-start HH:mm for a given open day, or use `fallbackHour`
 * only if it falls inside a window. Never returns times outside business hours.
 */
function pickValidHourForDay(day: DayWindows, fallbackHour: number): string {
  if (day === 'closed' || day === null || !Array.isArray(day) || day.length === 0) return '10:00';
  const fallbackMin = fallbackHour * 60;
  for (const w of day) {
    if (fallbackMin >= w.startMin && fallbackMin < w.endMin) {
      return `${String(fallbackHour).padStart(2, '0')}:00`;
    }
  }
  const earliest = day.reduce((a, b) => (a.startMin < b.startMin ? a : b));
  const h = Math.floor(earliest.startMin / 60);
  const m = earliest.startMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Suggest next valid slots on upcoming business days. The suggested time is always
 * a valid hour (first window start), never blindly reusing the failed request hour.
 */
function buildAlternatives(
  weekly: DayWindows[],
  startYmd: string,
  timeZone: string,
  _seedHour: number,
): string {
  const alts: string[] = [];
  let y = startYmd;
  for (let step = 1; step <= 21 && alts.length < 2; step++) {
    y = addCalendarDaysGregorian(y, 1);
    const wIdx = getJsWeekday0SunInTimeZone(y, timeZone);
    const day = weekly[wIdx];
    if (day && day !== 'closed' && day !== null && day.length > 0) {
      const validTime = pickValidHourForDay(day, _seedHour);
      const dLabel = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(findRepresentativeInstantForYmd(y, timeZone));
      alts.push(`${dLabel} ${validTime}（營業日參考）`);
    }
  }
  if (alts.length === 0) {
    return '請揀一個在營業日、營業時間內嘅日期同時間，我可以再幫你對一對。';
  }
  return `可以試下：${alts.join(' 或 ')}（實際以店方確認為準）`;
}

/**
 * Public API: hard gate for booking / reschedule confirmation paths.
 */
export function validateBookingSlot(i: ValidateBookingSlotInput): ValidateBookingSlotResult {
  const { date, time, timeZone, now } = i;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
    return {
      allowed: true,
      reason: '',
      code: 'ok',
      suggestedAlternatives: '',
    };
  }

  const p = i.bookingPolicy ?? {};
  const { weekly, hasAny } = parseBusinessHoursToWeekly(i.businessHours);
  const black = toBlackoutSet(p.blackoutDates ?? i.blackoutDates);
  if (black.has(date)) {
    return {
      allowed: false,
      reason: '你揀咗呢日唔接受預約（假期／內部休息／店方不開放日）。',
      code: 'blackout',
      suggestedAlternatives: hasAny
        ? buildAlternatives(weekly, date, timeZone, 10)
        : '請揀其他日子再試。',
    };
  }

  if (!hasAny) {
    if (i.calendarAvailability) {
      const busy = i.calendarAvailability({
        dateYmd: date,
        timeHm: normalizeTimeHm(time),
        service: i.service ?? null,
        timeZone,
      });
      if (busy) {
        return {
          allowed: false,
          reason: '呢個時段喺日曆上唔可用，請揀第二個時段。',
          code: 'calendar_conflict',
          suggestedAlternatives: '',
        };
      }
    }
    return {
      allowed: true,
      reason: '',
      code: 'no_config',
      suggestedAlternatives: '',
    };
  }

  const timeNorm = normalizeTimeHm(time);
  let instant: Date;
  try {
    if (timeZone === 'Asia/Hong_Kong') {
      instant = new Date(`${date}T${timeNorm}:00+08:00`);
    } else {
      instant = buildBookingDateTime(date, timeNorm);
    }
  } catch {
    return { allowed: true, reason: '', code: 'ok', suggestedAlternatives: '' };
  }

  const wIdx = getJsWeekday0SunInTimeZone(date, timeZone);
  const extraClosed = toClosedExtra(p.extraClosedWeekdays ?? i.closedDays);
  if (extraClosed.has(wIdx)) {
    return {
      allowed: false,
      reason: '你揀咗呢日為店方不開放日。',
      code: 'closed_day',
      suggestedAlternatives: buildAlternatives(weekly, date, timeZone, parseInt(timeNorm.slice(0, 2), 10) || 10),
    };
  }

  if (i.service && p.serviceRestrictions && p.serviceRestrictions[i.service]?.closedWeekdays?.includes(wIdx)) {
    return {
      allowed: false,
      reason: '你揀咗呢個服務喺呢日唔能安排。',
      code: 'service_rule',
      suggestedAlternatives: '',
    };
  }

  const dayResolved = resolveDayWindow(weekly, wIdx, hasAny);
  const tMin = parseTimeToMin(timeNorm);
  if (Number.isNaN(tMin)) {
    return { allowed: true, reason: '', code: 'ok', suggestedAlternatives: '' };
  }

  const { ok } = timeInAnyWindow(tMin, dayResolved);
  if (!ok) {
    const code: ValidateBookingSlotResult['code'] =
      dayResolved === 'closed' ? 'closed_day' : 'outside_hours';
    return {
      allowed: false,
      reason:
        code === 'outside_hours'
          ? '你揀咗嘅時間唔喺可預約營業時間內，請揀返店方開放時間內嘅時段。'
          : '你揀咗嘅日子唔喺可預約日，請揀返營業日。',
      code,
      suggestedAlternatives: buildAlternatives(weekly, date, timeZone, Math.min(23, Math.max(0, (tMin / 60) | 0)) || 10),
    };
  }

  if (p.minLeadHours != null) {
    const diffH = (instant.getTime() - now.getTime()) / 3600000;
    if (diffH < p.minLeadHours) {
      return {
        allowed: false,
        reason: `需提前至少 ${p.minLeadHours} 小時預約。`,
        code: 'lead_time',
        suggestedAlternatives: '',
      };
    }
  }

  const todayYmd = formatYmdInTimeZone(now, timeZone);
  if (p.allowSameDay === false && date === todayYmd) {
    return {
      allowed: false,
      reason: '即日或同日預約暫不開放，請揀之後嘅日子。',
      code: 'same_day',
      suggestedAlternatives: '',
    };
  }
  if (p.sameDayCutoffHour != null && date === todayYmd) {
    const nowH = parseInt(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        hour12: false,
      })
        .formatToParts(now)
        .find((p) => p.type === 'hour')?.value ?? '0',
      10,
    );
    if (nowH >= p.sameDayCutoffHour) {
      return {
        allowed: false,
        reason: `即日預約已截單（店方政策：${p.sameDayCutoffHour}:00 前）請改揀之後日子。`,
        code: 'same_day',
        suggestedAlternatives: '',
      };
    }
  }

  if (i.calendarAvailability) {
    const busy = i.calendarAvailability({
      dateYmd: date,
      timeHm: timeNorm,
      service: i.service ?? null,
      timeZone,
    });
    if (busy) {
      return {
        allowed: false,
        reason: '呢個時段喺日曆上已被佔用或唔能安排，請揀第二個時段。',
        code: 'calendar_conflict',
        suggestedAlternatives: '',
      };
    }
  }

  return { allowed: true, reason: '', code: 'ok', suggestedAlternatives: '' };
}

export function buildSlotPolicyFromTenantSettings(
  settings: Record<string, unknown> | null | undefined,
): {
  timeZone: string;
  businessHours: unknown;
  closedDays: unknown;
  bookingPolicy: BookingPolicyInput;
} {
  const s = settings ?? {};
  const timeZone = typeof s.timezone === 'string' && s.timezone.trim() ? s.timezone.trim() : 'Asia/Hong_Kong';
  return {
    timeZone,
    businessHours: s.businessHours,
    closedDays: s.closedDays,
    bookingPolicy: {
      minLeadHours: typeof s.minLeadHours === 'number' ? s.minLeadHours : (s as any).bookingLeadHours,
      allowSameDay: s.allowSameDay as boolean | undefined,
      sameDayCutoffHour: s.sameDayCutoffHour as number | undefined,
      extraClosedWeekdays: Array.isArray(s.closedDayNumbers) ? s.closedDayNumbers as number[] : undefined,
      blackoutDates: Array.isArray(s.blackoutDates) ? (s.blackoutDates as string[]) : undefined,
      serviceRestrictions: (s as any).serviceBookingRules ?? null,
    },
  };
}
