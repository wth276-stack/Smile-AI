/**
 * answer-planner.ts
 *
 * P1-core Module 2: Answer Planner
 *
 * Maps question intent to field priority and determines what facts to use.
 * This module is the SINGLE SOURCE OF TRUTH for field selection.
 *
 * Principles:
 * 1. Field Priority Contract is explicit and documented
 * 2. Missing fields are handled honestly - no hallucination, no misleading lead-in
 * 3. Decision Engine only provides advisory hints, cannot override Answer Planner
 * 4. Answer Planner decides WHAT facts to use, LLM Verbalizer decides HOW to say it
 */

import type { ServiceEntry, ServiceMatchResult } from './types';
import type { QuestionType } from './question-router';
import {
  clarifyPickOne,
  clarifyWhichAspect,
  clarifyWhichService,
  missingFieldOtherHonesty,
  missingFieldPriceHonesty,
} from './unknown-response-policy';

// ── Field Priority Contract ─────────────────────────────────────────────────────
// This is the SINGLE SOURCE OF TRUTH for which fields to use for each intent.
// Order matters: first field is tried first, fallback to next.
//
// Fallback field mapping:
// - 'content' maps to ServiceEntry.fullInfo (the raw content field)
// - 'discountPrice' and 'price' are direct structured fields
// - All other fields (effect, suitable, unsuitable, precaution, duration, steps, faqItems)
//   are structured fields extracted during KB import
//
// Example: EFFECT intent tries ['effect', 'content']
//   → First check service.effect (structured field)
//   → If empty/missing, fallback to service.fullInfo (raw content)

// Type for field priority - allows 'content' as a pseudo-field that maps to fullInfo
export type FieldPriorityField = keyof ServiceEntry | 'content';

export const FIELD_PRIORITY: Record<string, FieldPriorityField[]> = {
  PRICE:        ['discountPrice', 'price'],
  DISCOUNT:     ['discountPrice', 'price'],
  EFFECT:       ['effect', 'content'],
  PRECAUTION:   ['precaution', 'content'],
  SUITABLE:     ['suitable', 'content'],
  UNSUITABLE:   ['unsuitable', 'content'],
  DURATION:     ['duration', 'content'],
  PROCESS:      ['steps', 'content'],
  FAQ:          ['faqItems', 'content'],
  COMPARISON:   ['effect', 'duration', 'price', 'precaution', 'content'],
};

// ── Question Intent ─────────────────────────────────────────────────────────────

export type QuestionIntent =
  | 'PRICE'
  | 'DISCOUNT'
  | 'EFFECT'
  | 'PRECAUTION'
  | 'SUITABLE'
  | 'UNSUITABLE'
  | 'DURATION'
  | 'PROCESS'
  | 'FAQ'
  | 'COMPARISON'
  | 'BOOKING_INIT'
  | 'BOOKING_MODIFY'
  | 'FOLLOW_UP'
  | 'CLARIFICATION'
  | 'OBJECTION'
  | 'UNKNOWN';

// ── Answer Plan ────────────────────────────────────────────────────────────────

export interface AnswerPlan {
  questionIntent: QuestionIntent;
  selectedService?: string;
  serviceDisplayName?: string;

  // What mode to use for answering
  answerMode: 'DIRECT' | 'CLARIFY' | 'FOLLOW_UP' | 'HANDOFF' | 'BOOKING' | 'UNKNOWN';

  // Fields to prioritize (from FIELD_PRIORITY)
  fieldPriority: string[];

  // Actual facts extracted from service KB
  facts: {
    price?: string;
    discountPrice?: string;
    effect?: string;
    precaution?: string;
    suitable?: string;
    unsuitable?: string;
    duration?: string;
    steps?: string[];
    faqItems?: Array<{ question: string; answer: string }>;
    content?: string;
  };

  // Which required fields are missing
  missingFields: string[];

  // Whether we have enough data to answer
  hasData: boolean;

  // Whether we need to ask for clarification
  shouldAskClarification: boolean;
  clarificationQuestion?: string;

  // Whether we should handoff to human
  shouldHandoff: boolean;
  handoffReason?: string;
}

// ── Semantic State ─────────────────────────────────────────────────────────────
// Minimal semantic state needed for answer planning (full state in semantic-state.ts)

