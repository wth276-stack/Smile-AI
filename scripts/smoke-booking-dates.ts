/**
 * Rolling HK booking phrases for MVP / multi-industry smoke.
 * Uses "next Saturday ≥ minLeadDays ahead" + "following Monday 15:00" so demos stay inside
 * typical Mon–Sat beauty hours without hardcoding a calendar that goes stale.
 */
const HK_TZ = 'Asia/Hong_Kong';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function hkCalendarPartsFromInstant(d = new Date()): { y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: HK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** Gregorian calendar roll using UTC arithmetic (DST-free; HK has no DST). */
function addCalendarDays(y: number, m: number, d: number, deltaDays: number): { y: number; m: number; d: number } {
  const t = Date.UTC(y, m - 1, d + deltaDays);
  const ud = new Date(t);
  return { y: ud.getUTCFullYear(), m: ud.getUTCMonth() + 1, d: ud.getUTCDate() };
}

/** en-US weekday short in HK timezone for a given Gregorian wall date (noon local proxy). */
function hkWeekdayShort(y: number, m: number, d: number): string {
  const noonHkIso = `${y}-${pad2(m)}-${pad2(d)}T12:00:00`;
  const inst = new Date(`${noonHkIso}+08:00`);
  return new Intl.DateTimeFormat('en-US', { timeZone: HK_TZ, weekday: 'short' }).format(inst);
}

export type SmokeBookingDateBundle = {
  /** HK Saturday picked for slot 11:00 */
  saturdayYmd: { y: number; m: number; d: number };
  /** Following Monday (+2 calendar days from Saturday in HK Gregorian sense) */
  mondayYmd: { y: number; m: number; d: number };
  userCreateSlotsLineCantonese: string;
  userModifyLineCantonese: string;
  expectedDbAfterCreate: string;
  expectedDbAfterModify: string;
};

const DEFAULT_MIN_LEAD_DAYS = 14;

/**
 * Pick next Saturday strictly at least minLeadDays calendar days **after today (HK)**.
 * Modify target is the Monday immediately following that Saturday.
 */
export function getSmokeBookingDateBundle(
  opts: { anchor?: Date; minLeadDays?: number } = {},
): SmokeBookingDateBundle {
  const fromEnv = process.env.SMOKE_BOOKING_MIN_LEAD_DAYS
    ? Number.parseInt(process.env.SMOKE_BOOKING_MIN_LEAD_DAYS, 10)
    : NaN;
  const merged = opts.minLeadDays ?? fromEnv;
  const minLeadDays = Number.isFinite(merged) && merged > 0 ? merged : DEFAULT_MIN_LEAD_DAYS;

  const base = hkCalendarPartsFromInstant(opts.anchor ?? new Date());

  for (let step = minLeadDays; step < minLeadDays + 120; step += 1) {
    const sat = addCalendarDays(base.y, base.m, base.d, step);
    if (hkWeekdayShort(sat.y, sat.m, sat.d) !== 'Sat') continue;

    const mon = addCalendarDays(sat.y, sat.m, sat.d, 2);
    const expectedDbAfterCreate = `${sat.y}-${pad2(sat.m)}-${pad2(sat.d)} 11:00`;
    const expectedDbAfterModify = `${mon.y}-${pad2(mon.m)}-${pad2(mon.d)} 15:00`;

    const userCreateSlotsLineCantonese = `${Number(sat.m)}月${Number(sat.d)}號11點，我叫陳小明，電話91234567`;
    const userModifyLineCantonese = `我想改去${Number(mon.m)}月${Number(mon.d)}號下晝3點`;

    return {
      saturdayYmd: sat,
      mondayYmd: mon,
      userCreateSlotsLineCantonese,
      userModifyLineCantonese,
      expectedDbAfterCreate,
      expectedDbAfterModify,
    };
  }

  throw new Error(
    `smoke-booking-dates: no Saturday within search window (${minLeadDays}..+) -- extend search range`,
  );
}
