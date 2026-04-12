/**
 * unknown-handler.ts
 *
 * Phase 1.5B — Graceful unknown + handoff
 *
 * When the system cannot answer a question, provide a helpful response
 * instead of a generic fallback. Distinguish between:
 * - Valid business questions (should offer to check/follow up)
 * - Casual chat / greetings (use friendly fallback)
 * - Incomprehensible input (ask for clarification)
 *
 * Phase 1C — Reply wording comes from unknown-response-policy.ts (classification unchanged).
 */

import {
  replyForUnknownType,
  unknownAskMoreDetail,
  unknownCasualFollowUp,
  unknownShortPrompt,
} from './unknown-response-policy';

// ── Pattern definitions ───────────────────────────────────────────────────────

// Patterns that suggest a valid business question (even if we don't know the answer)
const BUSINESS_QUESTION_PATTERNS: RegExp[] = [
  // Service-related questions
  /有冇|有無|係咪|係唔係|會唔會|可唔可以|能不能|是否/i,
  /幾多|幾耐|幾時|幾錢|價錢|收費|費用/i,
  /邊個|邊啲|邊類|什麼|甚麼|哪個|哪些/i,
  /點樣|點做|如何|怎樣|怎麼/i,
  /為什麼|點解|原因/i,
  /功效|效果|好處|壞處|風險|副作用/i,
  /適合|唔適合|建議|推薦/i,
  /可以|可否|能否|得唔得/i,
  // Question particles
  /\?|？|嗎|呢|呀|喔|哇$/,
];

// Patterns that suggest casual chat or simple greetings
const CASUAL_CHAT_PATTERNS: RegExp[] = [
  /^hi$|^hello$|^你好$|^嗨$|^hey$/i,
  /^ok$|^好$|^okay$|^收到$|^明白$|^了解$/i,
  /^thx$|^thanks$|^多謝$|^謝謝$/i,
  /^bye$|^再見$|^拜拜$/i,
  /^好$|^唔錯$|^ok啦$|^ok$/i,
];

// Patterns that suggest the user is asking something specific but unclear
const NEEDS_CLARIFICATION_PATTERNS: RegExp[] = [
  /^\.+$/,
  /^[?？]{2,}$/,
  /^[0-9]+$/,
  /^[a-zA-Z]$/,
];

// ── Classification result ────────────────────────────────────────────────────

export type UnknownType =
  | 'business_question'   // Looks like a real question we can't answer
  | 'casual_chat'          // Greeting, thanks, etc.
  | 'needs_clarification' // Unclear input
  | 'short_input';         // Very short, hard to classify

export interface UnknownResult {
  type: UnknownType;
  confidence: number;
  suggestedReply: string;
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify unknown input and provide appropriate response.
 */
export function classifyUnknown(message: string): UnknownResult {
  const msg = message.trim();
  const len = msg.length;

  // Check if matches casual chat FIRST (before short input check)
  for (const pattern of CASUAL_CHAT_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        type: 'casual_chat',
        confidence: 0.95,
        suggestedReply: unknownCasualFollowUp(),
      };
    }
  }

  // Check if matches needs clarification
  for (const pattern of NEEDS_CLARIFICATION_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        type: 'needs_clarification',
        confidence: 0.9,
        suggestedReply: unknownAskMoreDetail(),
      };
    }
  }

  // Very short input (1-2 chars) → needs clarification
  if (len <= 2) {
    return {
      type: 'short_input',
      confidence: 0.9,
      suggestedReply: unknownShortPrompt(),
    };
  }

  // Check if matches business question patterns
  let businessScore = 0;
  for (const pattern of BUSINESS_QUESTION_PATTERNS) {
    if (pattern.test(msg)) {
      businessScore += 1;
    }
  }

  // If multiple patterns match, it's likely a business question
  if (businessScore >= 2) {
    return {
      type: 'business_question',
      confidence: 0.85,
      suggestedReply: replyForUnknownType('business_question', msg.toLowerCase()),
    };
  }

  // Single pattern match - might be business question
  if (businessScore === 1) {
    // Check for question structure
    if (/\?|？|嗎|呢|呀$/.test(msg)) {
      return {
        type: 'business_question',
        confidence: 0.7,
        suggestedReply: replyForUnknownType('business_question', msg.toLowerCase()),
      };
    }
  }

  // Default: treat as business question with lower confidence
  // Better to offer help than dismiss
  return {
    type: 'business_question',
    confidence: 0.6,
    suggestedReply: replyForUnknownType('business_question', msg.toLowerCase()),
  };
}

// ── Regression tests ───────────────────────────────────────────────────────────

export function verifyUnknownHandlerRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  function check(label: string, msg: string, expectedType: UnknownType) {
    const result = classifyUnknown(msg);
    if (result.type !== expectedType) {
      failures.push(`${label}: got "${result.type}", want "${expectedType}" (msg="${msg}")`);
    }
  }

  // Business questions
  check('price', '呢個療程幾錢呀', 'business_question');
  check('service', '敏感肌做唔做得HIFU?', 'business_question');
  check('availability', '星期六有冇位', 'business_question');
  check('specific', '你哋有冇做熱石按摩', 'business_question');

  // Casual chat
  check('hi', 'hi', 'casual_chat');
  check('ok', 'ok', 'casual_chat');
  check('thanks', 'thx', 'casual_chat');
  check('bye', 'bye', 'casual_chat');

  // Short input
  check('single', '?', 'short_input');
  check('two chars', 'ok啦', 'casual_chat');

  // Needs clarification
  check('dots', '...', 'needs_clarification');

  return { ok: failures.length === 0, failures };
}