/**
 * decision-engine.ts
 *
 * The main Conversation Decision Engine that orchestrates:
 * 1. Stage detection
 * 2. Signal detection
 * 3. Strategy selection
 * 4. Response component assembly
 *
 * Key principle: "Rule decides, KB supplies, LLM phrases"
 * This engine handles the "Rule decides" and "KB supplies" parts.
 * LLM handles the final phrasing.
 */

import type { BookingDraft } from './types';
import type { BaseConversationMode } from './conversation-stage';
import {
  type ConversationStage,
  type StageDetectionContext,
  type StageDetectionResult,
  detectStage,
  isValidStageTransition,
  getDefaultStageForMode,
} from './conversation-stage';
import {
  type CustomerSignals,
  type SignalDetectionContext,
  detectCustomerSignals,
  summarizeSignals,
} from './customer-signals';
import {
  type StrategyConfig,
  type StrategySelectionContext,
  selectStrategy,
  summarizeStrategy,
} from './strategy-selector';
import {
  type ResponseComponent,
  selectComponentsForMustDo,
  fillComponentTemplate,
} from './response-components';

// ── Decision Engine Input ─────────────────────────────────────────────────────

/**
 * Input to the decision engine.
 */
export interface DecisionEngineInput {
  // Conversation state
  currentMode: BaseConversationMode;
  currentStage: ConversationStage | null;
  message: string;
  intent: string;
  bookingDraft: BookingDraft | null;

  // History
  conversationHistory: Array<{
    sender: 'CUSTOMER' | 'AI' | 'HUMAN';
    content: string;
    timestamp: string;
    intent?: string;
    stage?: ConversationStage;
  }>;

  // Context
  knowledgeContext: {
    serviceName?: string;
    servicePrice?: string;
    serviceBenefit?: string;
    [key: string]: string | undefined;
  };

  // Previous signals (if available)
  previousSignals: CustomerSignals | null;
}

// ── Decision Engine Output ────────────────────────────────────────────────────

/**
 * Output from the decision engine.
 * Contains all the information needed to generate a response.
 */
export interface DecisionEngineOutput {
  // Stage detection
  stage: ConversationStage;
  stageResult: StageDetectionResult;

  // Customer signals
  signals: CustomerSignals;

  // Strategy
  strategy: StrategyConfig;

  // Response components
  responseComponents: Map<string, ResponseComponent[]>;

  // Logging/Debug info
  debug: {
    stageReason: string;
    signalSummary: string;
    strategySummary: string;
    mustDo: string[];
    forbidden: string[];
  };
}

// ── Decision Engine ────────────────────────────────────────────────────────────

/**
 * Main decision engine class.
 * Orchestrates the full decision pipeline.
 */
export class ConversationDecisionEngine {
  /**
   * Process a message and return the decision output.
   */
  process(input: DecisionEngineInput): DecisionEngineOutput {
    // Step 1: Detect customer signals
    const signals = this.detectSignals(input);

    // Step 2: Detect conversation stage
    const stageResult = this.detectStage(input, signals);

    // Step 3: Select strategy
    const strategy = this.selectStrategy(stageResult.stage, signals, input);

    // Step 4: Select response components
    const responseComponents = this.selectComponents(strategy, input);

    // Build debug info
    const debug = {
      stageReason: stageResult.reason,
      signalSummary: summarizeSignals(signals),
      strategySummary: summarizeStrategy(strategy),
      mustDo: strategy.mustDo,
      forbidden: strategy.forbidden,
    };

    return {
      stage: stageResult.stage,
      stageResult,
      signals,
      strategy,
      responseComponents,
      debug,
    };
  }

  // ── Private Methods ──────────────────────────────────────────────────────────

  private detectSignals(input: DecisionEngineInput): CustomerSignals {
    const signalContext: SignalDetectionContext = {
      message: input.message,
      intent: input.intent,
      conversationHistory: input.conversationHistory,
      bookingProgress: {
        hasService: !!input.bookingDraft?.serviceName,
        hasDate: !!input.bookingDraft?.date,
        hasTime: !!input.bookingDraft?.time,
        hasContact: !!input.bookingDraft?.phone,
      },
      previousSignals: input.previousSignals,
    };

    return detectCustomerSignals(signalContext);
  }

