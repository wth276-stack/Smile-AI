/**
 * service-detail-handler.ts
 *
 * Phase 1.5C — handles service-specific detail/precaution questions.
 * Phase 1.5D — added price, discountPrice, steps support.
 * Uses structured KB fields first, falls back to content regex.
 *
 * Scope:
 * - service_precaution
 * - service_suitable_for
 * - service_unsuitable_for
 * - service_effect
 * - service_duration
 * - service_price (Phase 1.5D)
 * - service_procedure (Phase 1.5D)
 *
 * Does NOT touch:
 * - Booking flow
 * - Global FAQ (handled by question-router.ts)
 */

import type { ServiceEntry, ServiceMatchResult } from './types';
import type { QuestionType } from './question-router';
import type { AnswerPlan } from './answer-planner';
import { generateMissingFieldResponse } from './answer-planner';
import { preservationTokensFromFacts, verbalizeServiceDetailReply } from './service-detail-verbalizer';
import { clarifyPickOne, clarifyWhichService, missingFieldPriceHonesty } from './unknown-response-policy';

// ── Section extraction patterns (fallback) ────────────────────────────────────

const SECTION_PATTERNS: Record<string, RegExp[]> = {
  effect: [/功效|效果|benefit|好處|作用/i, /有咩用|有咩好/i],
  suitable: [/適合|適用|邊啲人|適合對象/i, /適合.*人士|邊類人/i],
  unsuitable: [/不適合|唔適合|禁忌|不建議/i, /唔啱|唔做得|不建議/i, /孕婦.*不|懷孕.*不/i],
  precaution: [/注意事項|注意|注意點|術前|術後/i, /before.*treatment|aftercare/i, /需要準備|做完.*會/i],
  duration: [/時長|時間|分鐘|小時|duration/i, /幾耐|要幾耐|做幾耐/i],
  price: [/價錢|價格|收費|費用|多少錢|幾錢|price|cost|fee/i],
  steps: [/步驟|流程|點做|做咩|procedure/i],
};

const SECTION_HEADERS: Record<string, RegExp> = {
  effect: /^##\s*功效|^##\s*效果|^功效[：:]|^效果[：:]/i,
  suitable: /^##\s*適合|^##\s*適合對象|^適合[：:]|^適合對象[：:]/i,
  unsuitable: /^##\s*不適合|^##\s*禁忌|^不適合[：:]|^禁忌[：:]/i,
  precaution: /^##\s*注意|^##\s*注意事項|^注意[：:]|^注意事項[：:]/i,
  duration: /^##\s*時長|^##\s*時間|^時長[：:]|^時間[：:]/i,
  price: /^##\s*價錢|^##\s*價格|^價錢[：:]|^價格[：:]/i,
  steps: /^##\s*步驟|^##\s*流程|^步驟[：:]|^流程[：:]/i,
};

// ── Result type ───────────────────────────────────────────────────────────────

