import { describe, it, expect } from 'vitest';
import { applyConfirmationBoundaryPostProcess } from './confirmation-boundary';
import type { BookingDraft } from '../types';

const fullDraft: BookingDraft = {
  bookingId: null,
  mode: null,
  serviceName: 'eye_treatment',
  serviceDisplayName: 'Eye Treatment',
  date: '2026-04-20',
  time: '19:00',
  customerName: 'Tester',
  phone: '91234567',
};

describe('applyConfirmationBoundaryPostProcess', () => {
  it('Case 3: uses deterministic template when reply does not reflect draft', () => {
    const out = applyConfirmationBoundaryPostProcess(
      fullDraft,
      '好呀，收到！',
      'REPLY_ONLY',
      { confirmationPending: false },
    );
    expect(out.usedTemplate).toBe(true);
    expect(out.action).toBe('CONFIRM_BOOKING');
    expect(out.reply).toContain('幫你確認一下預約資料');
  });

  it('skips Case 3 template when skipDeterministicConfirmationTemplate (duplicate-affirm path)', () => {
    const shortReply = '好呀，收到！';
    const out = applyConfirmationBoundaryPostProcess(fullDraft, shortReply, 'REPLY_ONLY', {
      confirmationPending: false,
      skipDeterministicConfirmationTemplate: true,
    });
    expect(out.usedTemplate).toBe(false);
    expect(out.reply).toBe(shortReply);
    expect(out.action).toBe('REPLY_ONLY');
  });

  it('skips Case 3 when skip is true and action is CONFIRM_BOOKING (non-SUBMIT second-affirm path)', () => {
    const shortReply = '收到，幫你跟進～';
    const out = applyConfirmationBoundaryPostProcess(fullDraft, shortReply, 'CONFIRM_BOOKING', {
      confirmationPending: false,
      skipDeterministicConfirmationTemplate: true,
    });
    expect(out.usedTemplate).toBe(false);
    expect(out.reply).toBe(shortReply);
    expect(out.action).toBe('CONFIRM_BOOKING');
  });
});
