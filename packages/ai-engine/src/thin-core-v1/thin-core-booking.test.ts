import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emptyDraft } from '../booking-state';
import type { ThinLlmOutput } from './thin-types';
import { applyDeterministicDateTimeToDraft } from './thin-deterministic-datetime';
import { applyThinBookingGate, isExplicitBookingConfirmation } from './thin-booking-confirm';
import { buildThinConfirmationSummary } from './thin-actions';

function baseThin(over: Partial<ThinLlmOutput>): ThinLlmOutput {
  return {
    intent: 'book',
    matchedEntityId: null,
    confidence: 1,
    nextAction: 'booking_submit',
    bookingSlots: {
      serviceName: null,
      serviceDisplayName: null,
      date: null,
      time: null,
      customerName: null,
      phone: null,
    },
    handoffRequired: false,
    reply: 'ok',
    ...over,
  };
}

describe('thin booking confirm', () => {
  it('A: full slots without explicit confirm → booking_confirm', () => {
    const merged = {
      ...emptyDraft(),
      serviceName: 'HIFU',
      serviceDisplayName: 'HIFU',
      date: '2026-04-03',
      time: '19:00',
      customerName: 'Louis',
      phone: '91234567',
    };
    const out = applyThinBookingGate({
      thin: baseThin({ nextAction: 'booking_submit' }),
      mergedDraft: merged,
      priorConfirmationPending: false,
      explicitConfirm: false,
    });
    expect(out.nextAction).toBe('booking_confirm');
  });

  it('B: after summary, 確認預約 → booking_submit', () => {
    const merged = {
      ...emptyDraft(),
      serviceName: 'HIFU',
      serviceDisplayName: 'HIFU',
      date: '2026-04-03',
      time: '19:00',
      customerName: 'Louis',
      phone: '91234567',
    };
    const out = applyThinBookingGate({
      thin: baseThin({ nextAction: 'booking_collect' }),
      mergedDraft: merged,
      priorConfirmationPending: true,
      explicitConfirm: true,
    });
    expect(out.nextAction).toBe('booking_submit');
  });

  it('explicit confirmation patterns', () => {
    expect(isExplicitBookingConfirmation('確認預約')).toBe(true);
    expect(isExplicitBookingConfirmation('OK確認')).toBe(true);
    expect(isExplicitBookingConfirmation('yes confirm')).toBe(true);
    expect(isExplicitBookingConfirmation('我想改時間')).toBe(false);
  });

  it('summary contains service and confirm instruction', () => {
    const s = buildThinConfirmationSummary({
      ...emptyDraft(),
      serviceDisplayName: 'HIFU',
      date: '2026-04-03',
      time: '19:00',
      customerName: 'Louis',
      phone: '91234567',
    });
    expect(s).toContain('HIFU');
    expect(s).toContain('確認預約');
    expect(s).toContain('Louis');
    expect(s).toContain('91234567');
  });
});

describe('thin deterministic datetime (HK ref)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-30T04:00:00.000Z'));
    process.env.THIN_CORE_V1_TZ = 'Asia/Hong_Kong';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.THIN_CORE_V1_TZ;
  });

  it('C: 聽日7點 → tomorrow + evening 7', () => {
    const { draft, dateAmbiguous } = applyDeterministicDateTimeToDraft(emptyDraft(), '想約聽日7點做HIFU');
    expect(dateAmbiguous).toBe(false);
    expect(draft.date).toBe('2026-03-31');
    expect(draft.time).toBe('19:00');
  });

  it('D: 今個星期五夜晚7點 → upcoming Friday evening', () => {
    const { draft, dateAmbiguous } = applyDeterministicDateTimeToDraft(
      emptyDraft(),
      '想約今個星期五夜晚7點',
    );
    expect(dateAmbiguous).toBe(false);
    expect(draft.date).toBe('2026-04-03');
    expect(draft.time).toBe('19:00');
  });

  it('E: 下星期二下晝3點 → next-week Tuesday 15:00', () => {
    const { draft, dateAmbiguous } = applyDeterministicDateTimeToDraft(
      emptyDraft(),
      '想約下星期二下晝3點',
    );
    expect(dateAmbiguous).toBe(false);
    expect(draft.date).toBe('2026-04-07');
    expect(draft.time).toBe('15:00');
  });

  it('A msg: 星期五7點book HIFU → Fri + 19:00', () => {
    const { draft } = applyDeterministicDateTimeToDraft(
      emptyDraft(),
      '我想星期五7點book HIFU，我叫Louis，電話91234567',
    );
    expect(draft.date).toBe('2026-04-03');
    expect(draft.time).toBe('19:00');
  });
});
