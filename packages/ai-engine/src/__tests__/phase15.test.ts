/**
 * Phase 1.5A/B/C Integration Tests
 *
 * Tests FAQ routing, graceful unknown, and service detail handling.
 */

import {
  classifyQuestion,
  isPhase15AFaqType,
  getFaqAnswer,
  verifyQuestionRouterRegression,
} from '../question-router';
import { classifyUnknown, verifyUnknownHandlerRegression } from '../unknown-handler';
import {
  getServiceSection,
  composeServiceDetailResponse,
  verifyServiceDetailHandlerRegression,
} from '../service-detail-handler';
import type { ServiceEntry, ServiceMatchResult } from '../types';

describe('Phase 1.5A: FAQ Routing', () => {
  describe('faq_deposit', () => {
    it('matches deposit-specific vocabulary', () => {
      const tests = [
        { msg: '需要預付訂金嗎', expected: 'faq_deposit' },
        { msg: '要唔要俾訂金', expected: 'faq_deposit' },
        { msg: '有冇留位費', expected: 'faq_deposit' },
        { msg: 'deposit 點計', expected: 'faq_deposit' },
      ];

      tests.forEach(({ msg, expected }) => {
        const result = classifyQuestion(msg);
        expect(result.questionType).toBe(expected);
        expect(result.isGlobalFaq).toBe(true);
      });
    });

    it('does NOT match generic payment phrases', () => {
      const tests = [
        { msg: '要付款嗎', expected: 'unknown' },
        { msg: '可以先付款嗎', expected: 'unknown' },
        { msg: '幾時俾錢', expected: 'unknown' },
      ];

      tests.forEach(({ msg, expected }) => {
        const result = classifyQuestion(msg);
        expect(result.questionType).toBe(expected);
        expect(result.isGlobalFaq).toBe(false);
      });
    });
  });

  describe('faq_payment', () => {
    it('matches payment method vocabulary', () => {
      const tests = [
        { msg: '可以用信用卡付款嗎', expected: 'faq_payment' },
        { msg: '接唔接受八達通', expected: 'faq_payment' },
        { msg: '可以PayMe嗎', expected: 'faq_payment' },
        { msg: '點付款', expected: 'faq_payment' },
      ];

      tests.forEach(({ msg, expected }) => {
        const result = classifyQuestion(msg);
        expect(result.questionType).toBe(expected);
        expect(result.isGlobalFaq).toBe(true);
      });
    });
  });

  describe('faq_first_visit', () => {
    it('matches global first-visit questions', () => {
      const tests = [
        { msg: '第一次做美容需要注意咩', expected: 'faq_first_visit' },
        { msg: '初次到店要準備咩', expected: 'faq_first_visit' },
        { msg: '首次到店有咩要注意', expected: 'faq_first_visit' },
      ];

      tests.forEach(({ msg, expected }) => {
        const result = classifyQuestion(msg);
        expect(result.questionType).toBe(expected);
        expect(result.isGlobalFaq).toBe(true);
      });
    });

    it('does NOT match service-specific first-visit questions', () => {
      const tests = [
        { msg: '第一次做激光祛斑要注意咩', expected: 'service_precaution' },
        { msg: '第一次做暗瘡療程會點', expected: 'service_precaution' },
        { msg: '第一次嚟做facial需要準備咩', expected: 'service_precaution' },
      ];

      tests.forEach(({ msg, expected }) => {
        const result = classifyQuestion(msg);
        expect(result.questionType).toBe(expected);
        expect(result.isGlobalFaq).toBe(false);
      });
    });
  });

  describe('getFaqAnswer', () => {
    it('returns canned answers for 1.5A FAQ types', () => {
      expect(getFaqAnswer('faq_deposit')).toBeTruthy();
      expect(getFaqAnswer('faq_payment')).toBeTruthy();
      expect(getFaqAnswer('faq_first_visit')).toBeTruthy();
    });

    it('returns null for non-1.5A types', () => {
      expect(getFaqAnswer('faq_cancellation')).toBeNull();
      expect(getFaqAnswer('service_effect')).toBeNull();
      expect(getFaqAnswer('unknown')).toBeNull();
    });
  });

  describe('isPhase15AFaqType', () => {
    it('returns true only for 1.5A FAQ types', () => {
      expect(isPhase15AFaqType('faq_deposit')).toBe(true);
      expect(isPhase15AFaqType('faq_payment')).toBe(true);
      expect(isPhase15AFaqType('faq_first_visit')).toBe(true);
      expect(isPhase15AFaqType('faq_cancellation')).toBe(false);
      expect(isPhase15AFaqType('service_effect')).toBe(false);
    });
  });

  describe('regression tests', () => {
    it('passes all regression tests', () => {
      const result = verifyQuestionRouterRegression();
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
    });
  });
});

