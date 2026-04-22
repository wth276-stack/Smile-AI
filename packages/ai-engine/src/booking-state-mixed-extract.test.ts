import { describe, expect, it } from 'vitest';
import { extractSlotsWithReferenceDate } from './booking-state';
import { validateBookingSlot } from './booking-slot-availability';

describe('Mixed utterance slot extraction (name + weekday + Chinese numeral time)', () => {
  it('"Gigi，星期日十點" fills customerName, date, time', () => {
    const ref = new Date('2026-04-22T12:00:00+08:00');
    const ex = extractSlotsWithReferenceDate('Gigi，星期日十點', ref);
    expect(ex.customerName).toBe('Gigi');
    expect(ex.date).toBe('2026-04-26');
    expect(ex.time).toBe('10:00');
  });

  it('Sunday + 十點: slot gate still blocks closed_day when date+time present', () => {
    const ex = extractSlotsWithReferenceDate('Gigi，星期日十點', new Date('2026-04-22T12:00:00+08:00'));
    expect(ex.date && ex.time).toBeTruthy();
    const gate = validateBookingSlot({
      date: ex.date!,
      time: ex.time!,
      timeZone: 'Asia/Hong_Kong',
      businessHours: {
        mon: '10:00-21:00',
        tue: '10:00-21:00',
        wed: '10:00-21:00',
        thu: '10:00-21:00',
        fri: '10:00-21:00',
        sat: '10:00-19:00',
        sun: 'closed',
      },
      bookingPolicy: {},
      calendarAvailability: null,
      now: new Date('2026-04-22T10:00:00+08:00'),
    });
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('closed_day');
  });
});
