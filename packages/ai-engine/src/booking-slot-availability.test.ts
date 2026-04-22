import { describe, expect, it, vi } from 'vitest';
import {
  buildSlotPolicyFromTenantSettings,
  parseBusinessHoursToWeekly,
  validateBookingSlot,
} from './booking-slot-availability';
import { provisionalCustomerNameFromExistingBookings } from './booking-state';

const HK = 'Asia/Hong_Kong';
const now = new Date('2026-01-01T10:00:00+08:00');

describe('provisionalCustomerNameFromExistingBookings', () => {
  it('hydrates from single existing booking when draft name empty', () => {
    const n = provisionalCustomerNameFromExistingBookings(
      { bookingId: null, customerName: null },
      [{ id: 'a', customerName: 'Alex' }],
    );
    expect(n).toBe('Alex');
  });

  it('keeps user-provided name', () => {
    const n = provisionalCustomerNameFromExistingBookings(
      { bookingId: null, customerName: '  Sam  ' },
      [{ id: 'a', customerName: 'Alex' }],
    );
    expect(n).toBe('Sam');
  });

  it('uses matched booking id when several rows', () => {
    const n = provisionalCustomerNameFromExistingBookings(
      { bookingId: 'b', customerName: null },
      [
        { id: 'a', customerName: 'Wrong' },
        { id: 'b', customerName: 'Right' },
      ],
    );
    expect(n).toBe('Right');
  });

  it('returns null when ambiguous (multiple, no id)', () => {
    const n = provisionalCustomerNameFromExistingBookings(
      { bookingId: null, customerName: null },
      [
        { id: 'a', customerName: 'A' },
        { id: 'b', customerName: 'B' },
      ],
    );
    expect(n).toBeNull();
  });
});

describe('buildSlotPolicyFromTenantSettings', () => {
  it('uses tenant.settings.businessHours so Sunday closed is enforced', () => {
    const policy = buildSlotPolicyFromTenantSettings({
      timezone: 'Asia/Hong_Kong',
      businessHours: {
        mon: '10:00-21:00',
        tue: '10:00-21:00',
        wed: '10:00-21:00',
        thu: '10:00-21:00',
        fri: '10:00-21:00',
        sat: '10:00-19:00',
        sun: 'closed',
      },
    });
    const r = validateBookingSlot({
      date: '2026-04-26',
      time: '10:00',
      timeZone: policy.timeZone,
      businessHours: policy.businessHours,
      bookingPolicy: policy.bookingPolicy,
      now,
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('closed_day');
  });
});

describe('validateBookingSlot', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    timeZone: HK,
    now,
    businessHours: {
      mon: '10:00-20:00',
      tue: '10:00-20:00',
      wed: '10:00-20:00',
      thu: '10:00-20:00',
      fri: '10:00-20:00',
      sat: '10:00-20:00',
      sun: 'closed',
    },
    bookingPolicy: {},
    calendarAvailability: null,
    service: 'svc_a',
    ...over,
  });

  it('blocks closed weekday (e.g. Sunday) before confirmation', () => {
    const { hasAny } = parseBusinessHoursToWeekly(base().businessHours);
    expect(hasAny).toBe(true);
    // 2026-01-11 = Sunday in Asia/Hong_Kong
    const r2 = validateBookingSlot({
      ...base(),
      date: '2026-01-11',
      time: '12:00',
    });
    expect(r2.allowed).toBe(false);
    expect(r2.code).toBe('closed_day');
  });

  it('blocks time outside window on an open day', () => {
    // 2026-01-12 = Monday
    const r = validateBookingSlot({
      ...base(),
      date: '2026-01-12',
      time: '08:00',
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('outside_hours');
  });

  it('allows a slot inside business hours on a weekday', () => {
    const r = validateBookingSlot({
      ...base(),
      date: '2026-01-12',
      time: '12:00',
    });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe('ok');
  });

  it('no businessHours config: allows unless calendar hook blocks', () => {
    const hook = () => true;
    const blocked = validateBookingSlot({
      date: '2026-05-20',
      time: '10:00',
      timeZone: HK,
      businessHours: null,
      now,
      bookingPolicy: {},
      calendarAvailability: hook,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('calendar_conflict');
    const ok = validateBookingSlot({
      date: '2026-05-20',
      time: '10:00',
      timeZone: HK,
      businessHours: null,
      now,
      bookingPolicy: {},
      calendarAvailability: null,
    });
    expect(ok.allowed).toBe(true);
    expect(ok.code).toBe('no_config');
  });

  it('blackout list blocks', () => {
    const r = validateBookingSlot({
      ...base(),
      date: '2026-01-12',
      time: '12:00',
      bookingPolicy: { blackoutDates: ['2026-01-12'] },
    });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('blackout');
  });

  it('optional calendar hook: allowed path when false', () => {
    const spy = vi.fn().mockReturnValue(false);
    const r = validateBookingSlot({
      ...base(),
      date: '2026-01-12',
      time: '12:00',
      calendarAvailability: spy,
    });
    expect(r.allowed).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});