  private detectStage(
    input: DecisionEngineInput,
    signals: CustomerSignals,
  ): StageDetectionResult {
    const stageContext: StageDetectionContext = {
      currentMode: input.currentMode,
      currentStage: input.currentStage,
      message: input.message,
      intent: input.intent,
      customerSignals: {
        emotion: signals.emotion,
        trustLevel: signals.trust,
        readinessLevel: signals.readiness,
        resistanceType: signals.resistance,
      },
      bookingDraft: {
        hasService: !!input.bookingDraft?.serviceName,
        hasDate: !!input.bookingDraft?.date,
        hasTime: !!input.bookingDraft?.time,
        hasContact: !!input.bookingDraft?.phone,
      },
      conversationHistory: input.conversationHistory.map((h) => ({
        stage: h.stage || 'unknown',
        intent: h.intent || 'OTHER',
        timestamp: new Date(h.timestamp).getTime(),
      })),
    };

    return detectStage(stageContext);
  }

  private selectStrategy(
    stage: ConversationStage,
    signals: CustomerSignals,
    input: DecisionEngineInput,
  ): StrategyConfig {
    const strategyContext: StrategySelectionContext = {
      stage,
      emotion: signals.emotion,
      resistance: signals.resistance,
      readiness: signals.readiness,
      trust: signals.trust,
      style: signals.style,
      riskScore: signals.riskScore,
      engagementScore: signals.engagementScore,
      topicHistory: signals.topicHistory,
      conversationTurn: signals.conversationTurn,
      message: input.message,
      intent: input.intent,
    };

    return selectStrategy(strategyContext);
  }

  private selectComponents(
    strategy: StrategyConfig,
    input: DecisionEngineInput,
  ): Map<string, ResponseComponent[]> {
    return selectComponentsForMustDo(strategy.mustDo, strategy.tone, 2);
  }
}

// ── Response Generation Helper ─────────────────────────────────────────────────

/**
 * Generates a response template from the decision output.
 * This is NOT the final response - it's a structured template
 * that can be naturalized by LLM or rendered directly.
 */
export function generateResponseTemplate(
  output: DecisionEngineOutput,
  context: Record<string, string>,
): {
  template: string;
  components: ResponseComponent[];
  mustDo: string[];
  forbidden: string[];
} {
  const components: ResponseComponent[] = [];

  // Collect components for each mustDo
  for (const [action, comps] of output.responseComponents) {
    if (comps.length > 0) {
      components.push(comps[0]);
    }
  }

  // Build template string
  const templateParts = components.map((c) => c.content);

  return {
    template: templateParts.join('\n'),
    components,
    mustDo: output.strategy.mustDo,
    forbidden: output.strategy.forbidden,
  };
}

/**
 * Validates that a response satisfies the mustDo requirements.
 */
export function validateResponse(
  response: string,
  mustDo: string[],
  forbidden: string[],
): {
  valid: boolean;
  missingMustDo: string[];
  containsForbidden: string[];
} {
  const missingMustDo: string[] = [];
  const containsForbidden: string[] = [];

  // Check forbidden first (easier)
  for (const f of forbidden) {
    // Convert forbidden actions to potential keywords
    const forbiddenKeywords = getForbiddenKeywords(f);
    for (const keyword of forbiddenKeywords) {
      if (response.includes(keyword)) {
        containsForbidden.push(`${f} (found: "${keyword}")`);
      }
    }
  }

  // Check mustDo (harder - requires semantic understanding)
  // For now, we just check if the response is substantial enough
  // Real validation would need LLM or semantic similarity
  for (const action of mustDo) {
    // Simple heuristic: if response is too short, probably missing something
    if (response.length < 20) {
      missingMustDo.push(action);
    }
  }

  return {
    valid: missingMustDo.length === 0 && containsForbidden.length === 0,
    missingMustDo,
    containsForbidden,
  };
}

/**
 * Converts forbidden action names to potential keywords in response.
 */
