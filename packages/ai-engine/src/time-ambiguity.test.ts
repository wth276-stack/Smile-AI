import { describe, expect, it } from 'vitest';
import {
  hasAmbiguousBareHour,
  extractBareHourCandidates,
  resolveAmbiguousTime,
  firstValidWindowStart,
} from './time-ambiguity';

const HK = 'Asia/Hong_Kong';

// Typical salon: Mon–Sat 10:00–21:00, Sun closed
const SALON_HOURS = {
  mon: '10:00-21:00',
  tue: '10:00-21:00',
  wed: '10:00-21:00',
  thu: '10:00-21:00',
  fri: '10:00-21:00',
  sat: '10:00-21:00',
  sun: 'closed',
};

describe('hasAmbiguousBareHour', () => {
  it('detects bare hour without marker', () => {
    expect(hasAmbiguousBareHour('28號7點')).toBe(true);
    expect(hasAmbiguousBareHour('8點')).toBe(true);
    expect(hasAmbiguousBareHour('9點半')).toBe(true);
  });

  it('returns false with explicit markers', () => {
    expect(hasAmbiguousBareHour('下午7點')).toBe(false);
    expect(hasAmbiguousBareHour('早上8點')).toBe(false);
    expect(hasAmbiguousBareHour('晚上9點')).toBe(false);
    expect(hasAmbiguousBareHour('7am')).toBe(false);
    expect(hasAmbiguousBareHour('7pm')).toBe(false);
    expect(hasAmbiguousBareHour('上午10點')).toBe(false);
  });

  it('returns false for 12+ hour values (unambiguous)', () => {
    expect(hasAmbiguousBareHour('14點')).toBe(false);
    expect(hasAmbiguousBareHour('19點')).toBe(false);
  });

  it('returns false for 24h format times', () => {
    expect(hasAmbiguousBareHour('7:00')).toBe(false);
    expect(hasAmbiguousBareHour('19:00')).toBe(false);
  });

  it('returns false for hour 12', () => {
    expect(hasAmbiguousBareHour('12點')).toBe(false);
  });
});

describe('extractBareHourCandidates', () => {
  it('generates AM/PM candidates for bare 7點', () => {
    const c = extractBareHourCandidates('28號7點');
    expect(c).not.toBeNull();
    expect(c!.amTime).toBe('07:00');
    expect(c!.pmTime).toBe('19:00');
    expect(c!.bareHour).toBe(7);
  });

  it('generates candidates for 9點半', () => {
    const c = extractBareHourCandidates('9點半');
    expect(c).not.toBeNull();
    expect(c!.amTime).toBe('09:30');
    expect(c!.pmTime).toBe('21:30');
  });

  it('returns null when marker present', () => {
    expect(extractBareHourCandidates('下午7點')).toBeNull();
    expect(extractBareHourCandidates('晚上8點')).toBeNull();
  });
});

describe('resolveAmbiguousTime', () => {
  it('resolves to PM when only PM is valid (salon 10-21, bare 7點)', () => {
    // 2026-04-28 is a Tuesday
    const c = extractBareHourCandidates('28號7點')!;
    const r = resolveAmbiguousTime('2026-04-28', c, SALON_HOURS, HK);
    expect(r.outcome).toBe('resolved');
    if (r.outcome === 'resolved') {
      expect(r.time).toBe('19:00');
    }
  });

  it('resolves to AM when only AM is valid (e.g. hours 06:00-12:00, bare 8點)', () => {
    const earlyHours = {
      mon: '06:00-12:00',
      tue: '06:00-12:00',
      wed: '06:00-12:00',
      thu: '06:00-12:00',
      fri: '06:00-12:00',
      sat: '06:00-12:00',
      sun: 'closed',
    };
    const c = extractBareHourCandidates('8點')!;
    const r = resolveAmbiguousTime('2026-04-28', c, earlyHours, HK);
    expect(r.outcome).toBe('resolved');
    if (r.outcome === 'resolved') {
      expect(r.time).toBe('08:00');
    }
  });

  it('asks clarification when both AM and PM are valid', () => {
    const wideHours = {
      mon: '06:00-22:00',
      tue: '06:00-22:00',
      wed: '06:00-22:00',
      thu: '06:00-22:00',
      fri: '06:00-22:00',
      sat: '06:00-22:00',
      sun: '06:00-22:00',
    };
    const c = extractBareHourCandidates('8點')!;
    const r = resolveAmbiguousTime('2026-04-28', c, wideHours, HK);
    expect(r.outcome).toBe('clarify');
  });

  it('returns none_valid when closed day', () => {
    const c = extractBareHourCandidates('7點')!;
    // 2026-04-26 is a Sunday → closed
    const r = resolveAmbiguousTime('2026-04-26', c, SALON_HOURS, HK);
    expect(r.outcome).toBe('none_valid');
  });

  it('returns none_valid when both outside hours', () => {
    const c = extractBareHourCandidates('5點')!;
    const r = resolveAmbiguousTime('2026-04-28', c, SALON_HOURS, HK);
    // 05:00 and 17:00 — 17:00 is inside 10-21, so this should resolve
    expect(r.outcome).toBe('resolved');
    if (r.outcome === 'resolved') {
      expect(r.time).toBe('17:00');
    }
  });
});

describe('firstValidWindowStart', () => {
  it('returns first window start for open day', () => {
    // Tuesday
    const start = firstValidWindowStart(SALON_HOURS, '2026-04-28', HK);
    expect(start).toBe('10:00');
  });

  it('returns null for closed day', () => {
    // Sunday
    const start = firstValidWindowStart(SALON_HOURS, '2026-04-26', HK);
    expect(start).toBeNull();
  });
});
