import { describe, it, expect } from 'vitest';
import { formatKnowledgeChunks } from './prompt';
import type { KnowledgeChunk } from './types';

describe('formatKnowledgeChunks', () => {
  it('includes full FAQ answers with 12–18 個月 for HIFU-style docs', () => {
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
    expect(kb).toMatch(/12-18\s*個月/);
    expect(kb).toMatch(/維持幾耐|效果可以維持/);
    expect(kb).toMatch(/Session length \(單次療程時間\)/);
    expect(kb.length).toBeGreaterThan(200);
  });

  it('appends package includes block for 套餐 docs', () => {
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
    expect(kb).toMatch(/Package includes/);
    expect(kb).toMatch(/深層清潔/);
    expect(kb).toMatch(/補水保濕/);
  });
});
