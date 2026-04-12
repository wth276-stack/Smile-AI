import { describe, it, expect } from 'vitest';
import { formatHongKongYmd, resolveRelativeDates } from './engine';

describe('formatHongKongYmd', () => {
  it('formats calendar date in Asia/Hong_Kong (not UTC day shift)', () => {
    const d = new Date(2026, 3, 15, 12, 0, 0);
    expect(formatHongKongYmd(d)).toBe('2026-04-15');
  });
});

describe('resolveRelativeDates', () => {
  it('15號 hint uses HK YMD aligned with 星期 (no UTC vs local mismatch)', () => {
    const today = new Date(2026, 3, 12, 10, 0, 0);
    const out = resolveRelativeDates('15號11點', today);
    expect(out).toBeTruthy();
    expect(out).toContain('15號 = 2026-04-15');
    expect(out).not.toContain('2026-04-14');
    expect(out).toMatch(/星期[一二三四五六日]/);
  });

  it('9號 resolves to same month when still ahead of today', () => {
    const today = new Date(2026, 3, 8, 10, 0, 0);
    const out = resolveRelativeDates('9號11點', today);
    expect(out).toContain('9號 = 2026-04-09');
  });
});