export interface SemanticStateContext {
  currentService?: string;
  lastAnsweredAspect?: 'price' | 'effect' | 'precaution' | 'suitable' | 'unsuitable' | 'duration' | 'process' | 'faq' | 'booking';
  lastAnswerPolarity?: 'positive' | 'negative' | 'conditional' | 'neutral';
  lastConstraint?: string;
  lastQuestionIntent?: QuestionIntent;
}

// ── Main planner function ──────────────────────────────────────────────────────

/**
 * Plan how to answer a question based on intent, service match, and semantic context.
 *
 * This function:
 * 1. Determines field priority from intent
 * 2. Extracts facts from service KB in priority order
 * 3. Identifies missing fields
 * 4. Decides answer mode (DIRECT, CLARIFY, HANDOFF, etc.)
 * 5. Returns structured AnswerPlan
 */
export function planAnswer(
  intent: QuestionIntent,
  serviceMatch: ServiceMatchResult,
  catalog: ServiceEntry[],
  semanticState?: SemanticStateContext,
): AnswerPlan {
  // Default values
  const plan: AnswerPlan = {
    questionIntent: intent,
    selectedService: undefined,
    serviceDisplayName: undefined,
    answerMode: 'UNKNOWN',
    fieldPriority: [],
    facts: {},
    missingFields: [],
    hasData: false,
    shouldAskClarification: false,
    shouldHandoff: false,
  };

  // ── Handle UNKNOWN intent ─────────────────────────────────────────────────────
  if (intent === 'UNKNOWN') {
    plan.answerMode = 'UNKNOWN';
    plan.hasData = false;
    return plan;
  }

  // ── Handle BOOKING intents ─────────────────────────────────────────────────────
  if (intent === 'BOOKING_INIT' || intent === 'BOOKING_MODIFY') {
    plan.answerMode = 'BOOKING';
    plan.hasData = true;
    return plan;
  }

  // ── Handle FOLLOW_UP ───────────────────────────────────────────────────────────
  if (intent === 'FOLLOW_UP') {
    // Use semantic state to determine what aspect is being followed up
    if (semanticState?.lastAnsweredAspect) {
      plan.answerMode = 'FOLLOW_UP';
      // Map lastAnsweredAspect to field priority
      const aspectToIntent: Record<string, QuestionIntent> = {
        price: 'PRICE',
        effect: 'EFFECT',
        precaution: 'PRECAUTION',
        suitable: 'SUITABLE',
        unsuitable: 'UNSUITABLE',
        duration: 'DURATION',
        process: 'PROCESS',
        faq: 'FAQ',
      };
      const mappedIntent = aspectToIntent[semanticState.lastAnsweredAspect] || 'UNKNOWN';
      plan.questionIntent = mappedIntent;
      plan.fieldPriority = FIELD_PRIORITY[mappedIntent] || [];
    } else {
      plan.answerMode = 'CLARIFY';
      plan.shouldAskClarification = true;
      plan.clarificationQuestion = clarifyWhichAspect();
    }
    return plan;
  }

  // ── Handle CLARIFICATION ────────────────────────────────────────────────────────
  if (intent === 'CLARIFICATION') {
    plan.answerMode = 'CLARIFY';
    plan.shouldAskClarification = true;
    return plan;
  }

  // ── Handle service detail questions ─────────────────────────────────────────────
  // Get field priority for this intent
  plan.fieldPriority = FIELD_PRIORITY[intent] || [];

  // Determine service context
  if (serviceMatch.type === 'none') {
    // No service matched - need to ask for clarification
    plan.answerMode = 'CLARIFY';
    plan.shouldAskClarification = true;
    plan.clarificationQuestion = clarifyWhichService();
    plan.hasData = false;
    return plan;
  }

  if (serviceMatch.type === 'ambiguous') {
    // Multiple services matched - need to ask for clarification
    plan.answerMode = 'CLARIFY';
    plan.shouldAskClarification = true;
    const options = serviceMatch.matches.slice(0, 3).map(m => m.service.displayName).join('、');
    plan.clarificationQuestion = clarifyPickOne(options);
    plan.hasData = false;
    return plan;
  }

  // Exact or close match - extract facts
  const service = serviceMatch.matches[0].service;
  plan.selectedService = service.code;
  plan.serviceDisplayName = service.displayName;

  // Extract facts based on field priority
  const facts = extractFacts(service, plan.fieldPriority);
  plan.facts = facts;

  // Check for missing required fields
  const requiredFields = getRequiredFields(intent);
  plan.missingFields = requiredFields.filter(field => !hasFieldValue(service, field));

  // Determine answer mode
  if (plan.missingFields.length > 0 && intent === 'PRICE') {
    // Price questions MUST have price data - handoff if missing
    plan.hasData = false;
    plan.shouldHandoff = false; // Don't handoff, just say no data
  } else if (plan.missingFields.length > 0) {
    // Other intents can still answer with available data
    plan.hasData = Object.values(facts).some(v => v !== undefined && v !== null && v !== '');
  } else {
    plan.hasData = true;
  }

  plan.answerMode = plan.hasData ? 'DIRECT' : 'UNKNOWN';

  return plan;
}