export interface ServiceDetailResult {
  found: boolean;
  section: string | null;
  source: 'structured' | 'content' | 'fallback';
  serviceName: string;
  reply: string;
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * Extract service detail section.
 * Priority:
 * 1. Structured field (if available)
 * 2. Section header in content (## 功效 / ## 注意事項 etc.)
 * 3. Regex pattern matching in content lines
 * 4. Fallback: first few lines of content
 */
export function getServiceSection(
  service: ServiceEntry,
  sectionType: QuestionType,
): ServiceDetailResult {
  const sectionMap: Record<string, keyof typeof SECTION_PATTERNS | null> = {
    service_effect: 'effect',
    service_suitable_for: 'suitable',
    service_unsuitable_for: 'unsuitable',
    service_precaution: 'precaution',
    service_duration: 'duration',
    service_price: 'price',
    service_procedure: 'steps',
  };

  const sectionKey = sectionMap[sectionType];
  if (!sectionKey) {
    return {
      found: false,
      section: null,
      source: 'fallback',
      serviceName: service.displayName,
      reply: `「${service.displayName}」呢部分資料暫時未有更多詳情。`,
    };
  }

  const serviceName = service.displayName;

  // Special handling for price (with discount)
  if (sectionType === 'service_price') {
    return handlePriceQuestion(service);
  }

  // Special handling for steps/procedure
  if (sectionType === 'service_procedure') {
    return handleStepsQuestion(service);
  }

  // 1. Try structured field first (non-empty after trim; aligns with Answer Planner hasFieldValue)
  const structuredValue = getStructuredField(service, sectionKey);
  if (structuredValue && structuredValue.trim().length > 0) {
    return {
      found: true,
      section: sectionKey,
      source: 'structured',
      serviceName,
      reply: formatReply(serviceName, structuredValue, sectionKey),
    };
  }

  // 2. Try section header extraction
  const headerResult = extractByHeader(service.fullInfo, sectionKey);
  if (headerResult) {
    return {
      found: true,
      section: sectionKey,
      source: 'content',
      serviceName,
      reply: formatReply(serviceName, headerResult, sectionKey),
    };
  }

  // 3. Try regex pattern matching
  const patternResult = extractByPattern(service.fullInfo, sectionKey);
  if (patternResult) {
    return {
      found: true,
      section: sectionKey,
      source: 'content',
      serviceName,
      reply: formatReply(serviceName, patternResult, sectionKey),
    };
  }

  // 4. Fallback
  return {
    found: false,
    section: sectionKey,
    source: 'fallback',
    serviceName,
    reply: `「${serviceName}」呢部分資料暫時未有更多詳情。`,
  };
}

// ── Price handler (Phase 1.5D) ────────────────────────────────────────────────────

function handlePriceQuestion(service: ServiceEntry): ServiceDetailResult {
  const serviceName = service.displayName;

  // Check for structured price fields
  if (service.price || service.discountPrice) {
    let priceText = '';

    if (service.discountPrice) {
      // Has discount - show both prices
      if (service.price) {
        priceText = `原價 ${service.price}，而家優惠價 ${service.discountPrice} 💰`;
      } else {
        priceText = `優惠價 ${service.discountPrice} 💰`;
      }
    } else if (service.price) {
      // Regular price only
      priceText = `${service.price} 💰`;
    }

    return {
      found: true,
      section: 'price',
      source: 'structured',
      serviceName,
      reply: `「${serviceName}」${priceText}\n\n想預約或者了解更多，隨時話我知 😊`,
    };
  }

  // Fallback to content extraction
  const headerResult = extractByHeader(service.fullInfo, 'price');
  if (headerResult) {
    return {
      found: true,
      section: 'price',
      source: 'content',
      serviceName,
      reply: formatReply(serviceName, headerResult, 'price'),
    };
  }

  const patternResult = extractByPattern(service.fullInfo, 'price');
  if (patternResult) {
    return {
      found: true,
      section: 'price',
      source: 'content',
      serviceName,
      reply: formatReply(serviceName, patternResult, 'price'),
    };
  }

  return {
    found: false,
    section: 'price',
    source: 'fallback',
    serviceName,
    reply: missingFieldPriceHonesty(serviceName),
  };
}

// ── Steps handler (Phase 1.5D) ────────────────────────────────────────────────────

function handleStepsQuestion(service: ServiceEntry): ServiceDetailResult {
  const serviceName = service.displayName;

  // Check for structured steps array
  if (service.steps && service.steps.length > 0) {
    const stepsText = service.steps
      .map((step, index) => `${index + 1}. ${step}`)
      .join('\n');

    return {
      found: true,
      section: 'steps',
      source: 'structured',
      serviceName,
      reply: `「${serviceName}」療程步驟：\n${stepsText}\n\n想預約可以直接話我知 😊`,
    };
  }

  // Fallback to content extraction
  const headerResult = extractByHeader(service.fullInfo, 'steps');
  if (headerResult) {
    return {
      found: true,
      section: 'steps',
      source: 'content',
      serviceName,
      reply: formatReply(serviceName, headerResult, 'steps'),
    };
  }

  const patternResult = extractByPattern(service.fullInfo, 'steps');
  if (patternResult) {
    return {
      found: true,
      section: 'steps',
      source: 'content',
      serviceName,
      reply: formatReply(serviceName, patternResult, 'steps'),
    };
  }

  return {
    found: false,
    section: 'steps',
    source: 'fallback',
    serviceName,
    reply: `「${serviceName}」療程步驟資料暫時未有，可以 WhatsApp 直接查詢 😊`,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStructuredField(
  service: ServiceEntry,
  sectionKey: string,
): string | null | undefined {
  const fieldMap: Record<string, keyof ServiceEntry> = {
    effect: 'effect',
    suitable: 'suitable',
    unsuitable: 'unsuitable',
    precaution: 'precaution',
    duration: 'duration',
    price: 'price',
    steps: 'steps',
  };
  const field = fieldMap[sectionKey];
  if (!field) return null;

  const value = service[field];
  // For steps, convert array to string
  if (field === 'steps' && Array.isArray(value)) {
    return (value as string[]).join('\n');
  }
  return value as string | null | undefined;
}

function extractByHeader(content: string, sectionKey: string): string | null {
  const headerPattern = SECTION_HEADERS[sectionKey];
  if (!headerPattern) return null;

  const lines = content.split('\n').filter((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (headerPattern.test(line)) {
      // Found a section header like "功效：xxx" or "## 功效"
      // Extract content after the colon/header
      const colonMatch = line.match(/^[##\s]*(功效|效果|適合|不適合|注意事項|時長)[：:]\s*(.+)$/i);
      if (colonMatch) {
        // Format: "功效：減淡黑眼圈" - return the content after colon
        return colonMatch[2].trim();
      }
      // Format: "## 功效" - collect lines until next section
      const sectionLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        if (/^##\s/.test(nextLine)) break;
        sectionLines.push(nextLine);
      }
      if (sectionLines.length > 0) {
        return sectionLines.join('\n').trim();
      }
    }
  }

  return null;
}

function extractByPattern(content: string, sectionKey: string): string | null {
  const patterns = SECTION_PATTERNS[sectionKey];
  if (!patterns || patterns.length === 0) return null;

  const lines = content.split('\n').filter((l) => l.trim());
  const matched: string[] = [];

  for (const line of lines) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        matched.push(line.trim());
        break;
      }
    }
  }

  if (matched.length === 0) return null;

  // Return only the matched lines, not surrounding context
  // Max 3 lines to avoid dumping too much content
  return matched.slice(0, 3).join('\n');
}

function formatReply(serviceName: string, content: string, sectionKey: string): string {
  const sectionLabels: Record<string, string> = {
    effect: '功效',
    suitable: '適合對象',
    unsuitable: '不適合對象',
    precaution: '注意事項',
    duration: '時長',
    price: '價錢',
    steps: '步驟',
  };

  const label = sectionLabels[sectionKey] || '';

  // Don't add label prefix if content already starts with it
  const contentHasLabel = label && content.startsWith(label);
  const displayContent = contentHasLabel ? content : (label ? `${label}：${content}` : content);

  return `「${serviceName}」${displayContent}\n\n想了解更多或預約，可以直接話我知 😊`;
}

// ── Compose response for service detail question ──────────────────────────────

/**
 * Compose response for service detail questions.
 *
 * P1-core (Phase 1A): When answerPlan is provided, use its facts instead of
 * extracting fields internally. This ensures Answer Planner is the SINGLE SOURCE
 * OF TRUTH for field selection.
 *
 * @param questionType - The type of question (from question-router)
 * @param serviceMatch - Service match result
 * @param catalog - Service catalog
 * @param answerPlan - Optional AnswerPlan from Answer Planner (Phase 1A)
 */
export function composeServiceDetailResponse(
  questionType: QuestionType,
  serviceMatch: ServiceMatchResult,
  catalog: ServiceEntry[],
  answerPlan?: AnswerPlan,
): { reply: string; needsServiceContext: boolean } {
  // If no service matched, ask user to specify
  if (serviceMatch.type === 'none') {
    // If we have an AnswerPlan with clarification, use it
    if (answerPlan?.shouldAskClarification && answerPlan.clarificationQuestion) {
      return {
        reply: answerPlan.clarificationQuestion,
        needsServiceContext: true,
      };
    }
    return {
      reply: clarifyWhichService(),
      needsServiceContext: true,
    };
  }

  // If ambiguous, ask user to clarify
  if (serviceMatch.type === 'ambiguous') {
    // If we have an AnswerPlan with clarification, use it
    if (answerPlan?.shouldAskClarification && answerPlan.clarificationQuestion) {
      return {
        reply: answerPlan.clarificationQuestion,
        needsServiceContext: true,
      };
    }
    const options = serviceMatch.matches.map((m) => m.service.displayName).join('、');
    return {
      reply: clarifyPickOne(options),
      needsServiceContext: true,
    };
  }

  // Exact or close match
  const service = serviceMatch.matches[0].service;

  // ── P1-core (Phase 1A): Use AnswerPlan if provided ────────────────────────────
  if (answerPlan) {
    // Check if data is missing
    if (!answerPlan.hasData && answerPlan.missingFields.length > 0) {
      // Use the missing field response from Answer Planner
      return {
        reply: generateMissingFieldResponse(
          service.displayName,
          answerPlan.missingFields,
          answerPlan.questionIntent,
        ),
        needsServiceContext: false,
      };
    }

    // If AnswerPlan has data, overlay planner facts onto the service and reuse existing section assembly (no separate wording layer).
    if (answerPlan.hasData) {
      const merged = overlayAnswerPlanFacts(service, answerPlan.facts);
      const section = getServiceSection(merged, questionType);
      const tokens = preservationTokensFromFacts(answerPlan.facts);
      const reply = verbalizeServiceDetailReply({
        questionType,
        baseReply: section.reply,
        preservationTokens: tokens,
      });
      return {
        reply,
        needsServiceContext: false,
      };
    }

    // If AnswerPlan says CLARIFY mode without data
    if (answerPlan.answerMode === 'CLARIFY' && answerPlan.clarificationQuestion) {
      return {
        reply: answerPlan.clarificationQuestion,
        needsServiceContext: true,
      };
    }
  }

  // Fallback to original behavior if no AnswerPlan or unexpected state
  const result = getServiceSection(service, questionType);

  return {
    reply: result.reply,
    needsServiceContext: false,
  };
}

/**
 * Merge Answer Planner facts into a ServiceEntry so existing getServiceSection / price / steps handlers stay the single reply framework.
 * `content` maps to fullInfo (same contract as answer-planner getServiceField).
 */
function overlayAnswerPlanFacts(service: ServiceEntry, facts: AnswerPlan['facts']): ServiceEntry {
  const merged: ServiceEntry = { ...service };
  if (facts.discountPrice !== undefined) merged.discountPrice = facts.discountPrice;
  if (facts.price !== undefined) merged.price = facts.price;
  if (facts.effect !== undefined) merged.effect = facts.effect;
  if (facts.precaution !== undefined) merged.precaution = facts.precaution;
  if (facts.suitable !== undefined) merged.suitable = facts.suitable;
  if (facts.unsuitable !== undefined) merged.unsuitable = facts.unsuitable;
  if (facts.duration !== undefined) merged.duration = facts.duration;
  if (facts.steps !== undefined) merged.steps = facts.steps;
  if (facts.faqItems !== undefined) merged.faqItems = facts.faqItems;
  if (facts.content !== undefined) merged.fullInfo = facts.content;
  return merged;
}

// ── Regression tests ───────────────────────────────────────────────────────────

export function verifyServiceDetailHandlerRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test service with structured fields
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

  // Test: structured field takes priority
  const r1 = getServiceSection(structuredService, 'service_effect');
  if (r1.source !== 'structured') {
    failures.push(`effect: expected structured, got ${r1.source}`);
  }
  if (!r1.found) {
    failures.push(`effect: expected found=true`);
  }

  // Test: unsuitable from structured
  const r2 = getServiceSection(structuredService, 'service_unsuitable_for');
  if (!r2.reply.includes('孕婦')) {
    failures.push(`unsuitable: expected 孕婦 in reply, got ${r2.reply}`);
  }

  // Test service without structured fields (fallback to content)
  const unstructuredService: ServiceEntry = {
    code: 'facial',
    displayName: '深層清潔 Facial',
    aliases: ['facial', '深層清潔'],
    priceInfo: 'HKD 680',
    fullInfo: '深層清潔 Facial\n功效：深層清潔毛孔\n注意事項：敏感肌請先告知美容師\n適合：所有膚質',
    // No structured fields
  };

  // Test: content extraction for effect
  const r3 = getServiceSection(unstructuredService, 'service_effect');
  if (r3.source !== 'content' && r3.source !== 'fallback') {
    failures.push(`effect (unstructured): expected content or fallback, got ${r3.source}`);
  }

  // Test: content extraction for precaution
  const r4 = getServiceSection(unstructuredService, 'service_precaution');
  if (r4.source !== 'content' && r4.source !== 'fallback') {
    failures.push(`precaution (unstructured): expected content or fallback, got ${r4.source}`);
  }

  // Test: ambiguous match
  const ambiguousMatch: ServiceMatchResult = {
    type: 'ambiguous',
    matches: [
      { service: structuredService, confidence: 0.85 },
      { service: unstructuredService, confidence: 0.80 },
    ],
  };

  const r5 = composeServiceDetailResponse('service_effect', ambiguousMatch, []);
  if (!r5.reply.includes('邊一項')) {
    failures.push(`ambiguous: expected clarification prompt, got ${r5.reply}`);
  }
  if (!r5.needsServiceContext) {
    failures.push(`ambiguous: expected needsServiceContext=true`);
  }

  // Test: no match
  const noMatch: ServiceMatchResult = { type: 'none', matches: [] };
  const r6 = composeServiceDetailResponse('service_effect', noMatch, []);
  if (!r6.reply.includes('邊個服務')) {
    failures.push(`no match: expected service prompt, got ${r6.reply}`);
  }
  if (!r6.needsServiceContext) {
    failures.push(`no match: expected needsServiceContext=true`);
  }

  // Phase 1A: reply must surface AnswerPlan-selected facts (overlay → getServiceSection), not a parallel wording layer
  const exactPrice: ServiceMatchResult = {
    type: 'exact',
    matches: [{ service: structuredService, confidence: 1.0 }],
  };
  const planFromPlanner: AnswerPlan = {
    questionIntent: 'PRICE',
    answerMode: 'DIRECT',
    fieldPriority: ['discountPrice', 'price'],
    facts: { discountPrice: '__PLANNER_FACT_TOKEN__' },
    missingFields: [],
    hasData: true,
    shouldAskClarification: false,
    shouldHandoff: false,
  };
  const r7 = composeServiceDetailResponse('service_price', exactPrice, [], planFromPlanner);
  if (!r7.reply.includes('__PLANNER_FACT_TOKEN__')) {
    failures.push(`AnswerPlan facts must surface in reply, got ${r7.reply.slice(0, 80)}`);
  }

  return { ok: failures.length === 0, failures };
}

/** Minimal proof that reply text reflects AnswerPlan.facts (planner is single source for selected fields). */
export function verifyAnswerPlanFactsSurfaceInReply(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const svc: ServiceEntry = {
    code: 't',
    displayName: 'Test Svc',
    aliases: [],
    priceInfo: null,
    fullInfo: 'x',
  };
  const match: ServiceMatchResult = { type: 'exact', matches: [{ service: svc, confidence: 1 }] };
  const plan: AnswerPlan = {
    questionIntent: 'PRICE',
    answerMode: 'DIRECT',
    fieldPriority: ['discountPrice', 'price'],
    facts: { discountPrice: '__PLANNER_FACT_TOKEN__' },
    missingFields: [],
    hasData: true,
    shouldAskClarification: false,
    shouldHandoff: false,
  };
  const out = composeServiceDetailResponse('service_price', match, [], plan);
  if (!out.reply.includes('__PLANNER_FACT_TOKEN__')) {
    failures.push(`composed reply must include planner-selected discountPrice, got ${out.reply.slice(0, 80)}`);
  }
  return { ok: failures.length === 0, failures };
}