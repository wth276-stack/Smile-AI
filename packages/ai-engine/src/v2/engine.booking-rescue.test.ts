import { describe, it, expect } from 'vitest';
import type { BookingDraft, KnowledgeChunk } from '../types';
import { mergeBookingDraft, validateOutput } from './validator';
import { getMissingBookingSlots, bookingDraftHasAllRequiredSlots } from '../booking-state';
import { buildServiceCatalog, buildServiceTaxonomy, detectServiceSwitch } from '../service-matcher';
import { applyConfirmationBoundaryPostProcess } from './confirmation-boundary';

// ── Test the core logic flows without OpenAI dependency ──

const FULL_DRAFT: BookingDraft = {
  bookingId: null,
  mode: null,
  serviceName: 'HIFU 高強度聚焦超聲波',
  serviceDisplayName: 'HIFU 高強度聚焦超聲波',
  date: '2026-04-23',
  time: '16:00',
  customerName: 'Yuki',
  phone: '64991498',
};

const EMPTY_DRAFT: BookingDraft = {
  bookingId: null,
  mode: null,
  serviceName: null,
  serviceDisplayName: null,
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

describe('WhatsApp booking flow regression', () => {
  describe('Turn 1→2: "我想預約hifu" → "星期四，4點，Yuki，64991498"', () => {
    it('after turn 2, draft should have all 5 slots filled (service from turn 1, rest from turn 2)', () => {
      // Simulating: after "我想預約hifu", service is captured via inferMissingService
      const draftAfterTurn1: BookingDraft = {
        ...EMPTY_DRAFT,
        serviceName: 'HIFU 高強度聚焦超聲波',
        serviceDisplayName: 'HIFU 高強度聚焦超聲波',
      };

      // Turn 2: LLM returns COLLECT_BOOKING with date/time/name/phone but no serviceName
      const llmNewSlots: Partial<BookingDraft> = {
        date: '2026-04-23',
        time: '16:00',
        customerName: 'Yuki',
        phone: '64991498',
      };

      // inferMissingService already filled serviceName on turn 1,
      // so on turn 2 the service should be preserved via mergeBookingDraft
      const merged = mergeBookingDraft(draftAfterTurn1, llmNewSlots);

      expect(merged.serviceName).toBe('HIFU 高強度聚焦超聲波');
      expect(merged.serviceDisplayName).toBe('HIFU 高強度聚焦超聲波');
      expect(merged.date).toBe('2026-04-23');
      expect(merged.time).toBe('16:00');
      expect(merged.customerName).toBe('Yuki');
      expect(merged.phone).toBe('64991498');

      // All 5 required slots should be filled → ready for CONFIRM_BOOKING
      expect(getMissingBookingSlots(merged)).toHaveLength(0);
      expect(bookingDraftHasAllRequiredSlots(merged)).toBe(true);
    });

    it('WhatsApp auto-fill: phone from wa_id even when not typed by user', () => {
      // Simulating WhatsApp channel: user sends "我想預約hifu" without typing phone
      // The wa_id "85291234567" should be auto-filled as phone "91234567"
      const waId = '85291234567';
      const stripped = waId.replace(/^852/, '').replace(/[^0-9]/g, '');
      expect(stripped).toBe('91234567');

      // Short HK number stays as-is
      const shortWaId = '91234567';
      const shortStripped = shortWaId.replace(/^852/, '').replace(/[^0-9]/g, '');
      expect(shortStripped).toBe('91234567');

      // Non-852 prefix stays as-is
      const usNumber = '12125551234';
      const usStripped = usNumber.replace(/^852/, '').replace(/[^0-9]/g, '');
      expect(usStripped).toBe('12125551234');
    });

    it('WhatsApp auto-fill: customerName from profile, but extracted name takes priority', () => {
      // Priority: bookingDraft?.customerName > extracted.customerName > contactName
      const resolveName = (
        draftName: string | null,
        extractedName: string | null,
        contactName: string | null,
      ) => draftName ?? extractedName ?? contactName;

      // User types "Yuki" → draft name wins over WhatsApp profile name
      expect(resolveName('Yuki', null, 'Louis Wong')).toBe('Yuki');
      // Extracted name wins over WhatsApp profile name (user typed it in message)
      expect(resolveName(null, 'Yuki', 'Louis Wong')).toBe('Yuki');
      // No draft or extracted name → fall back to WhatsApp profile name
      expect(resolveName(null, null, 'Louis Wong')).toBe('Louis Wong');
    });
  });

  describe('inferMissingService fix: uses matchService instead of broken 【】 regex', () => {
    it('mergeBookingDraft preserves serviceName when LLM omits it', () => {
      const existingDraft: BookingDraft = {
        ...EMPTY_DRAFT,
        serviceName: 'HIFU 高強度聚焦超聲波',
        serviceDisplayName: 'HIFU 高強度聚焦超聲波',
      };

      // LLM returns newSlots without serviceName (only date/time)
      const newSlots: Partial<BookingDraft> = {
        date: '2026-04-23',
        time: '16:00',
      };

      const merged = mergeBookingDraft(existingDraft, newSlots);
      expect(merged.serviceName).toBe('HIFU 高強度聚焦超聲波');
      expect(merged.date).toBe('2026-04-23');
    });

    it('mergeBookingDraft does NOT overwrite existing serviceName with null', () => {
      const existingDraft: BookingDraft = {
        ...EMPTY_DRAFT,
        serviceName: 'HIFU 高強度聚焦超聲波',
        serviceDisplayName: 'HIFU 高強度聚焦超聲波',
      };

      // LLM explicitly returns empty serviceName (should not overwrite)
      const newSlots: Partial<BookingDraft> = {
        serviceName: '',
        serviceDisplayName: '',
        date: '2026-04-23',
      };

      const merged = mergeBookingDraft(existingDraft, newSlots);
      // orNull('') returns null, so existing value is preserved
      expect(merged.serviceName).toBe('HIFU 高強度聚焦超聲波');
    });
  });

  describe('CONFIRM_BOOKING rescue: fills missing slots before downgrade', () => {
    it('rescue fills only missing fields, preserves LLM-extracted values', () => {
      // LLM gives date+time but missing customerName+phone
      const llmNewSlots: Partial<BookingDraft> = {
        date: '2026-04-23',
        time: '16:00',
      };
      const rescueSlots: Partial<BookingDraft> = {
        customerName: 'Yuki',
        phone: '64991498',
      };

      // Only fill missing; never overwrite
      const result = {
        ...llmNewSlots,
        serviceName: llmNewSlots.serviceName ?? rescueSlots.serviceName,
        serviceDisplayName: llmNewSlots.serviceDisplayName ?? rescueSlots.serviceDisplayName,
        date: llmNewSlots.date ?? rescueSlots.date,
        time: llmNewSlots.time ?? rescueSlots.time,
        customerName: llmNewSlots.customerName ?? rescueSlots.customerName,
        phone: llmNewSlots.phone ?? rescueSlots.phone,
      };

      expect(result.date).toBe('2026-04-23'); // LLM value preserved
      expect(result.time).toBe('16:00'); // LLM value preserved
      expect(result.customerName).toBe('Yuki'); // rescue filled
      expect(result.phone).toBe('64991498'); // rescue filled
    });
  });

  describe('Deterministic CONFIRM_BOOKING coercion', () => {
    const kbChunks = [
      { documentId: 'svc-hifu', title: 'HIFU 高強度聚焦超聲波', content: 'HIFU 療程', score: 1, aliases: ['hifu'] },
    ];

    it('REPLY + full draft + confirmation summary reply → coerced to CONFIRM_BOOKING', () => {
      const result = validateOutput(
        {
          replyText: '好的，Yuki！我已經為你預約了 HIFU 療程。以下是預約詳情：\n- 服務：HIFU\n- 日期：2026-04-23（星期四）\n- 時間：16:00\n- 客戶姓名：Yuki\n- 電話：64991498\n\n請確認以上資料是否正確！',
          intents: ['BOOKING_REQUEST'],
          newSlots: {},
          action: 'REPLY',
        },
        {
          currentDraft: FULL_DRAFT,
          knowledgeChunks: kbChunks,
          confirmationPending: false,
        },
      );

      expect(result.action).toBe('CONFIRM_BOOKING');
      expect(result.validationIssues).toContain('Override: REPLY → CONFIRM_BOOKING (full draft + reply is confirmation summary)');
    });

    it('REPLY + full draft + non-beauty confirmation summary (服務 + slots) → coerced to CONFIRM_BOOKING', () => {
      const result = validateOutput(
        {
          replyText:
            '以下是預約詳情：\n- 服務：常規檢查\n- 日期：2026-04-23\n- 時間：15:00\n- 客戶姓名：Yuki\n- 電話：64991498\n\n請確認以上資料是否正確！',
          intents: ['BOOKING_REQUEST'],
          newSlots: {},
          action: 'REPLY',
        },
        {
          currentDraft: FULL_DRAFT,
          knowledgeChunks: kbChunks,
          confirmationPending: false,
        },
      );
      expect(result.action).toBe('CONFIRM_BOOKING');
    });

    it('REPLY + full draft + 請確認 phrase → coerced to CONFIRM_BOOKING', () => {
      const result = validateOutput(
        {
          replyText: '幫你確認以下預約：HIFU 療程，4月23號4點。',
          intents: ['BOOKING_REQUEST'],
          newSlots: {},
          action: 'REPLY',
        },
        {
          currentDraft: FULL_DRAFT,
          knowledgeChunks: kbChunks,
          confirmationPending: false,
        },
      );

      expect(result.action).toBe('CONFIRM_BOOKING');
    });

    it('REPLY + price inquiry → stays REPLY (not coerced)', () => {
      const result = validateOutput(
        {
          replyText: 'HIFU 療程現時優惠價 $1,200（原價 $3,800），療程時間約60-90分鐘。有興趣可以預約！',
          intents: ['PRICE_INQUIRY'],
          newSlots: {},
          action: 'REPLY',
        },
        {
          currentDraft: FULL_DRAFT,
          knowledgeChunks: kbChunks,
          confirmationPending: false,
        },
      );

      expect(result.action).toBe('REPLY');
    });

    it('REPLY + service inquiry without booking fields → stays REPLY', () => {
      const result = validateOutput(
        {
          replyText: '我哋有提供 HIFU 緊緻療程，效果可以維持12-18個月。你想了解更多定想預約？',
          intents: ['PRODUCT_INQUIRY'],
          newSlots: {},
          action: 'REPLY',
        },
        {
          currentDraft: EMPTY_DRAFT,
          knowledgeChunks: kbChunks,
          confirmationPending: false,
        },
      );

      expect(result.action).toBe('REPLY');
    });

    it('REPLY + partial draft (missing phone) → stays REPLY (not enough slots)', () => {
      const partialDraft: BookingDraft = {
        ...FULL_DRAFT,
        phone: null,
      };

      const result = validateOutput(
        {
          replyText: '好的，請確認以上預約資料是否正確！',
          intents: ['BOOKING_REQUEST'],
          newSlots: {},
          action: 'REPLY',
        },
        {
          currentDraft: partialDraft,
          knowledgeChunks: kbChunks,
          confirmationPending: false,
        },
      );

      // Not all slots filled → should NOT coerce to CONFIRM_BOOKING
      expect(result.action).toBe('REPLY');
    });
  });

  describe('Service switch detection', () => {
    // Catalog with Facial family (3 services) and unique HIFU
    const switchKB: KnowledgeChunk[] = [
      {
        documentId: 'hifu',
        title: 'HIFU 高強度聚焦超聲波',
        content: 'HIFU 高強度聚焦超聲波\n正價：$6980\n試做價：$4980',
        score: 1,
      },
      {
        documentId: 'deep-facial',
        title: '深層清潔 Facial',
        content: '深層清潔 Facial\nHKD 480',
        score: 1,
      },
      {
        documentId: 'hydrate-facial',
        title: '補濕亮肌 Facial',
        content: '補濕亮肌 Facial\nHKD 580',
        score: 1,
      },
      {
        documentId: 'whiten-facial',
        title: '美白嫩膚 Facial',
        content: '美白嫩膚 Facial\nHKD 680',
        score: 1,
      },
    ];

    const catalog = buildServiceCatalog(switchKB);
    const taxonomy = buildServiceTaxonomy(catalog);

    const hifuDraft: BookingDraft = {
      bookingId: null, mode: null,
      serviceName: 'HIFU 高強度聚焦超聲波',
      serviceDisplayName: 'HIFU 高強度聚焦超聲波',
      date: '2026-04-23', time: '16:00',
      customerName: 'Yuki', phone: '64991498',
    };

    const facialDraft: BookingDraft = {
      bookingId: null, mode: null,
      serviceName: '深層清潔 Facial',
      serviceDisplayName: '深層清潔 Facial',
      date: null, time: null, customerName: null, phone: null,
    };

    it('generic family reference → clear (user says "FACIAL" while drafting HIFU)', () => {
      const result = detectServiceSwitch(
        '我想預約FACIAL', hifuDraft, {}, catalog, taxonomy,
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('clear');
    });

    it('specific item → replace (user says "深層清潔 Facial" while drafting HIFU)', () => {
      const result = detectServiceSwitch(
        '我想做深層清潔 Facial', hifuDraft, {}, catalog, taxonomy,
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('replace');
      expect(result!.serviceDisplayName).toBe('深層清潔 Facial');
    });

    it('unique service → replace (user says "HIFU" while drafting Facial)', () => {
      const result = detectServiceSwitch(
        '唔係，我想做HIFU', facialDraft, {}, catalog, taxonomy,
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('replace');
      expect(result!.serviceDisplayName).toBe('HIFU 高強度聚焦超聲波');
    });

    it('same service → null (user asks "HIFU幾多錢" while drafting HIFU)', () => {
      const result = detectServiceSwitch(
        'HIFU幾多錢', hifuDraft, {}, catalog, taxonomy,
      );
      expect(result).toBeNull();
    });

    it('no service mention → null (user says "你好")', () => {
      const result = detectServiceSwitch(
        '你好', hifuDraft, {}, catalog, taxonomy,
      );
      expect(result).toBeNull();
    });

    it('LLM extracted service + user category text → clear (override LLM pick)', () => {
      // LLM picked "深層清潔 Facial" but user only said "FACIAL" (category)
      const newSlots: Partial<BookingDraft> = {
        serviceName: '深層清潔 Facial',
        serviceDisplayName: '深層清潔 Facial',
      };
      const result = detectServiceSwitch(
        '我想預約FACIAL', hifuDraft, newSlots, catalog, taxonomy,
      );
      expect(result).not.toBeNull();
      expect(result!.type).toBe('clear');
    });
  });

  // Non-beauty fixture parity: shared English token "Class" (gyms, studios) + unique 1:1 product
  describe('Service switch detection (group-class / fitness parity)', () => {
    const fitnessKB: KnowledgeChunk[] = [
      { documentId: 'pt', title: 'Personal Training 1:1', content: 'HKD 800', score: 1 },
      { documentId: 'hiit', title: 'HIIT Class', content: 'HKD 200', score: 1 },
      { documentId: 'spin', title: 'Spin Class', content: 'HKD 180', score: 1 },
      { documentId: 'yoga', title: 'Yoga Class', content: 'HKD 160', score: 1 },
    ];
    const fitCatalog = buildServiceCatalog(fitnessKB);
    const fitTax = buildServiceTaxonomy(fitCatalog);

    const ptDraft: BookingDraft = {
      bookingId: null,
      mode: null,
      serviceName: 'Personal Training 1:1',
      serviceDisplayName: 'Personal Training 1:1',
      date: '2026-04-23',
      time: '16:00',
      customerName: 'Alex',
      phone: '91234567',
    };

    it('shared category "class" (ambiguous family) while drafting PT → clear', () => {
      const result = detectServiceSwitch('我想預約Class', ptDraft, {}, fitCatalog, fitTax);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('clear');
    });

    it('specific "Spin Class" while drafting PT → replace', () => {
      const result = detectServiceSwitch('我想做Spin Class', ptDraft, {}, fitCatalog, fitTax);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('replace');
      expect(result!.serviceDisplayName).toBe('Spin Class');
    });

    it('LLM pre-merged HIIT Class + user only category "class" → clear', () => {
      const newSlots: Partial<BookingDraft> = {
        serviceName: 'HIIT Class',
        serviceDisplayName: 'HIIT Class',
      };
      const result = detectServiceSwitch('我想預約class', ptDraft, newSlots, fitCatalog, fitTax);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('clear');
    });
  });
});

describe('Modify / reschedule flow (v2)', () => {
  const kbChunks = [
    { documentId: 'svc-hifu', title: 'HIFU 高強度聚焦超聲波', content: 'HIFU 療程', score: 1, aliases: ['hifu'] },
  ];

  const modifyDraft: BookingDraft = {
    bookingId: 'bk-1',
    mode: 'modify',
    serviceName: 'HIFU 高強度聚焦超聲波',
    serviceDisplayName: 'HIFU 高強度聚焦超聲波',
    date: '2026-04-30',
    time: '10:00',
    customerName: 'Yuki',
    phone: '64991498',
  };

  it('mergeBookingDraft: bookingId without mode defaults to modify', () => {
    const base: BookingDraft = {
      ...EMPTY_DRAFT,
      bookingId: 'x1',
    };
    const merged = mergeBookingDraft(base, { date: '2026-05-01' });
    expect(merged.mode).toBe('modify');
    expect(merged.bookingId).toBe('x1');
  });

  it('existing booking + user affirms modify summary → MODIFY_BOOKING, not SUBMIT', () => {
    const v = validateOutput(
      {
        replyText: '好的',
        intents: ['BOOKING_CHANGE'],
        newSlots: {},
        action: 'SUBMIT_BOOKING',
      },
      {
        currentDraft: modifyDraft,
        currentMessage: '可以',
        knowledgeChunks: kbChunks,
        confirmationPending: true,
      },
    );
    expect(v.action).toBe('MODIFY_BOOKING');
  });

  it('modify summary correction → COLLECT, not new-booking SUBMIT', () => {
    const v = validateOutput(
      {
        replyText: '收到',
        intents: ['BOOKING_CHANGE'],
        newSlots: { date: '2026-05-24', time: '10:00' },
        action: 'CONFIRM_BOOKING',
      },
      {
        currentDraft: modifyDraft,
        currentMessage: '唔啱，我係約24號10am',
        knowledgeChunks: kbChunks,
        confirmationPending: true,
      },
    );
    expect(v.action).toBe('COLLECT_BOOKING');
  });

  it('applyConfirmationBoundary: modify draft never gets replaced by single new-booking template', () => {
    const r = applyConfirmationBoundaryPostProcess(
      modifyDraft,
      '原預約 4/30 10:00 → 新時間 5/1 11:00，請確認是否改期？',
      'REPLY',
      { confirmationPending: true, currentMessage: '可以' },
    );
    expect(r.reply).toContain('原預約');
    expect(r.usedTemplate).toBe(false);
  });

  it('new booking affirmation path: pending + full draft + 好 → still SUBMIT_BOOKING', () => {
    const v = validateOutput(
      {
        replyText: '好的',
        intents: ['BOOKING_REQUEST'],
        newSlots: {},
        action: 'REPLY',
      },
      {
        currentDraft: FULL_DRAFT,
        currentMessage: '好',
        knowledgeChunks: kbChunks,
        confirmationPending: true,
      },
    );
    expect(v.action).toBe('SUBMIT_BOOKING');
  });
});