// ── Helper functions ──────────────────────────────────────────────────────────────

/**
 * Extract facts from service based on field priority order.
 */
function extractFacts(service: ServiceEntry, fieldPriority: string[]): AnswerPlan['facts'] {
  const facts: AnswerPlan['facts'] = {};

  for (const field of fieldPriority) {
    const value = getServiceField(service, field);
    if (value !== null && value !== undefined && value !== '') {
      // Map field to facts object
      switch (field) {
        case 'discountPrice':
          facts.discountPrice = value as string;
          break;
        case 'price':
          facts.price = value as string;
          break;
        case 'effect':
          facts.effect = value as string;
          break;
        case 'precaution':
          facts.precaution = value as string;
          break;
        case 'suitable':
          facts.suitable = value as string;
          break;
        case 'unsuitable':
          facts.unsuitable = value as string;
          break;
        case 'duration':
          facts.duration = value as string;
          break;
        case 'steps':
          facts.steps = value as string[];
          break;
        case 'faqItems':
          facts.faqItems = value as Array<{ question: string; answer: string }>;
          break;
        case 'content':
          facts.content = value as string;
          break;
      }
    }
  }

  return facts;
}

/**
 * Get a field value from service entry.
 */
function getServiceField(service: ServiceEntry, field: string): string | string[] | Array<{ question: string; answer: string }> | null {
  const fieldMap: Record<string, keyof ServiceEntry> = {
    discountPrice: 'discountPrice',
    price: 'price',
    effect: 'effect',
    precaution: 'precaution',
    suitable: 'suitable',
    unsuitable: 'unsuitable',
    duration: 'duration',
    steps: 'steps',
    faqItems: 'faqItems',
    content: 'fullInfo',
  };

  const key = fieldMap[field];
  if (!key) return null;

  const value = service[key];

  // For steps and faqItems, convert array to appropriate format
  if (key === 'steps' && Array.isArray(value)) {
    return value as string[];
  }
  if (key === 'faqItems' && Array.isArray(value)) {
    return value as Array<{ question: string; answer: string }>;
  }

  // For fullInfo, use fullInfo field
  if (key === 'fullInfo') {
    return service.fullInfo || null;
  }

  // For string fields, check if empty
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  return value as string | null;
}

/**
 * Check if service has a meaningful value for a field.
 *
 * Meaningful value criteria:
 * - String: non-empty after trim (length > 0)
 * - Array: at least one element
 * - Object (faqItems): at least one item with both question and answer
 *
 * Note: We do NOT use minimum length threshold (like >= 4 chars) because
       short values like "是" or "無" can be valid answers.
 */
function hasFieldValue(service: ServiceEntry, field: string): boolean {
  const value = getServiceField(service, field);
  if (value === null || value === undefined) return false;

  // String: check non-empty after trim
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  // Array: check at least one element
  if (Array.isArray(value)) {
    if (value.length === 0) return false;
    // For steps array, any non-empty string element counts
    if (typeof value[0] === 'string') {
      return value.some(s => typeof s === 'string' && s.trim().length > 0);
    }
    // For faqItems, check for valid structure
    if (typeof value[0] === 'object') {
      const faqArr = value as Array<{ question: string; answer: string }>;
      return faqArr.some(item => item.question && item.answer);
    }
    return value.length > 0;
  }

  return false;
}

