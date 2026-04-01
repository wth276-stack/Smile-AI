/**
 * handoff-trigger.ts
 *
 * P7 Lite: High-risk handoff detection.
 * Per ChatGPT safety advice: "有啲單唔係『答錯』，而係『唔應該繼續自動答』"
 *
 * Handoff triggers:
 * 1. Same booking changed >= 2 times (too many corrections)
 * 2. Ambiguous datetime (e.g., "今晚" without specific time, vague dates)
 * 3. Low confidence service match (ambiguous service selection)
 * 4. Special request detected (custom needs, medical concerns, etc.)
 *
 * When triggered, we should NOT auto-confirm — route to human agent.
 */

import type { BookingDraft, ServiceMatchResult } from './types';
import { handoffReplyForTrigger } from './unknown-response-policy';

// ── Handoff Trigger Types ─────────────────────────────────────────────────────

export type HandoffTriggerType =
  | 'multiple_corrections'      // Booking changed >= 2 times
  | 'ambiguous_datetime'        // Vague time expression
  | 'low_confidence_service'    // Ambiguous service selection
  | 'special_request'           // Customer has special requirements
  | 'explicit_handoff';         // User explicitly asked for human

export interface HandoffResult {
  /** Whether handoff should be triggered. */
  shouldHandoff: boolean;
  /** Type of trigger (if any). */
  triggerType: HandoffTriggerType | null;
  /** Human-readable reason for handoff. */
  reason: string | null;
  /** Suggested reply (if handoff triggered). */
  reply: string | null;
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface HandoffConfig {
  /** Maximum number of booking corrections before handoff. */
  maxCorrections: number;
  /** Minimum confidence for service match (below = handoff). */
  minServiceConfidence: number;
}

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  maxCorrections: 2,
  minServiceConfidence: 0.7,
};

// ── Detection Patterns ───────────────────────────────────────────────────────

/** Vague time expressions that need human clarification. */
const AMBIGUOUS_TIME_PATTERNS = [
  /今晚$/,
  /聽日$/,
  /明天$/,
  /後天$/,
  /下晝$/,
  /上午$/,
  /下午$/,
  /朝早$/,
  /晚黑$/,
  /夜晚$/,
  /中午$/,
  /傍晚$/,
  /任何時間/,
  /幾時都得/,
  /你安排/,
  /睇你點/,
  /隨便/,
  /隨便安排/,
];

/** Vague date-only patterns (time missing). */
const VAGUE_DATE_PATTERNS = [
  /星期[一二三四五六日]$/,
  /週[一二三四五六日]$/,
];

/** Special request patterns. */
const SPECIAL_REQUEST_PATTERNS = [
  /特殊/,
  /特別要求/,
  /有病/,
  /敏感/,
  /過敏/,
  /藥物/,
  /懷孕/,
  /孕婦/,
  /哺乳/,
  /皮膚問題/,
  /疾病/,
  /醫生/,
  /注意/,
  /要求特別/,
  /需要特別/,
  /唔[識得]?講/,
  /講唔清楚/,
  /想問清楚/,
  /好多嘢想問/,
  /可以傾下/,
  /想了解多[啲点]/,
];

/** Explicit handoff request patterns. */
const EXPLICIT_HANDOFF_PATTERNS = [
  /真人/,
  /人工/,
  /客服/,
  /同事/,
  /manager/,
  /職員/,
  /店長/,
  /想同真人講/,
  /唔想同機器講/,
];

// ── Detection Functions ───────────────────────────────────────────────────────

/**
 * Detect if message has ambiguous datetime.
 * Returns true if user gave a vague time reference without specific time.
 */
function detectAmbiguousDatetime(message: string, draft: BookingDraft): { detected: boolean; reason: string | null } {
  // If time is already set, no ambiguity
  if (draft.time) {
    return { detected: false, reason: null };
  }

  // Check for ambiguous time expressions
  for (const pattern of AMBIGUOUS_TIME_PATTERNS) {
    if (pattern.test(message)) {
      return {
        detected: true,
        reason: '時間表達含糊，需要明確時間才能安排預約。',
      };
    }
  }

  // Check for vague date-only (day of week without time)
  for (const pattern of VAGUE_DATE_PATTERNS) {
    if (pattern.test(message)) {
      return {
        detected: true,
        reason: '日期表達含糊，請提供具體日期同時間。',
      };
    }
  }

  return { detected: false, reason: null };
}

