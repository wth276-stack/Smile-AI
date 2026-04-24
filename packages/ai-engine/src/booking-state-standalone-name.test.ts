import { describe, expect, it } from 'vitest';
import { extractCustomerName, extractSlotsWithReferenceDate } from './booking-state';

describe('extractCustomerName — standalone personal name (whole message)', () => {
  const ref = new Date('2026-04-22T12:00:00+08:00');

  it('accepts English-only first names / display names', () => {
    expect(extractCustomerName('Yoyo')).toBe('Yoyo');
    expect(extractCustomerName('Karen')).toBe('Karen');
    expect(extractCustomerName('Ray')).toBe('Ray');
    expect(extractCustomerName('  Ray  ')).toBe('Ray');
  });

  it('accepts mixed-case English as typed', () => {
    expect(extractCustomerName('KaReN')).toBe('KaReN');
    expect(extractCustomerName('mArY jAnE')).toBe('mArY jAnE');
  });

  it('accepts short CJK names and 阿*', () => {
    expect(extractCustomerName('陳小明')).toBe('陳小明');
    expect(extractCustomerName('阿欣')).toBe('阿欣');
  });

  it('still prefers leading comma / 我叫 when present', () => {
    expect(extractCustomerName('Gigi，星期日十點')).toBe('Gigi');
    expect(extractCustomerName('我叫Ray')).toBe('Ray');
  });

  it('extractSlots passes through standalone name', () => {
    const ex = extractSlotsWithReferenceDate('Yoyo', ref);
    expect(ex.customerName).toBe('Yoyo');
    expect(ex.date).toBeNull();
    expect(ex.time).toBeNull();
  });

  it('rejects acknowledgements and filler', () => {
    expect(extractCustomerName('ok')).toBeNull();
    expect(extractCustomerName('thanks')).toBeNull();
    expect(extractCustomerName('OK')).toBeNull();
  });

  it('rejects dates, times, phone, booking verbs, service tokens', () => {
    expect(extractCustomerName('星期日')).toBeNull();
    expect(extractCustomerName('4月28號')).toBeNull();
    expect(extractCustomerName('51805890')).toBeNull();
    expect(extractCustomerName('HIFU')).toBeNull();
    expect(extractCustomerName('取消')).toBeNull();
    expect(extractCustomerName('7點')).toBeNull();
    expect(extractCustomerName('十點')).toBeNull();
  });
});
