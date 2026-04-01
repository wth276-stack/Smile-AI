/**
 * strategy-selector.ts
 *
 * Defines the Strategy Selector - the core decision engine that determines
 * what the AI should do next based on stage and customer signals.
 *
 * Key principle: "Strategy before phrasing"
 * First decide WHAT to do, then HOW to say it.
 */

import type { ConversationStage } from './conversation-stage';
import type { EmotionType, ResistanceType, ReadinessLevel, TrustLevel, CustomerStyle } from './customer-signals';
import {
  getRiskLevel,
  getRiskModifier,
  assignExperimentGroup,
  applyExperimentAdjustments,
  shouldHandoffByRisk,
  type ExperimentGroup,
} from './risk-config';

// ── Strategy Types ─────────────────────────────────────────────────────────────

/**
 * High-level strategy for the current response.
 * This determines the approach, not the exact words.
 */
export type ConversationStrategy =
  // Information strategies
  | 'provide_info'        // Give requested information
  | 'clarify_need'        // Ask questions to understand
  | 'educate'             // Proactively explain benefits

  // Engagement strategies
  | 'build_rapport'       // Focus on relationship
  | 'discover_need'       // Explore customer needs
  | 'validate_understanding' // Confirm we understood correctly

  // Sales strategies
  | 'recommend'           // Suggest a service/product
  | 'present_value'       // Explain value proposition
  | 'handle_objection'    // Address concerns
  | 'offer_alternatives'  // Provide options
  | 'soft_close'          // Gentle push toward decision
  | 'hard_close'          // Direct call to action (use sparingly)

  // Booking strategies
  | 'collect_slots'       // Gather booking details
  | 'confirm_booking'     // Ask for confirmation
  | 'handle_change'       // Handle booking modifications

  // Service strategies
  | 'acknowledge_issue'  // Acknowledge problem
  | 'repair_relationship' // Try to fix issues
  | 'deescalate'          // Reduce tension
  | 'escalate'            // Hand off to human

  // Closing strategies
  | 'follow_up'           // Check in after service
  | 'upsell'              // Suggest add-ons
  | 'graceful_close';     // End conversation naturally

/**
 * Response urgency level.
 */
export type ResponseUrgency = 'immediate' | 'normal' | 'delayed';

/**
 * Tone for the response.
 */
export type ResponseTone = 'formal' | 'friendly' | 'casual' | 'empathetic' | 'professional' | 'direct' | 'analytical';

// ── Strategy Configuration ────────────────────────────────────────────────────

/**
 * Strategy configuration for a given context.
 */
export interface StrategyConfig {
  strategy: ConversationStrategy;
  priority: 'primary' | 'secondary' | 'fallback';
  reason: string;

  // What the response MUST include
  mustDo: string[];

  // What the response SHOULD try to include if possible
  niceToDo: string[];

  // What the response MUST NOT include
  forbidden: string[];

  // Tone and urgency
  tone: ResponseTone;
  urgency: ResponseUrgency;

  // Whether to escalate to human
  shouldEscalate: boolean;

  // Whether to push toward booking
  shouldPushBooking: boolean;
}

// ── Strategy Selection Context ───────────────────────────────────────────────

/**
 * Context for strategy selection.
 */
export interface StrategySelectionContext {
  stage: ConversationStage;
  emotion: EmotionType;
  resistance: ResistanceType;
  readiness: ReadinessLevel;
  trust: TrustLevel;
  style: CustomerStyle;
  riskScore: number;
  engagementScore: number;

  // Additional context
  topicHistory: string[];
  conversationTurn: number;
  message: string;
  intent: string;
}

// ── Strategy Rules ────────────────────────────────────────────────────────────

/**
 * Rule for selecting strategy based on conditions.
 */
interface StrategyRule {
  name: string;
  condition: (ctx: StrategySelectionContext) => boolean;
  strategy: ConversationStrategy;
  mustDo: string[];
  niceToDo: string[];
  forbidden: string[];
  tone: ResponseTone;
  urgency: ResponseUrgency;
  shouldEscalate: boolean;
  shouldPushBooking: boolean;
}

