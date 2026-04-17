import { describe, it, expect } from 'vitest';
import { validateOutput, isServiceRecognizedInKnowledge } from './validator';
import type { KnowledgeChunk } from '../types';

/**
 * Long document title unrelated to service display name; content uses service-list lines
 * (`name：HKD …`) so buildServiceCatalog extracts per-line services (see isServiceListDocument).
 */
const kbLongTitleEyeTreatment: KnowledgeChunk[] = [
  {
    documentId: 'doc-eye-body',
    title: '美容院KB｜眼部、身體與脫毛',
    content: [
      '以下為節選價目（多服務同頁）：',
      '眼部特別護理 Eye Treatment：HKD 1200',
      '全身去角質療程：HKD 1280',
    ].join('\n'),
    score: 1,
  },
];

describe('isServiceRecognizedInKnowledge', () => {
  it('matches Eye Treatment via catalog even when document title is unrelated', () => {
    expect(isServiceRecognizedInKnowledge('Eye Treatment', kbLongTitleEyeTreatment)).toBe(true);
  });

  it('matches shorter Chinese phrase via catalog display substring fallback', () => {
    expect(isServiceRecognizedInKnowledge('眼部特別護理', kbLongTitleEyeTreatment)).toBe(true);
  });

  it('returns false when matcher is none and no substring hit on titles/aliases/catalog strings', () => {
    expect(isServiceRecognizedInKnowledge('ZZZ_NOT_A_SERVICE_12345', kbLongTitleEyeTreatment)).toBe(
      false,
    );
  });

  it('matches chunk-level aliases when provided', () => {
    const withAlias: KnowledgeChunk[] = [
      {
        ...kbLongTitleEyeTreatment[0],
        aliases: ['眼部護理'],
      },
    ];
    expect(isServiceRecognizedInKnowledge('眼部護理', withAlias)).toBe(true);
  });
});

describe('validateOutput KB service warnings', () => {
  it('does not add not-found when display name matches catalog from content', () => {
    const { validationIssues } = validateOutput(
      {
        replyText: '收到',
        newSlots: { serviceDisplayName: 'Eye Treatment' },
      },
      { knowledgeChunks: kbLongTitleEyeTreatment },
    );
    expect(validationIssues.some((i) => i.includes('not found in KB'))).toBe(false);
  });

  it('adds not-found for unknown service string (matcher none, no substring hit)', () => {
    const { validationIssues } = validateOutput(
      {
        replyText: '收到',
        newSlots: { serviceDisplayName: 'ZZZ_NOT_A_SERVICE_12345' },
      },
      { knowledgeChunks: kbLongTitleEyeTreatment },
    );
    expect(validationIssues.some((i) => i.includes('not found in KB'))).toBe(true);
  });
});