/**
 * Detect low confidence service match.
 */
function detectLowConfidenceService(serviceMatch: ServiceMatchResult, config: HandoffConfig): { detected: boolean; reason: string | null } {
  if (serviceMatch.type === 'ambiguous') {
    return {
      detected: true,
      reason: '服務匹配唔夠肯定，需要進一步確認。',
    };
  }

  if (serviceMatch.type === 'close' || serviceMatch.type === 'exact') {
    const topMatch = serviceMatch.matches[0];
    if (topMatch && topMatch.confidence < config.minServiceConfidence) {
      return {
        detected: true,
        reason: `服務匹配信心較低（${(topMatch.confidence * 100).toFixed(0)}%），建議人工確認。`,
      };
    }
  }

  return { detected: false, reason: null };
}

/**
 * Detect special request in message.
 */
function detectSpecialRequest(message: string): { detected: boolean; reason: string | null } {
  for (const pattern of SPECIAL_REQUEST_PATTERNS) {
    if (pattern.test(message)) {
      return {
        detected: true,
        reason: '客人有特殊要求，需要人工跟進。',
      };
    }
  }

  return { detected: false, reason: null };
}

/**
 * Detect explicit handoff request.
 */
function detectExplicitHandoff(message: string): { detected: boolean; reason: string | null } {
  for (const pattern of EXPLICIT_HANDOFF_PATTERNS) {
    if (pattern.test(message)) {
      return {
        detected: true,
        reason: '客人明確要求轉接真人。',
      };
    }
  }

  return { detected: false, reason: null };
}

// ── Main Handoff Check Function ───────────────────────────────────────────────

export interface HandoffCheckInput {
  message: string;
  draft: BookingDraft;
  serviceMatch: ServiceMatchResult;
  /** Number of times the booking has been corrected/updated. */
  correctionCount: number;
  /** Current conversation mode. */
  conversationMode: string;
}

/**
 * Check if handoff should be triggered based on multiple risk factors.
 * Priority: explicit_handoff > special_request > ambiguous_datetime > low_confidence > multiple_corrections
 */
export function checkHandoffTrigger(
  input: HandoffCheckInput,
  config: HandoffConfig = DEFAULT_HANDOFF_CONFIG,
): HandoffResult {
  const { message, draft, serviceMatch, correctionCount, conversationMode } = input;

  // Priority 1: Explicit handoff request
  const explicitCheck = detectExplicitHandoff(message);
  if (explicitCheck.detected) {
    return {
      shouldHandoff: true,
      triggerType: 'explicit_handoff',
      reason: explicitCheck.reason,
      reply: handoffReplyForTrigger('explicit_handoff'),
    };
  }

  // Priority 2: Special request
  const specialCheck = detectSpecialRequest(message);
  if (specialCheck.detected) {
    return {
      shouldHandoff: true,
      triggerType: 'special_request',
      reason: specialCheck.reason,
      reply: handoffReplyForTrigger('special_request'),
    };
  }

  // Priority 3: Ambiguous datetime (only in booking mode)
  if (conversationMode === 'BOOKING_DRAFT' || conversationMode === 'CONFIRMATION_PENDING') {
    const timeCheck = detectAmbiguousDatetime(message, draft);
    if (timeCheck.detected) {
      // For ambiguous datetime, we DON'T handoff immediately — we ask for clarification
      // But if it's the 2nd ambiguous message, then handoff
      return {
        shouldHandoff: false,
        triggerType: 'ambiguous_datetime',
        reason: timeCheck.reason,
        reply: null, // Let the normal flow ask for clarification
      };
    }
  }

  // Priority 4: Low confidence service match (only in booking context)
  if (conversationMode === 'BOOKING_DRAFT' || conversationMode === 'CONFIRMATION_PENDING') {
    const serviceCheck = detectLowConfidenceService(serviceMatch, config);
    if (serviceCheck.detected) {
      // For low confidence, ask for clarification first (already handled in composeBookingResponse)
      return {
        shouldHandoff: false,
        triggerType: 'low_confidence_service',
        reason: serviceCheck.reason,
        reply: null,
      };
    }
  }

  // Priority 5: Multiple corrections (>= 2 changes to same booking)
  if (correctionCount >= config.maxCorrections) {
    return {
      shouldHandoff: true,
      triggerType: 'multiple_corrections',
      reason: `預約已改動 ${correctionCount} 次，建議人工確認避免出錯。`,
      reply: handoffReplyForTrigger('multiple_corrections'),
    };
  }

  // No handoff triggered
  return {
    shouldHandoff: false,
    triggerType: null,
    reason: null,
    reply: null,
  };
}