/**
 * Get required fields for each intent type.
 * These are fields that MUST be present for a good answer.
 */
function getRequiredFields(intent: QuestionIntent): string[] {
  const requiredMap: Record<QuestionIntent, string[]> = {
    PRICE:        ['price'],
    DISCOUNT:     ['discountPrice'],
    EFFECT:       ['effect'],
    PRECAUTION:   ['precaution'],
    SUITABLE:     ['suitable'],
    UNSUITABLE:   ['unsuitable'],
    DURATION:     ['duration'],
    PROCESS:      ['steps'],
    FAQ:          ['faqItems'],
    COMPARISON:   ['effect'],
    BOOKING_INIT: [],
    BOOKING_MODIFY: [],
    FOLLOW_UP:    [],
    CLARIFICATION: [],
    OBJECTION:    [],
    UNKNOWN:      [],
  };
  return requiredMap[intent] || [];
}

// ── Map question-router types to QuestionIntent ───────────────────────────────────

/**
 * Convert question-router QuestionType to Answer Planner QuestionIntent.
 */
export function questionTypeToIntent(qt: QuestionType): QuestionIntent {
  const mapping: Record<QuestionType, QuestionIntent> = {
    'service_price': 'PRICE',
    'service_effect': 'EFFECT',
    'service_precaution': 'PRECAUTION',
    'service_suitable_for': 'SUITABLE',
    'service_unsuitable_for': 'UNSUITABLE',
    'service_duration': 'DURATION',
    'service_procedure': 'PROCESS',
    'service_aftercare': 'PRECAUTION', // Aftercare maps to precaution
    'service_expected_result': 'EFFECT', // Expected result maps to effect
    'faq_deposit': 'FAQ',
    'faq_payment': 'FAQ',
    'faq_first_visit': 'FAQ',
    'faq_cancellation': 'FAQ',
    'faq_hours': 'FAQ',
    'faq_safety': 'FAQ',
    'faq_general': 'FAQ',
    'unknown': 'UNKNOWN',
  };
  return mapping[qt] || 'UNKNOWN';
}

// ── Missing field response generator ─────────────────────────────────────────────

/**
 * Generate honest response when required fields are missing.
 * This is the ONLY place where "no data" responses are generated.
 */
export function generateMissingFieldResponse(
  serviceName: string,
  missingFields: string[],
  intent: QuestionIntent,
): string {
  // Field labels for user-friendly messages
  const fieldLabels: Record<string, string> = {
    price: '價錢',
    discountPrice: '優惠價',
    effect: '功效',
    precaution: '注意事項',
    suitable: '適合對象',
    unsuitable: '不適合對象',
    duration: '時長',
    steps: '步驟',
    faqItems: '常見問題',
  };

  if (intent === 'PRICE') {
    return missingFieldPriceHonesty(serviceName);
  }

  const missingLabels = missingFields.map(f => fieldLabels[f] || f).join('、');
  return missingFieldOtherHonesty(serviceName, missingLabels);
}

// ── Regression tests ─────────────────────────────────────────────────────────────

