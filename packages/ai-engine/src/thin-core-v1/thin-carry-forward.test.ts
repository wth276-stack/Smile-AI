import { describe, it, expect } from 'vitest';
import type { KnowledgeChunk } from '../types';
import type { ThinSessionFocus } from './thin-state';
import {
  resolveCarryForward,
  nextSuppressReconfirmFlag,
  isBookingUpdateIntent,
  isBookingDraftServiceLocked,
} from './thin-carry-forward';

const sessionHifu: ThinSessionFocus = {
  lastMatchedEntityId: 'doc-hifu',
  lastMatchedEntityTitle: 'HIFU',
};

const kbHifu: KnowledgeChunk = {
  documentId: 'doc-hifu',
  title: 'HIFU',
  content: 'HIFU 提拉',
  score: 0.9,
};

const kbMassage: KnowledgeChunk = {
  documentId: 'doc-massage',
  title: '按摩',
  content: '全身按摩',
  score: 0.55,
};

describe('resolveCarryForward', () => {
  it('high: price / effect follow-up', () => {
    const r1 = resolveCarryForward('幾多錢呀', sessionHifu, [kbHifu], undefined, false);
    expect(r1.band).toBe('high');
    expect(r1.effectiveFocus.lastMatchedEntityId).toBe('doc-hifu');

    const r2 = resolveCarryForward('功效係咩', sessionHifu, [kbHifu], undefined, false);
    expect(r2.band).toBe('high');
  });

  it('medium: vague booking-like', () => {
    const r = resolveCarryForward('想book星期五夜晚', sessionHifu, [kbHifu], undefined, false);
    expect(r.band).toBe('medium');
    expect(r.policyBlock).toContain('medium');
  });

  it('medium + suppressNextReconfirm → high silent', () => {
    const r = resolveCarryForward('想約2點', sessionHifu, [kbHifu], undefined, true);
    expect(r.band).toBe('high');
    expect(r.suppressConsumedThisTurn).toBe(true);
  });

  it('low: retrieval top differs (new topic)', () => {
    const r = resolveCarryForward('有冇按摩做', sessionHifu, [kbMassage, kbHifu], undefined, false);
    expect(r.band).toBe('low');
    expect(r.effectiveFocus.lastMatchedEntityId).toBeNull();
  });

  it('booking draft service overrides session on update intent', () => {
    const draft = {
      serviceName: 'Eye',
      serviceDisplayName: '眼部療程',
      date: '2026-04-10',
      time: '15:00',
      customerName: 'Amy',
      phone: '91234567',
    };
    const kbEye: KnowledgeChunk = {
      documentId: 'doc-eye',
      title: '眼部療程',
      content: 'eye',
      score: 0.8,
    };
    expect(isBookingDraftServiceLocked(draft)).toBe(true);
    expect(isBookingUpdateIntent('改星期三3點')).toBe(true);
    const r = resolveCarryForward('改星期三3點', sessionHifu, [kbEye, kbHifu], draft, false);
    expect(r.bookingDraftPrimary).toBe(true);
    expect(r.effectiveFocus.lastMatchedEntityTitle).toBe('眼部療程');
    expect(r.band).toBe('high');
  });
});

describe('nextSuppressReconfirmFlag', () => {
  it('medium sets suppress for next turn', () => {
    expect(nextSuppressReconfirmFlag('medium', false)).toBe(true);
  });
  it('consume suppress clears', () => {
    expect(nextSuppressReconfirmFlag('high', true)).toBe(false);
  });
});
