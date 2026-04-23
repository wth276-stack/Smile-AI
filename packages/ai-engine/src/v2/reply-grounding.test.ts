import { describe, it, expect } from 'vitest';
import { applyReplyGrounding, CUSTOMER_SAFE_FALLBACK } from './reply-grounding';
import { isServiceRecognizedInKnowledge } from './validator';
import type { KnowledgeChunk } from '../types';

describe('applyReplyGrounding', () => {
  it('replaces with natural fallback when term not in allowlist and strip would be too short', () => {
    const chunks: KnowledgeChunk[] = [
      { documentId: '1', title: '面部護理', content: '體驗價 800', score: 1 },
    ];
    const { reply, rewritten, issues } = applyReplyGrounding('全身按摩。', chunks, {
      authorisedServiceCatalog: ['面部護理', 'HIFU'],
    });
    expect(rewritten).toBe(true);
    expect(issues.some((i) => i.includes('grounding'))).toBe(true);
    expect(reply).toBe(CUSTOMER_SAFE_FALLBACK);
    expect(reply).not.toMatch(/授權|知識庫|名單為準|唔好/);
  });

  it('does not flag 按摩 when it appears in full-tenant catalog', () => {
    const { reply, rewritten } = applyReplyGrounding('我哋有香薰按摩。', [], {
      authorisedServiceCatalog: ['香薰按摩'],
    });
    expect(rewritten).toBe(false);
    expect(reply).toContain('按摩');
  });

  it('strips 按摩 in a longer reply when one sentence can be dropped cleanly', () => {
    const { reply, rewritten } = applyReplyGrounding('我哋有全身按摩幫你放鬆。歡迎你預約其他療程，營業時間 10-8。', [], {
      authorisedServiceCatalog: ['美白'],
    });
    expect(rewritten).toBe(true);
    expect(reply).not.toMatch(/按摩/);
    expect(reply).toContain('歡迎你預約');
  });

  it('does not strip 按摩 when in retrieved KB', () => {
    const chunks: KnowledgeChunk[] = [
      { documentId: '1', title: '按摩療程', content: '…', score: 1 },
    ];
    const { reply, rewritten } = applyReplyGrounding('有按摩服務。', chunks, {});
    expect(rewritten).toBe(false);
    expect(reply).toContain('按摩');
  });

  it('splits on full-width semicolon so a bad clause does not remove the rest', () => {
    const { reply, rewritten } = applyReplyGrounding(
      '我哋有全身按摩；仲有面部護理同 HIFU。',
      [],
      { authorisedServiceCatalog: ['面部護理', 'HIFU'] },
    );
    expect(rewritten).toBe(true);
    expect(reply).not.toMatch(/按摩/);
    expect(reply).toContain('面部護理');
    expect(reply).toContain('HIFU');
  });

  it('does not treat 按摩 as allowed from chunk body negation text', () => {
    const chunks: KnowledgeChunk[] = [
      {
        documentId: '1',
        title: '常見問題',
        content: '本店不提供按摩服務，恕不另行說明。',
        score: 1,
      },
    ];
    const { reply, rewritten } = applyReplyGrounding('歡迎預約按摩。', chunks, {
      authorisedServiceCatalog: ['面部護理'],
    });
    expect(rewritten).toBe(true);
    expect(reply).not.toMatch(/按摩/);
  });

  it('replaces generic CTA tail with unsupported-service fallback after 按摩 removed', () => {
    const { reply, rewritten } = applyReplyGrounding(
      '我哋有香薰全身按摩。如果你有興趣預約其他服務，或者有其他問題，隨時告訴我！',
      [],
      { authorisedServiceCatalog: ['HIFU', '深層清潔'] },
    );
    expect(rewritten).toBe(true);
    expect(reply).toBe(CUSTOMER_SAFE_FALLBACK);
    expect(reply).not.toMatch(/隨時告訴我|其他問題|預約其他服務/);
  });

  it('replaces detail-only CTA when only generic tail remains', () => {
    const { reply, rewritten } = applyReplyGrounding(
      '我哋有專業按摩。如果需要更多詳情，隨時聯絡我！',
      [],
      { authorisedServiceCatalog: ['面部護理'] },
    );
    expect(rewritten).toBe(true);
    expect(reply).toBe(CUSTOMER_SAFE_FALLBACK);
  });
});

describe('yoga alias recognition', () => {
  it('treats 私人瑜伽 as same service as 私人瑜珈課 (aliases)', () => {
    const chunks: KnowledgeChunk[] = [
      {
        documentId: '1',
        title: '私人瑜珈課',
        content: '首堂體驗 $300、正价 $600',
        score: 1,
        aliases: ['瑜伽', '瑜珈', '私人瑜伽', '私人瑜珈', 'private-yoga'],
      },
    ];
    expect(isServiceRecognizedInKnowledge('私人瑜伽', chunks)).toBe(true);
    expect(isServiceRecognizedInKnowledge('私人瑜伽幾錢', chunks)).toBe(true);
  });
});