/**
 * Count booking corrections based on conversation history.
 * This is a simplified version — in production, you'd track this in DB.
 */
export function countBookingCorrections(
  messages: Array<{ sender: string; content: string }>,
  draft: BookingDraft,
): number {
  // Count messages that look like corrections
  const correctionPatterns = [
    /改為/,
    /改成/,
    /唔係/,
    /錯咗/,
    /唔係呢個/,
    /換/,
    /轉/,
  ];

  let count = 0;
  for (const msg of messages) {
    if (msg.sender === 'CUSTOMER') {
      for (const pattern of correctionPatterns) {
        if (pattern.test(msg.content)) {
          count++;
          break;
        }
      }
    }
  }

  return count;
}

// ── Regression Tests ─────────────────────────────────────────────────────────

export function verifyHandoffTriggerRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const baseDraft: BookingDraft = {
    serviceName: 'facial',
    serviceDisplayName: 'Facial',
    date: '2026-04-01',
    time: null,
    customerName: 'Test',
    phone: '12345678',
  };

  // Test 1: Explicit handoff
  const r1 = checkHandoffTrigger({
    message: '我想搵真人',
    draft: baseDraft,
    serviceMatch: { type: 'exact', matches: [] },
    correctionCount: 0,
    conversationMode: 'BOOKING_DRAFT',
  });
  if (!r1.shouldHandoff) {
    failures.push('Test 1: Explicit handoff should trigger');
  }
  if (r1.triggerType !== 'explicit_handoff') {
    failures.push(`Test 1: Expected explicit_handoff, got ${r1.triggerType}`);
  }
  if (!r1.reply?.includes('同事')) {
    failures.push(`Test 1: handoff reply should mention human follow-up, got ${r1.reply}`);
  }

  // Test 2: Special request
  const r2 = checkHandoffTrigger({
    message: '我有皮膚敏感，想問下適唔適合做',
    draft: baseDraft,
    serviceMatch: { type: 'exact', matches: [] },
    correctionCount: 0,
    conversationMode: 'INQUIRY',
  });
  if (!r2.shouldHandoff) {
    failures.push('Test 2: Special request should trigger');
  }
  if (r2.triggerType !== 'special_request') {
    failures.push(`Test 2: Expected special_request, got ${r2.triggerType}`);
  }

  // Test 3: Ambiguous datetime (time not set)
  const r3 = checkHandoffTrigger({
    message: '我想今晚',
    draft: { ...baseDraft, time: null },
    serviceMatch: { type: 'exact', matches: [] },
    correctionCount: 0,
    conversationMode: 'BOOKING_DRAFT',
  });
  if (r3.shouldHandoff) {
    failures.push('Test 3: First ambiguous datetime should NOT handoff (ask clarification first)');
  }
  if (r3.triggerType !== 'ambiguous_datetime') {
    failures.push(`Test 3: Expected ambiguous_datetime trigger type, got ${r3.triggerType}`);
  }

  // Test 4: Multiple corrections
  const r4 = checkHandoffTrigger({
    message: '改為下晝三點',
    draft: baseDraft,
    serviceMatch: { type: 'exact', matches: [] },
    correctionCount: 2,
    conversationMode: 'CONFIRMATION_PENDING',
  });
  if (!r4.shouldHandoff) {
    failures.push('Test 4: 2+ corrections should trigger handoff');
  }
  if (r4.triggerType !== 'multiple_corrections') {
    failures.push(`Test 4: Expected multiple_corrections, got ${r4.triggerType}`);
  }

  // Test 5: No trigger for normal message
  const r5 = checkHandoffTrigger({
    message: '我想約星期三下午三點',
    draft: baseDraft,
    serviceMatch: { type: 'exact', matches: [{ service: { code: 'facial', displayName: 'Facial', aliases: [], priceInfo: null, fullInfo: '' }, confidence: 0.9 }] },
    correctionCount: 0,
    conversationMode: 'BOOKING_DRAFT',
  });
  if (r5.shouldHandoff) {
    failures.push(`Test 5: Normal booking should not handoff, got ${r5.triggerType}`);
  }

  return { ok: failures.length === 0, failures };
}