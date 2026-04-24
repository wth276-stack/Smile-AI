export * from './types';
import type { AiEngineInput, AiEngineResult } from './types';
import { runAiEngine as runAiEngineV1 } from './orchestrator';
import { runAiEngineV2 } from './v2/engine';

/** V2 is the default (slot gate, confirmation boundary, etc.). Opt out with USE_V1_ENGINE=1. */
function shouldUseV2Engine(): boolean {
  const v1 = process.env.USE_V1_ENGINE === '1' || process.env.USE_V1_ENGINE === 'true';
  if (v1) return false;
  const v2Off = process.env.USE_V2_ENGINE === '0' || process.env.USE_V2_ENGINE === 'false';
  if (v2Off) return false;
  return true;
}

export async function runAiEngine(input: AiEngineInput): Promise<AiEngineResult> {
  const useV2 = shouldUseV2Engine();
  if (process.env.AI_ENGINE_V2_DEBUG === '1' || process.env.AI_ENGINE_V2_DEBUG === 'true') {
    console.log(`[AI-ENGINE] Using ${useV2 ? 'V2' : 'V1'} engine`);
  }
  return useV2 ? runAiEngineV2(input) : runAiEngineV1(input);
}

export {
  allowsDraftServiceFallback,
  isServiceDetailQuestionType,
  verifyPhase1AFaqAndSalonNotServiceDetailPath,
  verifyPhase1AServiceDetailNoDecisionEngineSignals,
  verifyServiceContextRegression,
  verifyPhase1ReliabilityRegression,
  verifyManualChatRoutingRegression,
  verifyPhase1EAcceptancePack,
} from './orchestrator';
export { buildServiceCatalog, matchService, extractServiceText } from './service-matcher';
export {
  emptyDraft,
  extractSlots,
  extractSlotsWithReferenceDate,
  extractCustomerName,
  mergeSlots,
  getMissingSlots,
  isBookingComplete,
  bookingDraftHasAllRequiredSlots,
  provisionalCustomerNameFromExistingBookings,
  isValidHkPhone,
  verifyBookingDateTimeRegression,
} from './booking-state';
export { validateBookingSlot, buildSlotPolicyFromTenantSettings, parseBusinessHoursToWeekly } from './booking-slot-availability';
export {
  detectIntent,
  classifyDetailQuestion,
  verifyIntentDraftContextRegression,
  foldIntentMessage,
  hasStrongPriceIntent,
  isBookingSlotFollowUp,
  resolveRepairedRuleIntent,
} from './intent-classifier';
export type { MessageIntent, DetailType } from './intent-classifier';
export type { EngineResponse } from './response-composer';
export { verifyBookingFlowRegression, verifyResponseQualityRegression } from './response-composer';
export { verifyLlmValidationRegression } from './llm-validate';
export { verifyLlmMergeRegression } from './llm-regression';
export { verifyLlmSemanticRegression } from './llm-semantic-check';
export { resolveAiEngineMode, shouldAttemptLlmPlanner, type AiEngineMode } from './llm-config';
export { isConfirmationMessage, replyHasConfirmationSummary } from './v2/validator';
export { useLlmFirstPrototype, useThinCoreV1 } from './llm-config';
export { runThinCoreV1 } from './thin-core-v1/thin-run';
export type { LlmPlannerOutput, LlmPlannerIntent } from './llm-contract';
export { verifyConversationModeRegression } from './conversation-mode';
export { verifyLlmFirstPrototypeRegression } from './llm-first-regression';
// Phase 1.5A FAQ routing
export {
  classifyQuestion,
  isPhase15AFaqType,
  getFaqAnswer,
  verifyQuestionRouterRegression,
  type QuestionType,
  type QuestionRouteResult,
} from './question-router';
// Phase 1.5B Graceful unknown + handoff
export {
  classifyUnknown,
  verifyUnknownHandlerRegression,
  type UnknownType,
  type UnknownResult,
} from './unknown-handler';
// Phase 1.5C Service detail handler
export {
  getServiceSection,
  composeServiceDetailResponse,
  verifyServiceDetailHandlerRegression,
  verifyAnswerPlanFactsSurfaceInReply,
  type ServiceDetailResult,
} from './service-detail-handler';
// Phase 1B: lightweight service detail verbalization (facts-preserving)
export {
  preservationTokensFromFacts,
  verbalizeServiceDetailReply,
  verifyServiceDetailVerbalizationRegression,
  SERVICE_DETAIL_SOFT_CLOSE,
  type VerbalizeServiceDetailInput,
} from './service-detail-verbalizer';
// Phase 1D: booking / lead transition after service detail (wording only)
export {
  applyBookingTransitionToServiceDetailReply,
  classifyTransitionTier,
  verifyBookingTransitionPolicyRegression,
  type TransitionTier,
} from './booking-transition-policy';
// Phase 1E: booking slot + confirmation wording (deterministic safety unchanged)
export {
  verifyBookingConversationPolicyRegression,
  BOOKING_FORM_DUMP_PATTERN,
} from './booking-conversation-policy';
// Phase 1C: unknown / clarify / handoff wording policy (no routing)
export {
  clarifyPickOne,
  clarifyWhichAspect,
  clarifyWhichService,
  handoffReplyForTrigger,
  missingFieldOtherHonesty,
  missingFieldPriceHonesty,
  replyForUnknownType,
  verifyUnknownResponsePolicyRegression,
  type PolicyHandoffReplyTrigger,
  type UnknownPolicyScene,
} from './unknown-response-policy';
// Phase 1.5D FAQ matcher
export {
  buildFaqCatalog,
  buildFaqCatalogFromServices,
  matchFaq,
  composeFaqReply,
  verifyFaqMatcherRegression,
  type FaqEntry,
  type FaqMatch,
  type FaqMatchResult,
} from './faq-matcher';
// P5 Lite: Business rule validation
export {
  validateBookingRules,
  formatValidationMessage,
  DEFAULT_BUSINESS_HOURS,
  verifyBusinessRuleValidatorRegression,
  type BusinessHoursConfig,
  type ValidationResult,
} from './business-rule-validator';
// P7 Lite: Handoff triggers
export {
  checkHandoffTrigger,
  countBookingCorrections,
  DEFAULT_HANDOFF_CONFIG,
  verifyHandoffTriggerRegression,
  type HandoffConfig,
  type HandoffTriggerType,
  type HandoffResult,
} from './handoff-trigger';
// Decision Engine v1: Conversation Stage
export {
  detectStage,
  isValidStageTransition,
  getDefaultStageForMode,
  verifyConversationStageRegression,
  type ConversationStage,
  type BaseConversationMode,
  type StageDetectionContext,
  type StageDetectionResult,
  type CustomerSignalsSummary,
} from './conversation-stage';
// Decision Engine v1: Customer Signals
export {
  detectCustomerSignals,
  summarizeSignals,
  verifyCustomerSignalsRegression,
  type CustomerSignals,
  type EmotionType,
  type ResistanceType,
  type ReadinessLevel,
  type TrustLevel,
  type CustomerStyle,
  type SignalDetectionContext,
} from './customer-signals';
// Decision Engine v1: Strategy Selector
export {
  selectStrategy,
  summarizeStrategy,
  verifyStrategySelectorRegression,
  type ConversationStrategy,
  type ResponseUrgency,
  type ResponseTone,
  type StrategyConfig,
  type StrategySelectionContext,
} from './strategy-selector';
// Risk-based A/B testing
export {
  RISK_THRESHOLDS,
  RISK_MODIFIERS,
  getRiskLevel,
  getRiskModifier,
  assignExperimentGroup,
  applyExperimentAdjustments,
  shouldHandoffByRisk,
  verifyRiskConfigRegression,
  type ExperimentGroup,
} from './risk-config';
// Decision Engine v1: Response Components
export {
  selectComponentsForMustDo,
  getAlternativePhrasing,
  getComponentsByCategory,
  getComponentsByTone,
  fillComponentTemplate,
  assembleResponse,
  verifyResponseComponentsRegression,
  type ComponentCategory,
  type ResponseComponent,
} from './response-components';
// Decision Engine v1: Main Engine
export {
  ConversationDecisionEngine,
  runDecisionEngine,
  generateResponseTemplate,
  validateResponse,
  verifyDecisionEngineRegression,
  type DecisionEngineInput,
  type DecisionEngineOutput,
} from './decision-engine';
// Decision Engine v1: LLM Strategy Guard
export {
  buildStrategyGuardPrompt,
  validateResponseAgainstStrategy,
  getStageGuidance,
  verifyLlmStrategyGuardRegression,
} from './llm-strategy-guard';
// Document Parser
export {
  parseDocument,
  detectMimeType,
  extractTitle,
  type ParseResult,
} from './document-parser';

// KB Parser
export {
  detectImportMode,
  splitCatalogItems,
  parseKbItem,
  parseImportContent,
  type ParsedKbItem,
  type ImportMode,
} from './kb-parser';
// P1-core: Answer Planner (Phase 1A)
export {
  FIELD_PRIORITY,
  planAnswer,
  questionTypeToIntent,
  generateMissingFieldResponse,
  verifyAnswerPlannerRegression,
  type QuestionIntent,
  type AnswerPlan,
  type SemanticStateContext,
} from './answer-planner';