describe('Phase 1.5B: Graceful Unknown Handling', () => {
  describe('business_question', () => {
    it('classifies business questions correctly', () => {
      const tests = [
        '呢個療程幾錢呀',
        '敏感肌做唔做得HIFU?',
        '星期六有冇位',
        '你哋有冇做熱石按摩',
      ];

      tests.forEach((msg) => {
        const result = classifyUnknown(msg);
        expect(result.type).toBe('business_question');
        expect(result.suggestedReply).toBeTruthy();
      });
    });
  });

  describe('casual_chat', () => {
    it('classifies casual chat correctly', () => {
      const tests = ['hi', 'ok', 'thx', 'bye'];

      tests.forEach((msg) => {
        const result = classifyUnknown(msg);
        expect(result.type).toBe('casual_chat');
        expect(result.confidence).toBeGreaterThan(0.9);
      });
    });
  });

  describe('needs_clarification', () => {
    it('classifies unclear input correctly', () => {
      const tests = ['...', '???'];

      tests.forEach((msg) => {
        const result = classifyUnknown(msg);
        expect(result.type).toBe('needs_clarification');
      });
    });
  });

  describe('short_input', () => {
    it('classifies very short input correctly', () => {
      const result = classifyUnknown('?');
      expect(result.type).toBe('short_input');
      expect(result.suggestedReply).toContain('詳細');
    });
  });

  describe('regression tests', () => {
    it('passes all regression tests', () => {
      const result = verifyUnknownHandlerRegression();
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
    });
  });
});

describe('Phase 1.5C: Service Detail Handler', () => {
  const structuredService: ServiceEntry = {
    code: 'hifu',
    displayName: 'HIFU 緊緻',
    aliases: ['hifu', '緊緻'],
    priceInfo: 'HKD 1200',
    fullInfo: 'HIFU 緊緻\n功效：拉提緊緻\n適合：皮膚鬆弛人士\n不適合：孕婦\n注意事項：術後避免暴曬',
    effect: '拉提緊緻，改善輪廓',
    suitable: '皮膚鬆弛、有細紋人士',
    unsuitable: '孕婦、心臟起搏器佩戴者',
    precaution: '術後避免暴曬，一週內勿做其他療程',
    duration: '約 60 分鐘',
  };

  const unstructuredService: ServiceEntry = {
    code: 'facial',
    displayName: '深層清潔 Facial',
    aliases: ['facial', '深層清潔'],
    priceInfo: 'HKD 680',
    fullInfo: '深層清潔 Facial\n功效：深層清潔毛孔\n注意事項：敏感肌請先告知美容師\n適合：所有膚質',
  };

  describe('structured field extraction', () => {
    it('extracts effect from structured field', () => {
      const result = getServiceSection(structuredService, 'service_effect');
      expect(result.found).toBe(true);
      expect(result.source).toBe('structured');
      expect(result.reply).toContain('拉提緊緻');
    });

    it('extracts precaution from structured field', () => {
      const result = getServiceSection(structuredService, 'service_precaution');
      expect(result.found).toBe(true);
      expect(result.source).toBe('structured');
      expect(result.reply).toContain('暴曬');
    });

    it('extracts unsuitable from structured field', () => {
      const result = getServiceSection(structuredService, 'service_unsuitable_for');
      expect(result.found).toBe(true);
      expect(result.source).toBe('structured');
      expect(result.reply).toContain('孕婦');
    });
  });

  describe('content fallback extraction', () => {
    it('extracts from content when structured field missing', () => {
      const result = getServiceSection(unstructuredService, 'service_effect');
      expect(result.found).toBe(true);
      expect(['structured', 'content', 'fallback']).toContain(result.source);
      expect(result.reply).toContain('清潔');
    });
  });

  describe('composeServiceDetailResponse', () => {
    it('handles exact match', () => {
      const match: ServiceMatchResult = {
        type: 'exact',
        matches: [{ service: structuredService, confidence: 1.0 }],
      };
      const result = composeServiceDetailResponse('service_effect', match, []);
      expect(result.needsServiceContext).toBe(false);
      expect(result.reply).toContain('HIFU');
    });

    it('handles ambiguous match', () => {
      const match: ServiceMatchResult = {
        type: 'ambiguous',
        matches: [
          { service: structuredService, confidence: 0.85 },
          { service: unstructuredService, confidence: 0.80 },
        ],
      };
      const result = composeServiceDetailResponse('service_effect', match, []);
      expect(result.needsServiceContext).toBe(true);
      expect(result.reply).toContain('邊一項');
    });

    it('handles no match', () => {
      const match: ServiceMatchResult = { type: 'none', matches: [] };
      const result = composeServiceDetailResponse('service_effect', match, []);
      expect(result.needsServiceContext).toBe(true);
      expect(result.reply).toContain('邊個服務');
    });
  });

  describe('regression tests', () => {
    it('passes all regression tests', () => {
      const result = verifyServiceDetailHandlerRegression();
      expect(result.ok).toBe(true);
      expect(result.failures).toEqual([]);
    });
  });
});

describe('Phase 1.5 Integration: End-to-end routing', () => {
  describe('FAQ routing takes priority', () => {
    it('routes faq_deposit before unknown handling', () => {
      const result = classifyQuestion('需要訂金嗎');
      expect(result.questionType).toBe('faq_deposit');
      expect(isPhase15AFaqType(result.questionType)).toBe(true);
    });
  });

  describe('Service detail routing after FAQ', () => {
    it('routes service_effect for effect questions', () => {
      const result = classifyQuestion('HIFU 有咩功效');
      expect(result.questionType).toBe('service_effect');
      expect(result.isGlobalFaq).toBe(false);
      expect(result.needsServiceContext).toBe(true);
    });

    it('routes service_precaution for precaution questions', () => {
      const result = classifyQuestion('做激光要注意咩');
      expect(result.questionType).toBe('service_precaution');
    });
  });

  describe('Unknown handling for unrecognized input', () => {
    it('falls through to unknown when no pattern matches', () => {
      const result = classifyQuestion('abcdefg xyz');
      expect(result.questionType).toBe('unknown');

      const unknownResult = classifyUnknown('abcdefg xyz');
      expect(unknownResult.type).toBe('business_question'); // default fallback
    });
  });
});