// ── Core Strategy Rules ───────────────────────────────────────────────────────

const STRATEGY_RULES: StrategyRule[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // GREETING STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'greeting_rapport',
    condition: (ctx) => ctx.stage === 'greeting' && ctx.trust >= 2,
    strategy: 'build_rapport',
    mustDo: ['acknowledge_customer', 'ask_need'],
    niceToDo: ['offer_help', 'introduce_briefly'],
    forbidden: ['upsell', 'push_booking', 'ask_contact'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'greeting_cautious',
    condition: (ctx) => ctx.stage === 'greeting' && ctx.trust < 2,
    strategy: 'build_rapport',
    mustDo: ['acknowledge_customer', 'offer_help'],
    niceToDo: ['ask_need'],
    forbidden: ['upsell', 'push_booking', 'ask_contact', 'ask_personal_questions'],
    tone: 'professional',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DISCOVER STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'discover_need',
    condition: (ctx) => ctx.stage === 'discover' && ctx.resistance === 'none',
    strategy: 'discover_need',
    mustDo: ['ask_open_question', 'listen_actively'],
    niceToDo: ['offer_context', 'show_interest'],
    forbidden: ['recommend_before_understanding', 'push_booking'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'discover_confused',
    condition: (ctx) => ctx.stage === 'discover' && ctx.emotion === 'confused',
    strategy: 'clarify_need',
    mustDo: ['simplify_question', 'offer_options'],
    niceToDo: ['provide_example'],
    forbidden: ['complex_explanations', 'push_booking'],
    tone: 'empathetic',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ANSWER / INFO STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'answer_direct',
    condition: (ctx) => ctx.stage === 'answer' && ctx.style === 'direct' && ctx.trust >= 2,
    strategy: 'provide_info',
    mustDo: ['give_answer', 'check_understanding'],
    niceToDo: ['offer_more'],
    forbidden: ['long_explanations', 'irrelevant_info'],
    tone: 'professional',
    urgency: 'immediate',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'answer_analytical',
    condition: (ctx) => ctx.stage === 'answer' && ctx.style === 'analytical',
    strategy: 'provide_info',
    mustDo: ['give_answer', 'provide_details', 'offer_comparison'],
    niceToDo: ['provide_spec', 'cite_source'],
    forbidden: ['vague_answers', 'push_booking'],
    tone: 'professional',
    urgency: 'immediate',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'answer_social',
    condition: (ctx) => ctx.stage === 'answer' && ctx.style === 'social',
    strategy: 'provide_info',
    mustDo: ['give_answer', 'engage_conversationally'],
    niceToDo: ['relate_to_their_situation', 'share_story'],
    forbidden: ['dry_facts_only', 'push_booking'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMEND STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'recommend_ready',
    condition: (ctx) => ctx.stage === 'recommend' && ctx.readiness >= 3 && ctx.resistance === 'none',
    strategy: 'recommend',
    mustDo: ['present_service', 'explain_benefit', 'ask_interest'],
    niceToDo: ['offer_comparison', 'share_testimonial'],
    forbidden: ['push_booking_without_interest', 'hard_sell'],
    tone: 'professional',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'recommend_hesitant',
    condition: (ctx) => ctx.stage === 'recommend' && ctx.resistance !== 'none',
    strategy: 'handle_objection',
    mustDo: ['acknowledge_concern', 'address_objection', 'check_resolution'],
    niceToDo: ['offer_alternatives', 'provide_proof'],
    forbidden: ['push_booking', 'dismissive_response'],
    tone: 'empathetic',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OBJECTION STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'objection_price',
    condition: (ctx) => ctx.stage === 'objection' && ctx.resistance === 'price',
    strategy: 'present_value',
    mustDo: ['acknowledge_price_concern', 'clarify_value', 'offer_alternatives'],
    niceToDo: ['quantify_benefit', 'share_result_expectation'],
    forbidden: ['random_discount', 'hard_push', 'pressure'],
    tone: 'empathetic',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'objection_trust',
    condition: (ctx) => ctx.stage === 'objection' && ctx.resistance === 'trust',
    strategy: 'build_rapport',
    mustDo: ['acknowledge_concern', 'provide_proof', 'offer_reassurance'],
    niceToDo: ['share_testimonial', 'offer_consultation'],
    forbidden: ['push_booking', 'dismissive_response', 'pressure'],
    tone: 'empathetic',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'objection_timing',
    condition: (ctx) => ctx.stage === 'objection' && ctx.resistance === 'timing',
    strategy: 'offer_alternatives',
    mustDo: ['acknowledge_timing', 'offer_flexibility', 'leave_open'],
    niceToDo: ['suggest_future_follow', 'offer_reminder'],
    forbidden: ['pressure', 'hard_close', 'create_urgency_artificially'],
    tone: 'friendly',
    urgency: 'delayed',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
  {
    name: 'objection_need',
    condition: (ctx) => ctx.stage === 'objection' && ctx.resistance === 'need',
    strategy: 'discover_need',
    mustDo: ['ask_clarifying_questions', 'understand_situation', 'offer_relevant_info'],
    niceToDo: ['share_similar_cases', 'help_self_discovery'],
    forbidden: ['push_booking', 'prescribe_solution'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRICE DISCUSSION STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'price_discuss_value',
    condition: (ctx) => ctx.stage === 'price_discuss' && ctx.readiness >= 2,
    strategy: 'present_value',
    mustDo: ['acknowledge_investment', 'clarify_value', 'present_options'],
    niceToDo: ['quantify_results', 'offer_comparison'],
    forbidden: ['random_discount', 'pressure', 'hard_sell'],
    tone: 'professional',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING FLOW STAGES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'booking_slots_collect',
    condition: (ctx) => ctx.stage === 'booking_slots',
    strategy: 'collect_slots',
    mustDo: ['ask_missing_slot', 'confirm_collected'],
    niceToDo: ['offer_options', 'be_patient'],
    forbidden: ['assume_details', 'skip_verification'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: true,
  },
  {
    name: 'confirm_ready',
    condition: (ctx) => ctx.stage === 'confirm' && ctx.trust >= 3,
    strategy: 'confirm_booking',
    mustDo: ['summarize_booking', 'ask_explicit_confirmation'],
    niceToDo: ['offer_modification', 'reassure'],
    forbidden: ['assume_confirmed', 'create_pressure'],
    tone: 'professional',
    urgency: 'immediate',
    shouldEscalate: false,
    shouldPushBooking: true,
  },
  {
    name: 'confirm_hesitant',
    condition: (ctx) => ctx.stage === 'confirm' && ctx.trust < 3,
    strategy: 'confirm_booking',
    mustDo: ['summarize_booking', 'offer_reassurance', 'ask_confirmation'],
    niceToDo: ['offer_consultation', 'suggest_time_to_think'],
    forbidden: ['pressure', 'hard_close'],
    tone: 'empathetic',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLAINT STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'complaint_angry',
    condition: (ctx) => ctx.stage === 'complaint' && ctx.emotion === 'angry',
    strategy: 'deescalate',
    mustDo: ['acknowledge_emotion', 'apologize_sincerely', 'clarify_issue', 'offer_next_step'],
    niceToDo: ['show_empathy', 'take_responsibility'],
    forbidden: ['defend', 'argue', 'explain_policy_at_length', 'upsell'],
    tone: 'empathetic',
    urgency: 'immediate',
    shouldEscalate: true,
    shouldPushBooking: false,
  },
  {
    name: 'complaint_upset',
    condition: (ctx) => ctx.stage === 'complaint' && ctx.emotion !== 'angry',
    strategy: 'repair_relationship',
    mustDo: ['acknowledge_issue', 'apologize', 'offer_solution'],
    niceToDo: ['offer_compensation', 'follow_up'],
    forbidden: ['defend', 'minimize_issue', 'upsell'],
    tone: 'empathetic',
    urgency: 'immediate',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCALATION STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'escalation_handoff',
    condition: (ctx) => ctx.stage === 'escalation',
    strategy: 'escalate',
    mustDo: ['acknowledge_need', 'explain_handoff', 'provide_contact'],
    niceToDo: ['set_expectation', 'thank_customer'],
    forbidden: ['defend', 'argue', 'minimize', 'upsell'],
    tone: 'professional',
    urgency: 'immediate',
    shouldEscalate: true,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POST BOOKING STAGE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'post_booking_confirm',
    condition: (ctx) => ctx.stage === 'post_booking',
    strategy: 'follow_up',
    mustDo: ['confirm_booking', 'provide_next_steps', 'offer_support'],
    niceToDo: ['upsell_relevant', 'ask_additional_questions'],
    forbidden: ['pressure', 'confuse_customer'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // HIGH RISK SITUATIONS (override all)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'high_risk_escalate',
    condition: (ctx) => ctx.riskScore > 70,
    strategy: 'escalate',
    mustDo: ['acknowledge', 'offer_immediate_help', 'handoff_to_human'],
    niceToDo: ['set_expectation', 'thank_customer'],
    forbidden: ['upsell', 'push_booking', 'delay_response'],
    tone: 'empathetic',
    urgency: 'immediate',
    shouldEscalate: true,
    shouldPushBooking: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULT FALLBACK
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'fallback_discover',
    condition: () => true, // Always matches as fallback
    strategy: 'discover_need',
    mustDo: ['ask_need', 'offer_help'],
    niceToDo: ['provide_context'],
    forbidden: ['push_booking', 'upsell'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  },
];

// ── Strategy Selection Function ───────────────────────────────────────────────

/**
 * Selects the best strategy for the given context.
 * Returns the primary strategy, with fallback if needed.
 */
export function selectStrategy(ctx: StrategySelectionContext): StrategyConfig {
  // Get risk-based adjustments
  const riskLevel = getRiskLevel(ctx.riskScore);
  const riskModifier = getRiskModifier(ctx.riskScore);
  const experimentGroup = assignExperimentGroup(ctx.riskScore, ctx.message);

  // Find matching rule (first match wins, rules are ordered by priority)
  const matchedRule = STRATEGY_RULES.find(rule => rule.condition(ctx));

  if (!matchedRule) {
    // This should never happen since fallback rule exists
    return {
      strategy: 'discover_need',
      priority: 'fallback',
      reason: 'No matching strategy rule',
      mustDo: ['ask_need'],
      niceToDo: [],
      forbidden: ['push_booking'],
      tone: 'friendly',
      urgency: 'normal',
      shouldEscalate: false,
      shouldPushBooking: false,
    };
  }

  // Apply experiment adjustments
  const adjusted = applyExperimentAdjustments(
    matchedRule.mustDo,
    matchedRule.forbidden,
    matchedRule.tone,
    experimentGroup,
  );

  // Check handoff by risk
  const handoffCheck = shouldHandoffByRisk(ctx.riskScore);

  // Determine if we should escalate based on risk level
  const shouldEscalateByRisk = handoffCheck.shouldHandoff;

  return {
    strategy: matchedRule.strategy,
    priority: matchedRule.name === 'fallback_discover' ? 'fallback' : 'primary',
    reason: `Matched rule: ${matchedRule.name} (risk: ${riskLevel}, group: ${experimentGroup})`,
    mustDo: adjusted.mustDo,
    niceToDo: matchedRule.niceToDo,
    forbidden: adjusted.forbidden,
    tone: adjusted.tone as ResponseTone,
    urgency: matchedRule.urgency,
    shouldEscalate: matchedRule.shouldEscalate || shouldEscalateByRisk,
    shouldPushBooking: matchedRule.shouldPushBooking && riskModifier.maxPushBooking,
  };
}

// ── Strategy Summary for Logging ──────────────────────────────────────────────

/**
 * Human-readable strategy summary.
 */
export function summarizeStrategy(config: StrategyConfig): string {
  const parts: string[] = [];

  parts.push(`策略:${config.strategy}`);
  parts.push(`優先:${config.priority}`);
  parts.push(`語氣:${config.tone}`);

  if (config.mustDo.length > 0) {
    parts.push(`必須:${config.mustDo.slice(0, 3).join(',')}`);
  }
  if (config.forbidden.length > 0) {
    parts.push(`禁止:${config.forbidden.slice(0, 3).join(',')}`);
  }
  if (config.shouldEscalate) {
    parts.push('需轉人工');
  }

  return parts.join(' | ');
}

// ── Regression Tests ──────────────────────────────────────────────────────────

export function verifyStrategySelectorRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Angry customer should escalate
  const angryContext: StrategySelectionContext = {
    stage: 'complaint',
    emotion: 'angry',
    resistance: 'none',
    readiness: 1,
    trust: 1,
    style: 'direct',
    riskScore: 75,
    engagementScore: 30,
    topicHistory: [],
    conversationTurn: 3,
    message: '我要投訴！',
    intent: 'COMPLAINT',
  };
  const angryStrategy = selectStrategy(angryContext);
  if (!angryStrategy.shouldEscalate) {
    failures.push(`Angry customer should escalate, got strategy: ${angryStrategy.strategy}`);
  }
  if (!angryStrategy.mustDo.includes('acknowledge_emotion')) {
    failures.push(`Angry customer should acknowledge emotion`);
  }

  // Test 2: Price objection should not push booking
  const priceContext: StrategySelectionContext = {
    stage: 'objection',
    emotion: 'calm',
    resistance: 'price',
    readiness: 2,
    trust: 3,
    style: 'analytical',
    riskScore: 30,
    engagementScore: 60,
    topicHistory: ['price'],
    conversationTurn: 5,
    message: '太貴了',
    intent: 'PRICE',
  };
  const priceStrategy = selectStrategy(priceContext);
  if (priceStrategy.shouldPushBooking) {
    failures.push(`Price objection should not push booking`);
  }
  if (!priceStrategy.mustDo.includes('acknowledge_price_concern')) {
    failures.push(`Price objection should acknowledge price concern`);
  }

  // Test 3: Ready customer in booking should collect slots
  const bookingContext: StrategySelectionContext = {
    stage: 'booking_slots',
    emotion: 'calm',
    resistance: 'none',
    readiness: 4,
    trust: 4,
    style: 'supportive',
    riskScore: 10,
    engagementScore: 80,
    topicHistory: ['booking'],
    conversationTurn: 8,
    message: '我想約星期三',
    intent: 'BOOKING',
  };
  const bookingStrategy = selectStrategy(bookingContext);
  if (bookingStrategy.strategy !== 'collect_slots') {
    failures.push(`Booking slots stage should use collect_slots strategy, got: ${bookingStrategy.strategy}`);
  }

  // Test 4: High risk should always escalate
  const highRiskContext: StrategySelectionContext = {
    stage: 'answer',
    emotion: 'angry',
    resistance: 'none',
    readiness: 1,
    trust: 0,
    style: 'direct',
    riskScore: 85,
    engagementScore: 20,
    topicHistory: [],
    conversationTurn: 2,
    message: '差評',
    intent: 'OTHER',
  };
  const highRiskStrategy = selectStrategy(highRiskContext);
  if (!highRiskStrategy.shouldEscalate) {
    failures.push(`High risk (85) should escalate, got strategy: ${highRiskStrategy.strategy}`);
  }

  return { ok: failures.length === 0, failures };
}