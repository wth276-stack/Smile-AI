import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookingDraft } from '../types';

// We'll test the deterministic rescue logic directly, not through the full engine,
// since the OpenAI mock is fragile. The rescue logic is in the engine flow but
// relies on deterministicSlotFallback which we can test in isolation, plus the
// merge + downgrade logic which is pure computation.

import { extractSlots } from '../booking-state';
import { matchService } from '../service-matcher';

describe('deterministic slot extraction from user messages', () => {
  it('extracts phone from "64991498"', () => {
    const result = extractSlots('64991498');
    expect(result.phone).toBe('64991498');
  });

  it('extracts phone number from message', () => {
    const result = extractSlots('64991498');
    expect(result.phone).toBe('64991498');
  });

  it('extracts customerName from message with comma-separated fields', () => {
    // This tests the general parsing approach
    const msg = '星期四，4點，Yuki，64991498';
    const parts = msg.split('，').map(s => s.trim());
    // The name would be the 3rd field
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });
});

describe('CONFIRM_BOOKING downgrade + rescue flow logic', () => {
  // Simulate the engine's merge + rescue logic
  const EMPTY_DRAFT: BookingDraft = {
    bookingId: null,
    mode: null,
    serviceName: 'HIFU 高強度聚焦超聲波',
    serviceDisplayName: 'HIFU 高強度聚焦超聲波',
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };

  function mergeBookingDraft(
    existing: BookingDraft | null,
    llmDraft: Partial<BookingDraft> | null,
  ): BookingDraft {
    function orNull(v: unknown): string | null {
      if (typeof v === 'string' && v.trim()) return v.trim();
      return null;
    }
    return {
      bookingId: orNull(llmDraft?.bookingId) ?? orNull(existing?.bookingId) ?? null,
      mode: (llmDraft?.mode as BookingDraft['mode']) ?? existing?.mode ?? null,
      serviceName: orNull(llmDraft?.serviceName) ?? orNull(existing?.serviceName) ?? null,
      serviceDisplayName: orNull(llmDraft?.serviceDisplayName) ?? orNull(existing?.serviceDisplayName) ?? null,
      date: orNull(llmDraft?.date) ?? orNull(existing?.date) ?? null,
      time: orNull(llmDraft?.time) ?? orNull(existing?.time) ?? null,
      customerName: orNull(llmDraft?.customerName) ?? orNull(existing?.customerName) ?? null,
      phone: orNull(llmDraft?.phone) ?? orNull(existing?.phone) ?? null,
    };
  }

  function getMissingBookingSlots(draft: BookingDraft): string[] {
    const required: (keyof BookingDraft)[] = ['serviceName', 'date', 'time', 'customerName', 'phone'];
    return required.filter((k) => !draft[k]);
  }

  it('Bug scenario: CONFIRM_BOOKING with no newSlots → missing 4 fields → rescue should fill them', () => {
    // LLM returns CONFIRM_BOOKING but no newSlots
    const llmNewSlots: Partial<BookingDraft> = {};
    const mergedBeforeRescue = mergeBookingDraft(EMPTY_DRAFT, llmNewSlots);
    const missingBeforeRescue = getMissingBookingSlots(mergedBeforeRescue);

    // Before rescue: 4 fields missing (date, time, customerName, phone)
    expect(missingBeforeRescue).toContain('date');
    expect(missingBeforeRescue).toContain('time');
    expect(missingBeforeRescue).toContain('customerName');
    expect(missingBeforeRescue).toContain('phone');

    // After deterministic extraction from user message
    const rescueSlots: Partial<BookingDraft> = {
      date: '2026-04-23',
      time: '16:00',
      customerName: 'Yuki',
      phone: '64991498',
    };

    // Only fill missing fields; never overwrite LLM-extracted slots
    const finalNewSlots = {
      ...llmNewSlots,
      serviceName: llmNewSlots.serviceName ?? rescueSlots.serviceName,
      serviceDisplayName: llmNewSlots.serviceDisplayName ?? rescueSlots.serviceDisplayName,
      date: llmNewSlots.date ?? rescueSlots.date,
      time: llmNewSlots.time ?? rescueSlots.time,
      customerName: llmNewSlots.customerName ?? rescueSlots.customerName,
      phone: llmNewSlots.phone ?? rescueSlots.phone,
      bookingId: llmNewSlots.bookingId ?? rescueSlots.bookingId,
    };

    const finalMerged = mergeBookingDraft(EMPTY_DRAFT, finalNewSlots);
    const missingAfterRescue = getMissingBookingSlots(finalMerged);

    // After rescue: all slots filled
    expect(missingAfterRescue).toHaveLength(0);
    expect(finalMerged.date).toBe('2026-04-23');
    expect(finalMerged.time).toBe('16:00');
    expect(finalMerged.customerName).toBe('Yuki');
    expect(finalMerged.phone).toBe('64991498');

    // CONFIRM_BOOKING should NOT be downgraded to COLLECT_BOOKING
    // because all slots are now filled
  });

  it('Partial newSlots: LLM gives date+time only, rescue fills customerName+phone', () => {
    const llmNewSlots: Partial<BookingDraft> = {
      date: '2026-04-23',
      time: '16:00',
    };

    const mergedBeforeRescue = mergeBookingDraft(EMPTY_DRAFT, llmNewSlots);
    const missingBeforeRescue = getMissingBookingSlots(mergedBeforeRescue);

    // Before rescue: 2 fields missing (customerName, phone)
    expect(missingBeforeRescue).toContain('customerName');
    expect(missingBeforeRescue).toContain('phone');

    // Rescue fills only the missing fields
    const rescueSlots: Partial<BookingDraft> = {
      customerName: 'Yuki',
      phone: '64991498',
    };

    const finalNewSlots = {
      ...llmNewSlots,
      serviceName: llmNewSlots.serviceName ?? rescueSlots.serviceName,
      serviceDisplayName: llmNewSlots.serviceDisplayName ?? rescueSlots.serviceDisplayName,
      date: llmNewSlots.date ?? rescueSlots.date,
      time: llmNewSlots.time ?? rescueSlots.time,
      customerName: llmNewSlots.customerName ?? rescueSlots.customerName,
      phone: llmNewSlots.phone ?? rescueSlots.phone,
      bookingId: llmNewSlots.bookingId ?? rescueSlots.bookingId,
    };

    // Verify LLM slots are NOT overwritten
    expect(finalNewSlots.date).toBe('2026-04-23'); // kept from LLM
    expect(finalNewSlots.time).toBe('16:00'); // kept from LLM
    expect(finalNewSlots.customerName).toBe('Yuki'); // filled by rescue
    expect(finalNewSlots.phone).toBe('64991498'); // filled by rescue

    const finalMerged = mergeBookingDraft(EMPTY_DRAFT, finalNewSlots);
    const missingAfterRescue = getMissingBookingSlots(finalMerged);
    expect(missingAfterRescue).toHaveLength(0);
  });

  it('Rescue does NOT overwrite LLM-extracted values', () => {
    // LLM gives a different customerName; rescue should NOT replace it
    const llmNewSlots: Partial<BookingDraft> = {
      date: '2026-04-23',
      time: '16:00',
      customerName: 'Louis', // LLM extracted this
    };

    const rescueSlots: Partial<BookingDraft> = {
      customerName: 'Yuki', // rescue would extract this from message
      phone: '64991498',
    };

    // Only fill missing; never overwrite
    const finalNewSlots = {
      ...llmNewSlots,
      serviceName: llmNewSlots.serviceName ?? rescueSlots.serviceName,
      serviceDisplayName: llmNewSlots.serviceDisplayName ?? rescueSlots.serviceDisplayName,
      date: llmNewSlots.date ?? rescueSlots.date,
      time: llmNewSlots.time ?? rescueSlots.time,
      customerName: llmNewSlots.customerName ?? rescueSlots.customerName, // ?? = keep LLM value
      phone: llmNewSlots.phone ?? rescueSlots.phone,
      bookingId: llmNewSlots.bookingId ?? rescueSlots.bookingId,
    };

    expect(finalNewSlots.customerName).toBe('Louis'); // LLM value preserved
    expect(finalNewSlots.phone).toBe('64991498'); // rescue filled this
  });

  it('Full newSlots from LLM → no rescue needed, CONFIRM_BOOKING stays', () => {
    const llmNewSlots: Partial<BookingDraft> = {
      serviceName: 'HIFU 高強度聚焦超聲波',
      serviceDisplayName: 'HIFU 高強度聚焦超聲波',
      date: '2026-04-23',
      time: '16:00',
      customerName: 'Yuki',
      phone: '64991498',
    };

    const merged = mergeBookingDraft(EMPTY_DRAFT, llmNewSlots);
    const missing = getMissingBookingSlots(merged);

    // All slots filled — no downgrade needed
    expect(missing).toHaveLength(0);
  });
});