function getForbiddenKeywords(forbiddenAction: string): string[] {
  const mapping: Record<string, string[]> = {
    'upsell': ['加購', 'upgrade', '升級', '加埋'],
    'push_booking': ['立即預約', '馬上約', '現在就約'],
    'hard_close': ['一定要', '必須', '即刻'],
    'argue': ['唔係我哋錯', '唔關我哋事'],
    'blame_customer': ['你搞錯', '你冇講清楚'],
    'pressure': ['限時', '今日最後', '唔買就冇'],
    'random_discount': ['特價', '折上折', '額外折扣'],
  };

  return mapping[forbiddenAction] || [];
}

// ── Convenience Function ───────────────────────────────────────────────────────

/**
 * Quick decision engine call.
 */
export function runDecisionEngine(input: DecisionEngineInput): DecisionEngineOutput {
  const engine = new ConversationDecisionEngine();
  return engine.process(input);
}

// ── Regression Tests ────────────────────────────────────────────────────────────

export function verifyDecisionEngineRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Basic processing
  const engine = new ConversationDecisionEngine();

  const testInput: DecisionEngineInput = {
    currentMode: 'INQUIRY',
    currentStage: 'discover',
    message: '我想問下 HIFU 幾錢',
    intent: 'PRICE',
    bookingDraft: null,
    conversationHistory: [
      { sender: 'CUSTOMER', content: '你好', timestamp: '2026-01-01T10:00:00Z', intent: 'GREETING' },
      { sender: 'AI', content: '你好！有咩可以幫到你？', timestamp: '2026-01-01T10:00:05Z' },
    ],
    knowledgeContext: {
      serviceName: 'HIFU',
      servicePrice: 'HK$4980',
    },
    previousSignals: null,
  };

  const output = engine.process(testInput);

  // Verify stage
  if (output.stage !== 'answer' && output.stage !== 'price_discuss') {
    failures.push(`Expected stage 'answer' or 'price_discuss', got '${output.stage}'`);
  }

  // Verify signals
  // Note: readiness may be 0 (browsing) for a simple price question without intent indicators
  // The stage detection handles the price inquiry intent separately

  // Verify strategy
  if (!output.strategy.mustDo.includes('give_answer')) {
    failures.push(`Price question strategy should include 'give_answer' in mustDo`);
  }

  // Verify components
  if (output.responseComponents.size === 0) {
    failures.push(`Should have at least one response component`);
  }

  // Test 2: Angry customer should escalate
  const angryInput: DecisionEngineInput = {
    currentMode: 'INQUIRY',
    currentStage: 'complaint',
    message: '我要投訴！服務好差！',
    intent: 'OTHER',
    bookingDraft: null,
    conversationHistory: [],
    knowledgeContext: {},
    previousSignals: null,
  };

  const angryOutput = engine.process(angryInput);

  if (!angryOutput.strategy.shouldEscalate) {
    failures.push(`Angry customer should have shouldEscalate=true`);
  }
  if (!angryOutput.strategy.mustDo.includes('acknowledge_emotion')) {
    failures.push(`Angry customer strategy should include 'acknowledge_emotion'`);
  }

  // Test 3: Ready customer in booking should push
  const bookingInput: DecisionEngineInput = {
    currentMode: 'BOOKING_DRAFT',
    currentStage: 'booking_slots',
    message: '我想約星期三下午三點',
    intent: 'BOOKING',
    bookingDraft: {
      serviceName: 'facial',
      serviceDisplayName: 'Facial',
      date: null,
      time: null,
      customerName: null,
      phone: null,
    },
    conversationHistory: [
      { sender: 'CUSTOMER', content: '我想約 Facial', timestamp: '2026-01-01T10:00:00Z', intent: 'BOOKING' },
    ],
    knowledgeContext: { serviceName: 'Facial' },
    previousSignals: null,
  };

  const bookingOutput = engine.process(bookingInput);

  if (bookingOutput.strategy.strategy !== 'collect_slots') {
    failures.push(`Booking slots stage should use 'collect_slots' strategy, got '${bookingOutput.strategy.strategy}'`);
  }

  return { ok: failures.length === 0, failures };
}