export function verifyAnswerPlannerRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test service with all fields
  const fullService: ServiceEntry = {
    code: 'hifu',
    displayName: 'HIFU 緊緻',
    aliases: ['hifu', '緊緻'],
    priceInfo: 'HKD 1200',
    fullInfo: 'HIFU 緊緻\n功效：拉提緊緻',
    effect: '拉提緊緻，改善輪廓',
    suitable: '皮膚鬆弛人士',
    unsuitable: '孕婦、心臟起搏器佩戴者',
    precaution: '術後避免暴曬',
    duration: '60-90 分鐘',
    price: 'HKD 1200',
    discountPrice: 'HKD 880',
    steps: ['清潔', '塗抹凝膠', '儀器操作', '清潔', '保濕'],
  };

  // Test: PRICE intent uses discountPrice first
  const priceMatch: ServiceMatchResult = { type: 'exact', matches: [{ service: fullService, confidence: 1.0 }] };
  const pricePlan = planAnswer('PRICE', priceMatch, []);
  if (pricePlan.facts.discountPrice !== 'HKD 880') {
    failures.push(`PRICE: expected discountPrice=HKD 880, got ${pricePlan.facts.discountPrice}`);
  }
  if (!pricePlan.hasData) {
    failures.push(`PRICE: expected hasData=true`);
  }
  if (pricePlan.missingFields.length > 0) {
    failures.push(`PRICE: expected no missing fields, got ${pricePlan.missingFields.join(', ')}`);
  }

  // Test: EFFECT intent uses effect field
  const effectPlan = planAnswer('EFFECT', priceMatch, []);
  if (effectPlan.facts.effect !== '拉提緊緻，改善輪廓') {
    failures.push(`EFFECT: expected effect=拉提緊緻，改善輪廓, got ${effectPlan.facts.effect}`);
  }

  // Test: PRECAUTION intent uses precaution field
  const precautionPlan = planAnswer('PRECAUTION', priceMatch, []);
  if (precautionPlan.facts.precaution !== '術後避免暴曬') {
    failures.push(`PRECAUTION: expected precaution=術後避免暴曬, got ${precautionPlan.facts.precaution}`);
  }

  // Test: SUITABLE intent uses suitable field
  const suitablePlan = planAnswer('SUITABLE', priceMatch, []);
  if (suitablePlan.facts.suitable !== '皮膚鬆弛人士') {
    failures.push(`SUITABLE: expected suitable=皮膚鬆弛人士, got ${suitablePlan.facts.suitable}`);
  }

  // Test: UNSUITABLE intent uses unsuitable field
  const unsuitablePlan = planAnswer('UNSUITABLE', priceMatch, []);
  if (unsuitablePlan.facts.unsuitable !== '孕婦、心臟起搏器佩戴者') {
    failures.push(`UNSUITABLE: expected unsuitable=孕婦、心臟起搏器佩戴者, got ${unsuitablePlan.facts.unsuitable}`);
  }

  // Test service with missing fields
  const partialService: ServiceEntry = {
    code: 'facial',
    displayName: '深層清潔 Facial',
    aliases: ['facial'],
    priceInfo: 'HKD 680',
    fullInfo: '深層清潔 Facial\n功效：深層清潔',
    effect: '深層清潔毛孔',
    // Missing: suitable, unsuitable, precaution, duration, steps, price
  };

  const partialMatch: ServiceMatchResult = { type: 'exact', matches: [{ service: partialService, confidence: 1.0 }] };

  // Test: PRECAUTION with missing field
  const missingPrecautionPlan = planAnswer('PRECAUTION', partialMatch, []);
  if (missingPrecautionPlan.facts.precaution !== undefined) {
    failures.push(`PRECAUTION (missing): expected undefined, got ${missingPrecautionPlan.facts.precaution}`);
  }
  if (!missingPrecautionPlan.missingFields.includes('precaution')) {
    failures.push(`PRECAUTION (missing): expected missingFields to include precaution`);
  }

  // Test: PRICE with missing field - should have empty discountPrice/price
  const missingPricePlan = planAnswer('PRICE', partialMatch, []);
  if (missingPricePlan.hasData) {
    failures.push(`PRICE (missing): expected hasData=false`);
  }
  if (!missingPricePlan.missingFields.includes('price')) {
    failures.push(`PRICE (missing): expected missingFields to include price`);
  }

  // Test: No service match
  const noMatch: ServiceMatchResult = { type: 'none', matches: [] };
  const noServicePlan = planAnswer('PRICE', noMatch, []);
  if (noServicePlan.answerMode !== 'CLARIFY') {
    failures.push(`No match: expected answerMode=CLARIFY, got ${noServicePlan.answerMode}`);
  }
  if (!noServicePlan.shouldAskClarification) {
    failures.push(`No match: expected shouldAskClarification=true`);
  }

  // Test: Ambiguous service match
  const ambMatch: ServiceMatchResult = {
    type: 'ambiguous',
    matches: [
      { service: fullService, confidence: 0.85 },
      { service: partialService, confidence: 0.80 },
    ],
  };
  const ambPlan = planAnswer('EFFECT', ambMatch, []);
  if (ambPlan.answerMode !== 'CLARIFY') {
    failures.push(`Ambiguous: expected answerMode=CLARIFY, got ${ambPlan.answerMode}`);
  }

  return { ok: failures.length === 0, failures };
}

// ── Export types ─────────────────────────────────────────────────────────────────

export type { ServiceEntry, ServiceMatchResult } from './types';