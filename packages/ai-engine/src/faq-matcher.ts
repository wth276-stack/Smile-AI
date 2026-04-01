/**
 * faq-matcher.ts
 *
 * Matches user questions against FAQ items stored in knowledge base.
 * Supports both global FAQs (not tied to a service) and service-specific FAQs.
 */

import type { KnowledgeChunk, ServiceEntry } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FaqMatch {
  question: string;
  answer: string;
  sourceTitle: string;  // The document title (service name or FAQ title)
  sourceId: string;    // The document ID
  confidence: number;
}

export interface FaqMatchResult {
  type: 'matched' | 'none';
  match?: FaqMatch;
}

// ── Text normalization (shared with service-matcher) ───────────────────────────

function foldFullWidth(str: string): string {
  return str
    .replace(/\u3000/g, ' ')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function normalize(text: string): string {
  return foldFullWidth(text)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, '')
    .replace(/([\u4e00-\u9fff])([a-zA-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Similarity scoring ────────────────────────────────────────────────────────

/**
 * Calculate Jaccard similarity between two strings.
 * Returns a value between 0 and 1.
 */
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length >= 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length >= 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = wordsA.size + wordsB.size - intersection;

  return intersection / union;
}

/**
 * Check if user message contains key terms from the FAQ question.
 * This handles cases where the user's phrasing differs from the stored question.
 */
function keywordOverlap(userMsg: string, faqQuestion: string): number {
  // Extract meaningful keywords (2+ chars, not common words)
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'be', 'can', 'do', 'does',
    '我', '你', '的', '了', '是', '在', '有', '和', '就', '不', '也',
    '都', '要', '會', '可以', '可', '這', '那', '到', '說', '想',
    '嗎', '呢', '吧', '啊', '喔', '哦', '嘛', '啦', '請問', '請',
  ]);

  const faqWords = faqQuestion.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
  const userWords = new Set(userMsg.split(/\s+/).filter(w => w.length >= 2));

  if (faqWords.length === 0) return 0;

  const matched = faqWords.filter(w => userWords.has(w)).length;
  return matched / faqWords.length;
}

/**
 * Calculate Chinese bigram overlap for better matching.
 */
function bigramOverlap(a: string, b: string): number {
  const chineseA = a.replace(/[^\u4e00-\u9fff]/g, '');
  const chineseB = b.replace(/[^\u4e00-\u9fff]/g, '');

  if (chineseA.length < 2 || chineseB.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < chineseA.length - 1; i++) {
    bigramsA.add(chineseA.substring(i, i + 2));
  }

  const bigramsB = new Set<string>();
  for (let i = 0; i < chineseB.length - 1; i++) {
    bigramsB.add(chineseB.substring(i, i + 2));
  }

  const intersection = [...bigramsA].filter(bg => bigramsB.has(bg)).length;
  const union = bigramsA.size + bigramsB.size - intersection;

  return union > 0 ? intersection / union : 0;
}

// ── Build FAQ catalog ─────────────────────────────────────────────────────────

export interface FaqEntry {
  question: string;
  answer: string;
  sourceTitle: string;
  sourceId: string;
  serviceName: string | null;  // null for global FAQs
  normalizedQuestion: string;
}

/**
 * Extract all FAQ items from knowledge chunks.
 * Returns a flat list with source document info.
 */
export function buildFaqCatalog(knowledge: KnowledgeChunk[]): FaqEntry[] {
  const catalog: FaqEntry[] = [];

  for (const doc of knowledge) {
    if (!doc.faqItems || doc.faqItems.length === 0) continue;

    for (const item of doc.faqItems) {
      if (!item.question || !item.answer) continue;

      catalog.push({
        question: item.question,
        answer: item.answer,
        sourceTitle: doc.title,
        sourceId: doc.documentId,
        serviceName: doc.title, // For service-specific context
        normalizedQuestion: normalize(item.question),
      });
    }
  }

  return catalog;
}

/**
 * Extract FAQ items from service catalog (for service-specific matching).
 */
export function buildFaqCatalogFromServices(services: ServiceEntry[]): FaqEntry[] {
  const catalog: FaqEntry[] = [];

  for (const service of services) {
    if (!service.faqItems || service.faqItems.length === 0) continue;

    for (const item of service.faqItems) {
      if (!item.question || !item.answer) continue;

      catalog.push({
        question: item.question,
        answer: item.answer,
        sourceTitle: service.displayName,
        sourceId: service.code,
        serviceName: service.displayName,
        normalizedQuestion: normalize(item.question),
      });
    }
  }

  return catalog;
}

// ── Match user question against FAQ catalog ───────────────────────────────────

/**
 * Match a user message against FAQ items.
 * Returns the best match if confidence is above threshold.
 */
export function matchFaq(
  userMessage: string,
  faqCatalog: FaqEntry[],
  options?: {
    minConfidence?: number;
    preferServiceContext?: string | null;  // Service code to prioritize
    debug?: boolean;
  },
): FaqMatchResult {
  if (faqCatalog.length === 0) {
    return { type: 'none' };
  }

  const normalizedInput = normalize(userMessage);
  const minConfidence = options?.minConfidence ?? 0.5;
  const debug = options?.debug ?? false;

  // Extract Chinese bigrams from user message for better matching
  const userChinese = userMessage.replace(/[^\u4e00-\u9fff]/g, '');
  const userBigrams = new Set<string>();
  for (let i = 0; i < userChinese.length - 1; i++) {
    userBigrams.add(userChinese.substring(i, i + 2));
  }

  let bestMatch: FaqEntry | null = null;
  let bestScore = 0;

  for (const faq of faqCatalog) {
    let score = 0;

    // Exact match after normalization
    if (normalizedInput === faq.normalizedQuestion) {
      score = 1.0;
    }
    // High similarity match
    else {
      const jaccard = jaccardSimilarity(normalizedInput, faq.normalizedQuestion);
      const keyword = keywordOverlap(normalizedInput, faq.normalizedQuestion);
      const bigram = bigramOverlap(normalizedInput, faq.normalizedQuestion);

      // For Chinese-heavy text, bigram is more reliable
      // Check if message is primarily Chinese
      const isChineseHeavy = userChinese.length > userMessage.length * 0.5;

      if (isChineseHeavy) {
        // Weight bigram more heavily for Chinese text
        score = bigram * 0.7 + jaccard * 0.15 + keyword * 0.15;
      } else {
        // Standard weighting for mixed/English text
        score = jaccard * 0.4 + keyword * 0.35 + bigram * 0.25;
      }

      // Bonus if user message is largely contained in FAQ question
      // This handles cases like "做完會唔會紅" vs "做完會唔會即時紅？"
      const faqChinese = faq.question.replace(/[^\u4e00-\u9fff]/g, '');
      let containmentBonus = 0;

      // Check what fraction of user's Chinese characters appear in the FAQ
      if (userChinese.length > 0 && faqChinese.length > 0) {
        let matchedChars = 0;
        for (const char of userChinese) {
          if (faqChinese.includes(char)) {
            matchedChars++;
          }
        }
        const charOverlap = matchedChars / userChinese.length;
        if (charOverlap > 0.7) {
          // 70%+ character overlap gives good confidence
          containmentBonus = charOverlap * 0.8;
        }
      }

      score = Math.max(score, containmentBonus);

      // Bonus if user message contains the full FAQ question
      if (normalizedInput.includes(faq.normalizedQuestion)) {
        score = Math.max(score, 0.85);
      }
      // Bonus if FAQ question is contained in user message
      if (faq.normalizedQuestion.includes(normalizedInput) && normalizedInput.length >= 4) {
        score = Math.max(score, 0.75);
      }

      // Debug output
      if (debug && score > 0.1) {
        console.log(`[FAQ-DEBUG] "${userMessage}" vs "${faq.question}": jaccard=${jaccard.toFixed(2)} keyword=${keyword.toFixed(2)} bigram=${bigram.toFixed(2)} charOverlap=${containmentBonus.toFixed(2)} → score=${score.toFixed(2)}`);
      }
    }

    // Boost score for service context match
    if (options?.preferServiceContext && faq.serviceName) {
      const serviceNormalized = normalize(options.preferServiceContext);
      if (faq.serviceName.includes(options.preferServiceContext) ||
          normalize(faq.serviceName).includes(serviceNormalized)) {
        score *= 1.15; // 15% boost
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = faq;
    }
  }

  if (bestMatch && bestScore >= minConfidence) {
    return {
      type: 'matched',
      match: {
        question: bestMatch.question,
        answer: bestMatch.answer,
        sourceTitle: bestMatch.sourceTitle,
        sourceId: bestMatch.sourceId,
        confidence: bestScore,
      },
    };
  }

  return { type: 'none' };
}

// ── Response composer ─────────────────────────────────────────────────────────

/**
 * Compose a reply from an FAQ match.
 */
export function composeFaqReply(match: FaqMatch, serviceName?: string | null): string {
  // For service-specific FAQs, mention the service context
  if (serviceName && serviceName !== match.sourceTitle) {
    return `關於「${serviceName}」嘅問題：\n\n${match.answer}`;
  }

  // For global FAQs or exact service match, just return the answer
  return match.answer;
}

// ── Regression tests ──────────────────────────────────────────────────────────

export function verifyFaqMatcherRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const testKnowledge: KnowledgeChunk[] = [
    {
      documentId: 'hifu-service',
      title: 'HIFU 緊緻',
      content: 'HIFU 緊緻\n功效：拉提',
      score: 1,
      faqItems: [
        { question: 'HIFU 會痛嗎？', answer: 'HIFU 過程可能會有輕微痠痛感，但一般都可以接受。' },
        { question: 'HIFU 幾耐見效？', answer: '一般 2-3 個月後效果最明顯，可維持 1-2 年。' },
      ],
    },
    {
      documentId: 'global-faq',
      title: '常見問題',
      content: '常見問題',
      score: 1,
      faqItems: [
        { question: '第一次做美容要注意什麼？', answer: '第一次建議先做皮膚分析，選擇適合嘅溫和療程。' },
        { question: '可以改期嗎？', answer: '可以，請提前 24 小時通知我哋。' },
      ],
    },
  ];

  const catalog = buildFaqCatalog(testKnowledge);

  // Test exact match
  const exact = matchFaq('HIFU 會痛嗎', catalog);
  if (exact.type !== 'matched' || exact.match?.confidence !== 1.0) {
    failures.push(`exact match: got type=${exact.type} confidence=${exact.match?.confidence}`);
  }

  // Test fuzzy match - Chinese character overlap
  const fuzzy = matchFaq('做HIFU痛唔痛', catalog, { minConfidence: 0.35 });
  if (fuzzy.type !== 'matched') {
    failures.push(`fuzzy match: expected matched, got ${fuzzy.type} (HIFU痛唔痛 vs HIFU 會痛嗎)`);
  }

  // Test keyword overlap - HIFU keyword should match
  const keyword = matchFaq('HIFU 幾耐先見到效果', catalog, { minConfidence: 0.35 });
  if (keyword.type !== 'matched') {
    failures.push(`keyword match: expected matched, got ${keyword.type}`);
  }

  // Test no match
  const none = matchFaq('今日天氣好唔好', catalog);
  if (none.type !== 'none') {
    failures.push(`no match: expected none, got ${none.type}`);
  }

  // Test service context boost
  const withContext = matchFaq('幾耐見效', catalog, { preferServiceContext: 'HIFU', minConfidence: 0.35 });
  if (withContext.type !== 'matched' || !withContext.match?.answer.includes('2-3 個月')) {
    failures.push(`service context: expected HIFU FAQ match, got ${withContext.type}`);
  }

  return { ok: failures.length === 0, failures };
}