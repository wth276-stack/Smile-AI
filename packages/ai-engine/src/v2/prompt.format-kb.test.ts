import { describe, it, expect } from 'vitest';
import { formatKnowledgeChunks } from './prompt';
import type { KnowledgeChunk } from './types';

describe('formatKnowledgeChunks', () => {
  it('includes effect duration / FAQ facts in compact lines (12–18 個月)', () => {
    const chunk: KnowledgeChunk = {
      documentId: 'x',
      title: 'HIFU 高強度聚焦超聲波',
      content: '…',
      score: 1,
      price: 'HKD 3,800',
      discountPrice: 'HKD 1,200',
      duration: '約 60-90 分鐘',
      effect: '- 效果可持續 12-18 個月\n- 其他',
      faqItems: [
        { question: 'Q：效果可以維持幾耐？', answer: 'A：一般 12-18 個月，視乎個人皮膚狀況。' },
        { question: 'Q：痛嗎？', answer: 'A：有輕微感覺。' },
      ],
    };
    const kb = formatKnowledgeChunks([chunk]);
    expect(kb).toMatch(/\[SVC\]/);
    expect(kb).toMatch(/12-18\s*個月/);
    expect(kb).toMatch(/faq\.pain/);
    expect(kb).toMatch(/duration:/);
    expect(kb.length).toBeGreaterThan(80);
  });

  it('outputs not_suitable for unsuitable-only chunk and does not put unsuitable text under suitable_for', () => {
    const chunk: KnowledgeChunk = {
      documentId: 'unsuit',
      title: '激光療程',
      content: '…',
      score: 1,
      unsuitable: '懷孕、啲光敏藥物嘅人士',
    };
    const kb = formatKnowledgeChunks([chunk]);
    expect(kb).toContain('not_suitable:');
    expect(kb).toContain('懷孕');
    expect(kb).not.toMatch(/suitable_for:.*懷孕/s);
    expect(kb).not.toMatch(/suitable_for: General customers/s);
  });

  it('does not repeat the same maintenance window in effect, effect_duration, and faq.duration', () => {
    const chunk: KnowledgeChunk = {
      documentId: 'dedupe',
      title: 'HIFU slim',
      content: '…',
      score: 1,
      price: '1000',
      duration: '60 分鐘',
      effect: '- 效果可持續 12-18 個月',
      faqItems: [
        { question: '效果可維持幾耐？', answer: '一般 12-18 個月，視乎皮膚狀況。' },
      ],
    };
    const kb = formatKnowledgeChunks([chunk]);
    const occ = kb.match(/12-18\s*個月/g) ?? [];
    expect(occ.length).toBeLessThanOrEqual(2);
    expect(kb).not.toMatch(/faq\.duration:/);
    expect(kb).toMatch(/effect_duration:/);
  });

  it('normalises price strings (HKD, HK$, bare number)', () => {
    const rows: Array<{ price: string; discountPrice: string; want: RegExp }> = [
      { price: 'HKD 1,200', discountPrice: 'HKD 800', want: /price: \$1,200/ },
      { price: 'HK$1,200', discountPrice: 'HK$900', want: /price: \$1,200/ },
      { price: '1200', discountPrice: '900', want: /price: \$1200/ },
    ];
    for (let i = 0; i < rows.length; i++) {
      const chunk: KnowledgeChunk = {
        documentId: `p${i}`,
        title: 'P',
        content: '…',
        score: 1,
        price: rows[i].price,
        discountPrice: rows[i].discountPrice,
      };
      const kb = formatKnowledgeChunks([chunk]);
      expect(kb).toMatch(rows[i].want);
    }
  });

  it('appends compact includes for 套餐 docs', () => {
    const chunk: KnowledgeChunk = {
      documentId: 'y',
      title: '新客三合一體驗套餐',
      content:
        '分類：套餐\n【包含項目】\n- 深層清潔 Facial\n- 眼部特別護理\n- 補水保濕療程\n\n適合人群：\n- 新客',
      score: 1,
      price: 'HKD 2,260',
      discountPrice: 'HKD 1,280',
      suitable: '- 新客',
    };
    const kb = formatKnowledgeChunks([chunk]);
    expect(kb).toMatch(/includes:/);
    expect(kb).toMatch(/深層清潔/);
    expect(kb).toMatch(/補水保濕/);
  });
});
