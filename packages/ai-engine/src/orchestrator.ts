import type { AiEngineInput, AiEngineResult, BookingDraft, KnowledgeChunk, ServiceMatchResult } from './types';
import { emptyDraft, extractSlots, isBookingComplete, formatDateDisplay, formatTimeDisplay, buildBookingDateTime } from './booking-state';
import { buildServiceCatalog, matchService, extractServiceText } from './service-matcher';
import { extractServiceCandidate } from './service-candidate-extractor';
import { detectIntent, classifyDetailQuestion, foldIntentMessage, hasStrongPriceIntent, isBookingSlotFollowUp } from './intent-classifier';
import { applyDraftPatch } from './draft-update-policy';
import {
  deserializeMode,
  resolveNextMode,
  shouldClearConfirmationPending,
  shouldResetDraft,
  logModeTransition,
  type ConversationMode,
} from './conversation-mode';
import {
  composeGreeting, composeBookingResponse, composeDetailResponse,
  composePriceResponse, composeInquiryResponse,
  composeContactInfoResponse, composeFallback,
  composeAvailabilityResponse, composeConfirmationSummary,
  collectSideEffects, getDisplayName,
  type EngineResponse,
} from './response-composer';
import {
  BOOKING_FORM_DUMP_PATTERN,
  buildPostBookingSubmittedReply,
} from './booking-conversation-policy';
import { allowsDraftServiceFallback } from './draft-service-fallback';
import { tryLlmPlannerPipeline } from './llm-pipeline';
import { useLlmFirstPrototype, useThinCoreV1 } from './llm-config';
import { runThinCoreV1, logThinCoreBoot } from './thin-core-v1/thin-run';
import { handleConversationLLMFirst } from './llm-first-handler';
// Phase 1.5A: deterministic FAQ routing
import { classifyQuestion, isPhase15AFaqType, getFaqAnswer, type QuestionType } from './question-router';
// Phase 1.5C: service detail handler
import { composeServiceDetailResponse } from './service-detail-handler';
// P1-core: Answer Planner (Phase 1A)
import { planAnswer, questionTypeToIntent, type AnswerPlan } from './answer-planner';
import { applyBookingTransitionToServiceDetailReply } from './booking-transition-policy';
// Phase 1.5B: graceful unknown + handoff
import { classifyUnknown } from './unknown-handler';
// Phase 1.5D: FAQ matching
import { buildFaqCatalog, matchFaq, composeFaqReply } from './faq-matcher';
// P5 Lite: Business rule validation
import { validateBookingRules, formatValidationMessage, DEFAULT_BUSINESS_HOURS, type BusinessHoursConfig } from './business-rule-validator';
// P7 Lite: Handoff triggers
import { checkHandoffTrigger, countBookingCorrections, type HandoffConfig, DEFAULT_HANDOFF_CONFIG } from './handoff-trigger';
// Decision Engine v1
import {
  runDecisionEngine,
  type DecisionEngineInput,
  type DecisionEngineOutput,
} from './decision-engine';
import type { ConversationStage } from './conversation-stage';
import type { CustomerSignals } from './customer-signals';
import type { StrategyContext } from './llm-prompt';

const ORCH_LOG = '[ORCH]';

// Boot-time log so demo operators can confirm which env var value is
// actually visible to the running Node process.
const LLMLF_BOOT_RAW = process.env.USE_LLM_FIRST;
const LLMLF_BOOT_ENABLED = useLlmFirstPrototype();
console.log(
  `[LLM-FIRST][boot] USE_LLM_FIRST=${LLMLF_BOOT_RAW ?? '(unset)'} resolved_enabled=${LLMLF_BOOT_ENABLED}`,
);
logThinCoreBoot();

// ── Correction tracking for handoff detection (P7 lite) ──────────────────────
// In production, this should be stored per-conversation in DB.
// For now, we use a simple in-memory map (cleared on restart).
const conversationCorrectionCount = new Map<string, number>();

function getCorrectionCount(conversationId: string): number {
  return conversationCorrectionCount.get(conversationId) ?? 0;
}

function incrementCorrectionCount(conversationId: string): number {
  const current = getCorrectionCount(conversationId);
  const next = current + 1;
  conversationCorrectionCount.set(conversationId, next);
  return next;
}

function resetCorrectionCount(conversationId: string): void {
  conversationCorrectionCount.delete(conversationId);
}

// ── Service detail question types (Phase 1.5D) ────────────────────────────────
// These should bypass LLM and use structured KB fields directly.
const SERVICE_DETAIL_TYPES = new Set<QuestionType>([
  'service_precaution',
  'service_suitable_for',
  'service_unsuitable_for',
  'service_effect',
  'service_duration',
  'service_price',
  'service_procedure',
]);

/** True when orchestrator uses planAnswer → composeServiceDetailResponse(answerPlan) for service KB fields. */
export function isServiceDetailQuestionType(questionType: QuestionType): boolean {
  return SERVICE_DETAIL_TYPES.has(questionType);
}

// ── Helper: Build result for rule-based responses ──────────────────────────────

function buildRuleResult(
  reply: string,
  intents: import('./types').AiIntent[],
  bookingDraft: BookingDraft | undefined,
  priorMode: ConversationMode | undefined,
  priorConfirmationPending: boolean,
  model: string,
  startTime: number,
  enginePath: 'llm-first' | 'legacy-fallback' | 'legacy' = 'legacy',
  fallbackReason?: string,
): AiEngineResult {
  return {
    replyText: reply,
    signals: {
      intents,
      extractedFields: {},
      action: 'REPLY_ONLY',
      bookingDraft: bookingDraft ?? emptyDraft(),
      conversationMode: priorMode,
      confirmationPending: priorConfirmationPending,
      // Decision Engine v1: rule-based responses don't have decision signals
      // (they bypass the decision engine)
    },
    sideEffects: [],
    shouldHandoff: false,
    analytics: {
      model,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
    },
    enginePath,
    fallbackReason,
  };
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function runAiEngine(input: AiEngineInput): Promise<AiEngineResult> {
  const startTime = Date.now();

  // ── Thin-core-v1 (LV1): single LLM + JSON — takes precedence over LLM-first and legacy ──
  if (useThinCoreV1()) {
    try {
      return await runThinCoreV1(input, startTime);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.log(`[THIN-CORE-V1] fallback to legacy: ${errMsg} conv=${input.conversation.id.slice(0, 8)}`);
    }
  }

  // ── Restore conversation mode from prior signals ─────────────────────────
  const priorMode = deserializeMode(input.signals?.conversationMode);
  const priorConfirmationPending = !!input.signals?.confirmationPending;

  // ── Normalize message ──────────────────────────────────────────────────────
  const msg = input.currentMessage.trim();
  const foldedMsg = foldIntentMessage(msg);
  const questionRoute = classifyQuestion(foldedMsg);

  // ── LLM-first prototype path (feature-flagged, safe rollback) ───────────
  let enginePathOverride: 'legacy-fallback' | 'legacy' = 'legacy';
  let fallbackReasonOverride: string | undefined;

  const llmFirstEnabled = useLlmFirstPrototype();
  console.log(`[LLM-FIRST] feature flag enabled=${llmFirstEnabled} conv=${input.conversation.id.slice(0, 8)}`);

  if (llmFirstEnabled) {
    console.log(`[LLM-FIRST] entering handleConversationLLMFirst conv=${input.conversation.id.slice(0, 8)}`);
    try {
      const llmFirst = await handleConversationLLMFirst(input);
      if (!llmFirst || !llmFirst.response) {
        enginePathOverride = 'legacy-fallback';
        fallbackReasonOverride = 'handler returned null/invalid';
        console.log(
          `[LLM-FIRST] fallback to legacy because handler returned null/invalid conv=${input.conversation.id.slice(0, 8)}`,
        );
      } else {
        console.log(`[LLM-FIRST] success conv=${input.conversation.id.slice(0, 8)} enginePath=llm-first`);
        enginePathOverride = 'legacy'; // not used on success
        fallbackReasonOverride = undefined;
        const sideEffects = collectSideEffects(llmFirst.response);
        return {
          replyText: llmFirst.response.reply,
          signals: {
            intents: llmFirst.response.intents,
            extractedFields: llmFirst.response.extractedFields,
            action: llmFirst.response.action,
            bookingDraft: llmFirst.response.bookingDraft,
            conversationMode: llmFirst.response.conversationMode ?? priorMode,
            confirmationPending: llmFirst.response.confirmationPending ?? false,
          },
          sideEffects,
          shouldHandoff: llmFirst.response.conversationMode === 'HANDOFF',
          analytics: {
            model: process.env.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o-mini',
            inputTokens: llmFirst.inputTokens,
            outputTokens: llmFirst.outputTokens,
            durationMs: Date.now() - startTime,
          },
          aiTurnTrace: llmFirst.trace,
          enginePath: 'llm-first',
          fallbackReason: undefined,
        };
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // Taxonomy mapping for demo debugging
      if (errMsg.includes('json_parse_failure') || errMsg.includes('parse')) {
        fallbackReasonOverride = `JSON parse failure (${errMsg})`;
      } else if (errMsg.includes('llm_timeout') || /timed out|timeout/i.test(errMsg)) {
        fallbackReasonOverride = `LLM timeout (${errMsg})`;
      } else if (errMsg.includes('guardrail_hard_block')) {
        fallbackReasonOverride = `guardrail hard block (${errMsg})`;
      } else if (errMsg.includes('handler_error') || errMsg.includes('LLM_FIRST_ERROR')) {
        fallbackReasonOverride = `handler threw error (${errMsg})`;
      } else {
        fallbackReasonOverride = `handler threw error (${errMsg})`;
      }
      enginePathOverride = 'legacy-fallback';
      console.log(
        `[LLM-FIRST] fallback to legacy because ${fallbackReasonOverride} conv=${input.conversation.id.slice(0, 8)}`,
      );
    }
  } else {
    fallbackReasonOverride = undefined;
    console.log(`[LLM-FIRST] flag disabled → using legacy conv=${input.conversation.id.slice(0, 8)}`);
  }

  // ── Phase 1.5A: Hardcoded FAQ routing ───────────────────────────────────────
  // Global FAQs (deposit, payment, first_visit) get canned answers.
  // This runs BEFORE service detail and KB FAQ matching.
  if (isPhase15AFaqType(questionRoute.questionType)) {
    const faqAnswer = getFaqAnswer(questionRoute.questionType);
    if (faqAnswer) {
      console.log(`${ORCH_LOG} faq_hardcoded=${questionRoute.questionType} confidence=${questionRoute.confidence}`);
      return buildRuleResult(
        faqAnswer,
        ['FAQ'],
        input.bookingDraft,
        priorMode,
        priorConfirmationPending,
        'rule-faq-hardcoded',
        startTime,
        enginePathOverride,
        fallbackReasonOverride,
      );
    }
  }

  // ── Phase 1.5C/1.5D: Service detail routing ──────────────────────────────────
  // Service-specific questions with structured KB fields should bypass LLM.
  // P1-core (Phase 1A): Use Answer Planner for field selection.
  if (SERVICE_DETAIL_TYPES.has(questionRoute.questionType)) {
    const catalog = buildServiceCatalog(input.knowledge);
    const serviceText = extractServiceCandidate(foldedMsg, extractSlots(foldedMsg));
    let serviceMatch: ServiceMatchResult = { type: 'none', matches: [] };
    if (serviceText.length >= 2) {
      serviceMatch = matchService(serviceText, catalog);
    }

    // Also check draft context for service
    if (serviceMatch.type === 'none' && input.bookingDraft?.serviceName) {
      const contextService = catalog.find((s) => s.code === input.bookingDraft!.serviceName);
      if (contextService) {
        serviceMatch = { type: 'exact', matches: [{ service: contextService, confidence: 1.0 }] };
      }
    }

    // P1-core (Phase 1A): Use Answer Planner for field selection
    const questionIntent = questionTypeToIntent(questionRoute.questionType);
    const answerPlan = planAnswer(questionIntent, serviceMatch, catalog);

    // Log the Answer Planner decision for debugging
    console.log(`${ORCH_LOG} service_detail=${questionRoute.questionType} match=${serviceMatch.type} intent=${questionIntent} answerMode=${answerPlan.answerMode} hasData=${answerPlan.hasData} missingFields=${answerPlan.missingFields.join(',') || 'none'}`);

    // Compose response using Answer Plan
    const result = composeServiceDetailResponse(questionRoute.questionType, serviceMatch, catalog, answerPlan);
    console.log(`${ORCH_LOG} service_detail=${questionRoute.questionType} match=${serviceMatch.type} source=answer_planner`);

    // Phase 1D: optional natural next-step close (only when we have data + resolved service; does not alter booking state)
    let serviceDetailReply = result.reply;
    if (!result.needsServiceContext && answerPlan.hasData) {
      serviceDetailReply = applyBookingTransitionToServiceDetailReply(serviceDetailReply, foldedMsg);
    }

    return buildRuleResult(
      serviceDetailReply,
      ['PRODUCT_INQUIRY'],
      input.bookingDraft,
      priorMode,
      priorConfirmationPending,
      'rule-service-detail',
      startTime,
      enginePathOverride,
      fallbackReasonOverride,
    );
  }

  // ── Phase 1.5D: FAQ item matching from knowledge base ─────────────────────────
  // Match user question against FAQ items stored in knowledge documents.
  const faqCatalog = buildFaqCatalog(input.knowledge);
  if (faqCatalog.length > 0) {
    const faqResult = matchFaq(foldedMsg, faqCatalog, {
      minConfidence: 0.5,
      preferServiceContext: input.bookingDraft?.serviceDisplayName ?? null,
    });

    if (faqResult.type === 'matched' && faqResult.match) {
      const reply = composeFaqReply(faqResult.match, input.bookingDraft?.serviceDisplayName);
      console.log(`${ORCH_LOG} faq_kb_match=${faqResult.match.sourceId} confidence=${faqResult.match.confidence.toFixed(2)} source=faq_kb`);

      return buildRuleResult(
        reply,
        ['FAQ'],
        input.bookingDraft,
        priorMode,
        priorConfirmationPending,
        'rule-faq-kb',
        startTime,
        enginePathOverride,
        fallbackReasonOverride,
      );
    }
  }

  // ── Compute early strategy for LLM pipeline ─────────────────────────────────
  // This provides strategy context to guide LLM response generation.
  const earlyDecisionInput = buildEarlyDecisionInput(input, priorMode);
  const earlyDecisionOutput = runDecisionEngine(earlyDecisionInput);
  const strategyContext: StrategyContext = {
    strategy: earlyDecisionOutput.strategy,
    stage: earlyDecisionOutput.stage,
    signals: earlyDecisionOutput.signals,
  };
  console.log(`${ORCH_LOG} early_strategy=${earlyDecisionOutput.strategy.strategy} stage=${earlyDecisionOutput.stage}`);

  // ── Try LLM pipeline ───────────────────────────────────────────────────────
  const llmResult = await tryLlmPlannerPipeline(input, priorMode, priorConfirmationPending, strategyContext);
  const response = llmResult?.response ?? processMessage(input, priorMode, priorConfirmationPending, questionRoute.questionType);
  const source = llmResult ? 'llm_pipeline' : 'rule_fallback';
  console.log(`${ORCH_LOG} source=${source} conv=${input.conversation.id.slice(0, 8)}`);

  const sideEffects = collectSideEffects(response);
  const durationMs = Date.now() - startTime;
  const model = llmResult
    ? (process.env.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o-mini')
    : 'rule-engine';

  return {
    replyText: response.reply,
    signals: {
      intents: response.intents,
      extractedFields: response.extractedFields,
      action: response.action,
      bookingDraft: response.bookingDraft,
      // Persist mode and confirmation state for next turn
      conversationMode: response.conversationMode ?? priorMode,
      confirmationPending: response.confirmationPending ?? false,
      // Decision Engine v1: persist signals across turns
      conversationStage: response.conversationStage,
      customerEmotion: response.customerSignals?.emotion,
      customerResistance: response.customerSignals?.resistance,
      customerReadiness: response.customerSignals?.readiness,
      customerTrust: response.customerSignals?.trust,
      customerStyle: response.customerSignals?.style,
      strategy: response.strategy,
      strategyMustDo: response.strategyMustDo,
      strategyForbidden: response.strategyForbidden,
    },
    sideEffects,
    shouldHandoff: response.conversationMode === 'HANDOFF',
    enginePath: enginePathOverride,
    fallbackReason: enginePathOverride === 'legacy-fallback' ? fallbackReasonOverride : undefined,
    analytics: {
      model,
      inputTokens: llmResult?.inputTokens ?? 0,
      outputTokens: llmResult?.outputTokens ?? 0,
      durationMs,
    },
  };
}

// ── Helper: Build decision input for early strategy computation ───────────────
// This builds a minimal decision input before intent detection,
// to provide strategy context to the LLM pipeline.

function buildEarlyDecisionInput(
  input: AiEngineInput,
  priorMode: ConversationMode | undefined,
): DecisionEngineInput {
  // Estimate intent from message patterns for early strategy
  const msg = input.currentMessage.trim();
  let estimatedIntent = 'OTHER';
  if (/^(hi|hello|你好|早晨|晚安|hihi|hellohi)/i.test(msg)) {
    estimatedIntent = 'GREETING';
  } else if (/幾錢|價錢|價格|多少錢|多少|收費|收幾多|price/i.test(msg)) {
    estimatedIntent = 'PRICE';
  } else if (/預約|約時間|book|booking|想約|訂位/i.test(msg)) {
    estimatedIntent = 'BOOKING';
  } else if (/功效|效果|做咩|係咩|點樣|點做|適合|注意/i.test(msg)) {
    estimatedIntent = 'DETAIL_QUESTION';
  }

  return {
    currentMode: priorMode ?? 'INQUIRY',
    currentStage: (input.signals?.conversationStage as ConversationStage) ?? null,
    message: msg,
    intent: estimatedIntent,
    bookingDraft: input.bookingDraft ?? null,
    conversationHistory: input.messages.map((m) => ({
      sender: m.sender as 'CUSTOMER' | 'AI' | 'HUMAN',
      content: m.content,
      timestamp: m.createdAt,
      intent: undefined,
    })),
    knowledgeContext: {
      serviceName: input.bookingDraft?.serviceDisplayName ?? undefined,
    },
    previousSignals: input.signals?.customerEmotion ? {
      emotion: input.signals.customerEmotion as CustomerSignals['emotion'],
      resistance: (input.signals.customerResistance as CustomerSignals['resistance']) ?? 'none',
      readiness: (input.signals.customerReadiness as CustomerSignals['readiness']) ?? 1,
      trust: (input.signals.customerTrust as CustomerSignals['trust']) ?? 2,
      style: (input.signals.customerStyle as CustomerSignals['style']) ?? 'supportive',
      engagementScore: 50,
      riskScore: 20,
      urgencyLevel: 15,
      conversationTurn: input.conversation.messageCount,
      topicHistory: [],
      previousPurchases: 0,
      lastPurchaseDate: null,
    } : null,
  };
}

// ── Rule-based message processor ─────────────────────────────────────────────
// Handles intent detection, slot extraction, and mode-based routing.
// Rule-based FAQ and service detail routing is done in runAiEngine before LLM.

function processMessage(
  input: AiEngineInput,
  priorMode: ConversationMode | undefined,
  priorConfirmationPending: boolean,
  questionType: string,
): EngineResponse {
  const raw = input.currentMessage.trim();
  const msg = foldIntentMessage(raw);

  // ── Intent detection ─────────────────────────────────────────────────────
  let intent = detectIntent(msg, input.bookingDraft);
  if (isDetailQuestion(msg)) {
    intent = 'DETAIL_QUESTION';
  } else if (hasStrongPriceIntent(msg)) {
    intent = 'PRICE';
  } else if (
    (intent === 'OTHER' || intent === 'CONTACT_INFO') &&
    isBookingSlotFollowUp(msg, input.bookingDraft)
  ) {
    intent = 'BOOKING';
  }

  // ── Slot extraction ──────────────────────────────────────────────────────
  const catalog = buildServiceCatalog(input.knowledge);
  const priorDraft: BookingDraft | undefined = input.bookingDraft ? { ...input.bookingDraft } : undefined;
  let draft: BookingDraft = priorDraft ? { ...priorDraft } : emptyDraft();
  const contactName = getDisplayName(input.contact.name);

  const slots = extractSlots(msg);

  // ── Service matching ─────────────────────────────────────────────────────
  const serviceText = extractServiceCandidate(msg, slots);
  let serviceMatch: ServiceMatchResult = { type: 'none', matches: [] };
  if (serviceText.length >= 2) {
    serviceMatch = matchService(serviceText, catalog);
  }

  const serviceCandidate =
    serviceMatch.type === 'exact' || serviceMatch.type === 'close'
      ? {
          serviceName: serviceMatch.matches[0].service.code,
          serviceDisplayName: serviceMatch.matches[0].service.displayName,
        }
      : null;
  const patch = applyDraftPatch(priorDraft, {
    message: msg,
    priorMode,
    slots,
    nextService: serviceCandidate,
  });
  draft = patch.draft;

  const fields: Record<string, string> = {};
  if (draft.customerName) fields.name = draft.customerName;
  if (draft.phone) fields.phone = draft.phone;

  const acceptedSlotUpdate =
    patch.appliedFields.includes('date') ||
    patch.appliedFields.includes('time') ||
    patch.appliedFields.includes('customerName') ||
    patch.appliedFields.includes('phone');

  if (
    priorMode === 'CONFIRMATION_PENDING' &&
    (intent === 'BOOKING' || intent === 'CONTACT_INFO') &&
    !acceptedSlotUpdate
  ) {
    intent = 'OTHER';
  }

  const allSlotsPresent = isBookingComplete(draft);

  // ── Mode transition ──────────────────────────────────────────────────────
  const nextMode = resolveNextMode({
    currentMode: priorMode ?? 'INQUIRY',
    intent,
    message: msg,
    bookingDraft: draft,
    allSlotsPresent,
  });

  // ── Confirmation pending state ───────────────────────────────────────────
  let confirmationPending = priorConfirmationPending;
  if (shouldClearConfirmationPending(priorMode ?? 'INQUIRY', nextMode, msg)) {
    confirmationPending = false;
  }
  if (nextMode === 'CONFIRMATION_PENDING') {
    confirmationPending = true;
  }

  // ── BLOCKER 1 FIX: Snapshot draft BEFORE reset ───────────────────────────
  // submittedDraft preserves the full booking data for reply generation and
  // bookingData payload. Reset only affects what is persisted for the NEXT turn.
  const submittedDraft = { ...draft };
  const createBookingTriggered = shouldResetDraft(priorMode ?? 'INQUIRY', nextMode);
  let finalDraft = draft;
  if (createBookingTriggered) {
    finalDraft = emptyDraft();
    confirmationPending = false;
  }

  // ── Debug log ────────────────────────────────────────────────────────────
  logModeTransition(priorMode ?? 'INQUIRY', nextMode, intent, submittedDraft, allSlotsPresent, confirmationPending, createBookingTriggered);

  // ── Decision Engine v1: Detect stage, signals, and strategy ───────────────
  // This computes customer signals and strategy for response composition.
  const decisionInput: DecisionEngineInput = {
    currentMode: priorMode ?? 'INQUIRY',
    currentStage: input.signals?.conversationStage as ConversationStage ?? null,
    message: msg,
    intent,
    bookingDraft: draft,
    conversationHistory: input.messages.map(m => ({
      sender: m.sender,
      content: m.content,
      timestamp: m.createdAt,
      intent: undefined,
    })),
    knowledgeContext: {
      serviceName: draft.serviceDisplayName ?? undefined,
      servicePrice: serviceMatch.type !== 'none' ? serviceMatch.matches[0]?.service.priceInfo ?? undefined : undefined,
    },
    previousSignals: input.signals?.customerEmotion ? {
      emotion: input.signals.customerEmotion as CustomerSignals['emotion'],
      resistance: (input.signals.customerResistance as CustomerSignals['resistance']) ?? 'none',
      readiness: (input.signals.customerReadiness as CustomerSignals['readiness']) ?? 1,
      trust: (input.signals.customerTrust as CustomerSignals['trust']) ?? 2,
      style: (input.signals.customerStyle as CustomerSignals['style']) ?? 'supportive',
      engagementScore: 50,
      riskScore: 20,
      urgencyLevel: 15,
      conversationTurn: input.conversation.messageCount,
      topicHistory: [],
      previousPurchases: 0,
      lastPurchaseDate: null,
    } : null,
  };
  const decisionOutput = runDecisionEngine(decisionInput);

  // Log decision engine output for debugging
  console.log(`${ORCH_LOG} stage=${decisionOutput.stage} strategy=${decisionOutput.strategy.strategy} emotion=${decisionOutput.signals.emotion} readiness=${decisionOutput.signals.readiness} trust=${decisionOutput.signals.trust}`);

  // ── Route to handler based on mode ───────────────────────────────────────
  return routeByMode({
    mode: nextMode,
    prevMode: priorMode ?? 'INQUIRY',
    intent,
    msg,
    draft: finalDraft,
    submittedDraft, // ← passed through for POST_BOOKING rendering
    serviceMatch,
    catalog,
    fields,
    contactName,
    confirmationPending,
    serviceText,
    createBookingTriggered,
    questionType, // Phase 1.5B: passed from runAiEngine
    // P5/P7 lite: pass business config and handoff config
    conversationId: input.conversation.id,
    priorMessages: input.messages,
    // Decision Engine v1: pass decision output
    decisionOutput,
  });
}

// ── Helper: isDetailQuestion (local copy for routing) ───────────────────────

function isDetailQuestion(msg: string): boolean {
  return /功效|效果|成[份分]|時長|幾耐|幾長|多長|做幾耐|要幾耐|幾多分鐘|包[括含]什麼|有咩功效|有什麼效果|適合|注意|做法|過程|步驟|details|effect|duration|how long|ingredient/i.test(
    msg,
  );
}

// ── Route context for mode-based dispatch ────────────────────────────────────

interface RouteContext {
  mode: ConversationMode;
  prevMode: ConversationMode | undefined;
  intent: string;
  msg: string;
  draft: BookingDraft;
  submittedDraft: BookingDraft;
  serviceMatch: ServiceMatchResult;
  catalog: ReturnType<typeof buildServiceCatalog>;
  fields: Record<string, string>;
  contactName: string;
  confirmationPending: boolean;
  serviceText: string;
  createBookingTriggered: boolean;
  questionType: string; // Phase 1.5B: pass question type for graceful unknown
  // P5/P7 lite: business rules and handoff
  businessConfig?: BusinessHoursConfig;
  handoffConfig?: HandoffConfig;
  conversationId: string;
  priorMessages: Array<{ sender: string; content: string }>;
  // Decision Engine v1: signals and strategy
  decisionOutput?: DecisionEngineOutput;
}

function routeByMode(ctx: RouteContext): EngineResponse {
  const {
    mode,
    prevMode,
    intent,
    msg,
    draft,
    submittedDraft,
    serviceMatch,
    catalog,
    fields,
    contactName,
    confirmationPending,
    serviceText,
    createBookingTriggered,
    conversationId,
    priorMessages,
    decisionOutput,
  } = ctx;

  const withMode = (r: EngineResponse): EngineResponse => {
    let result = {
      ...r,
      conversationMode: mode,
      confirmationPending,
    };
    // Add decision engine signals if available
    if (decisionOutput) {
      result = {
        ...result,
        conversationStage: decisionOutput.stage,
        customerSignals: {
          emotion: decisionOutput.signals.emotion,
          resistance: decisionOutput.signals.resistance,
          readiness: decisionOutput.signals.readiness,
          trust: decisionOutput.signals.trust,
          style: decisionOutput.signals.style,
          engagementScore: decisionOutput.signals.engagementScore,
          riskScore: decisionOutput.signals.riskScore,
        },
        strategy: decisionOutput.strategy.strategy,
        strategyMustDo: decisionOutput.strategy.mustDo,
        strategyForbidden: decisionOutput.strategy.forbidden,
      };
    }
    return result;
  };

  // ── Decision Engine v1: Apply strategy guardrails ──────────────────────────
  // Check if we should escalate based on strategy
  const strategy = decisionOutput?.strategy;
  if (strategy?.shouldEscalate) {
    return withMode({
      reply: `明白，我幫你轉交同事跟進。請稍等，同事會盡快聯絡你 🙏`,
      intents: ['OTHER'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    });
  }

  // ── HANDOFF ──────────────────────────────────────────────────────────────
  if (mode === 'HANDOFF') {
    return withMode({
      reply: `明白，我幫你轉交同事跟進。請稍等，同事會盡快聯絡你 🙏`,
      intents: ['OTHER'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    });
  }

  // ── POST_BOOKING ─────────────────────────────────────────────────────────
  // BLOCKER 1 FIX: Use submittedDraft (pre-reset snapshot) for reply + bookingData.
  // draft at this point is already emptyDraft() — do NOT use it here.
  if (mode === 'POST_BOOKING' && prevMode === 'CONFIRMATION_PENDING') {
    // P7 lite: Reset correction count on successful booking
    resetCorrectionCount(conversationId);

    const svc = submittedDraft.serviceDisplayName || submittedDraft.serviceName || '服務';
    return withMode({
      reply: buildPostBookingSubmittedReply(submittedDraft),
      intents: ['BOOKING_REQUEST'],
      extractedFields: fields,
      action: 'REQUEST_BOOKING',
      // bookingData uses submittedDraft — guaranteed to have date + time
      bookingData:
        submittedDraft.date && submittedDraft.time
          ? {
              serviceName: svc,
              startTime: buildBookingDateTime(submittedDraft.date, submittedDraft.time).toISOString(),
            }
          : undefined,
      // bookingDraft returned to caller = empty (reset for next turn)
      bookingDraft: draft,
    });
  }

  if (mode === 'POST_BOOKING') {
    return withMode(composeFallback(draft, fields));
  }

  // ── CONFIRMATION_PENDING ─────────────────────────────────────────────────
  // Shows summary and asks for EXPLICIT confirmation phrase.
  // Per P3 (fixed template): use fixed format to avoid over-promising.
  // Per P2 (re-confirmation): if user updated a slot, show acknowledgment + new summary.
  // P5 lite: Validate business rules before showing confirmation.
  // P7 lite: Check handoff triggers (multiple corrections, etc.).
  if (mode === 'CONFIRMATION_PENDING') {
    // Check if this is an update (came from CONFIRMATION_PENDING -> CONFIRMATION_PENDING)
    // The submittedDraft has the updated values, we should acknowledge the change
    const updatedField = ctx.createBookingTriggered ? undefined : (
      draft.date !== submittedDraft.date ? 'date' :
      draft.time !== submittedDraft.time ? 'time' :
      draft.customerName !== submittedDraft.customerName ? 'customerName' :
      draft.phone !== submittedDraft.phone ? 'phone' :
      undefined
    );

    // If prevMode was also CONFIRMATION_PENDING and slots changed, it's a correction
    const isCorrection = prevMode === 'CONFIRMATION_PENDING' && updatedField;

    // P7 lite: Track correction count for handoff detection
    let correctionCount = getCorrectionCount(conversationId);
    if (isCorrection) {
      correctionCount = incrementCorrectionCount(conversationId);
    }

    // P7 lite: Check handoff triggers
    const handoffResult = checkHandoffTrigger({
      message: msg,
      draft,
      serviceMatch,
      correctionCount,
      conversationMode: mode,
    });

    if (handoffResult.shouldHandoff && handoffResult.reply) {
      console.log(`${ORCH_LOG} handoff_triggered=${handoffResult.triggerType} reason=${handoffResult.reason}`);
      return withMode({
        reply: handoffResult.reply,
        intents: ['OTHER'],
        extractedFields: fields,
        action: 'REPLY_ONLY',
        bookingDraft: draft,
      });
    }

    // P5 lite: Validate business rules
    const businessConfig = ctx.businessConfig ?? DEFAULT_BUSINESS_HOURS;
    const validation = validateBookingRules(draft, businessConfig);

    // If validation fails, flag for human confirmation (don't auto-confirm)
    if (!validation.valid && validation.reason) {
      console.log(`${ORCH_LOG} business_rule_failed=${validation.failureType} reason=${validation.reason}`);
      // Reset correction count since we're not proceeding
      resetCorrectionCount(conversationId);
      // Return a message explaining the issue and asking for human confirmation
      return withMode({
        reply:
          `${formatValidationMessage(validation)}\n\n` +
          `我先幫你記低，需由同事確認是否可以安排。請留低聯絡電話，同事會盡快回覆你 🙏`,
        intents: ['BOOKING_REQUEST'],
        extractedFields: fields,
        action: 'REPLY_ONLY',
        bookingDraft: draft,
      });
    }

    // Format updated value for acknowledgment
    let updatedValue: string | undefined;
    if (isCorrection && updatedField) {
      if (updatedField === 'date') {
        updatedValue = draft.date ? formatDateDisplay(draft.date) : undefined;
      } else if (updatedField === 'time') {
        updatedValue = draft.time ? formatTimeDisplay(draft.time) : undefined;
      } else if (updatedField === 'customerName') {
        updatedValue = draft.customerName || undefined;
      } else if (updatedField === 'phone') {
        updatedValue = draft.phone || undefined;
      }
    }

    // Use fixed template (P3)
    const summary = composeConfirmationSummary(draft, isCorrection ? { updatedField, updatedValue } : undefined);
    return withMode({
      reply: summary.reply,
      intents: summary.intents,
      extractedFields: fields,
      action: summary.action,
      bookingDraft: draft,
    });
  }

  // ── BOOKING_DRAFT ────────────────────────────────────────────────────────
  if (mode === 'BOOKING_DRAFT') {
    if (/咩時間有位|幾時有位|有冇位|幾時得|有冇得約/i.test(msg)) {
      return withMode(composeAvailabilityResponse(draft, fields));
    }
    return withMode(composeBookingResponse(draft, serviceMatch, fields));
  }

  // ── GREETING ─────────────────────────────────────────────────────────────
  if (mode === 'GREETING') {
    return withMode(composeGreeting(contactName, draft, fields));
  }

  // ── INQUIRY / RECOMMENDATION / default ───────────────────────────────────
  // Service name only mentioned without question or booking intent → ask what they want
  if (
    serviceMatch.type !== 'none' &&
    intent !== 'DETAIL_QUESTION' &&
    intent !== 'PRICE' &&
    intent !== 'INQUIRY' &&
    intent !== 'BOOKING'
  ) {
    const svcName = serviceMatch.matches[0].service.displayName;
    return withMode({
      reply: `明白，你想了解「${svcName}」。你想知功效、適合邊類人、價格，定係想直接預約？`,
      intents: ['PRODUCT_INQUIRY'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    });
  }

  if (intent === 'DETAIL_QUESTION') {
    const detailType = classifyDetailQuestion(msg);
    const allowDraft = allowsDraftServiceFallback(msg, 'DETAIL_QUESTION', serviceMatch, serviceText);
    return withMode(composeDetailResponse(msg, detailType, draft, serviceMatch, catalog, fields, allowDraft));
  }

  if (intent === 'PRICE') {
    const allowDraft = allowsDraftServiceFallback(msg, 'PRICE', serviceMatch, serviceText);
    let sm = serviceMatch;
    if (allowDraft && sm.type === 'none' && draft.serviceName) {
      const contextService = catalog.find((s) => s.code === draft.serviceName);
      if (contextService) {
        sm = { type: 'exact', matches: [{ service: contextService, confidence: 1.0 }] };
      }
    }
    return withMode(composePriceResponse(sm, draft, fields));
  }

  if (intent === 'INQUIRY') {
    if (serviceMatch.type === 'none' && serviceText.length >= 2) {
      return withMode({
        reply: `你想了解邊個療程？可以講服務名，或者問價錢、功效、適合對象都得 😊`,
        intents: ['PRODUCT_INQUIRY'],
        extractedFields: fields,
        action: 'REPLY_ONLY',
        bookingDraft: draft,
      });
    }
    return withMode(composeInquiryResponse(serviceMatch, catalog, draft, fields));
  }

  if (intent === 'CONTACT_INFO') {
    return withMode(composeContactInfoResponse(draft, fields));
  }

  // ── Phase 1.5B: Graceful unknown handling ───────────────────────────────────
  // If we reach here with unknown question type, provide a better fallback
  if (ctx.questionType === 'unknown') {
    const unknownResult = classifyUnknown(msg);
    console.log(`${ORCH_LOG} unknown_type=${unknownResult.type} confidence=${unknownResult.confidence}`);
    return withMode({
      reply: unknownResult.suggestedReply,
      intents: ['OTHER'],
      extractedFields: fields,
      action: 'REPLY_ONLY',
      bookingDraft: draft,
    });
  }

  return withMode(composeFallback(draft, fields));
}

// Re-export allowsDraftServiceFallback for backward compatibility
export { allowsDraftServiceFallback } from './draft-service-fallback';

// ── Regression tests ──────────────────────────────────────────────────────────

import { ChannelType } from '@ats/shared';

const auditKnowledge: KnowledgeChunk[] = [
  {
    documentId: 'audit-eye',
    title: 'Eye Treatment',
    content: 'Eye Treatment\n功效：減淡黑眼圈\n價錢：HKD 680',
    score: 1,
  },
  {
    documentId: 'audit-hifu',
    title: 'HIFU 緊緻',
    content: 'HIFU 緊緻\n功效：拉提\n價錢：HKD 1200',
    score: 1,
  },
  {
    documentId: 'audit-white',
    title: '美白 Facial',
    content: '美白 Facial\n功效：均勻膚色\n價錢：HKD 880',
    score: 1,
  },
  {
    documentId: 'audit-j1',
    title: '激光祛斑',
    content: '激光祛斑\n功效：去斑\n價錢：HKD 900',
    score: 1,
  },
  {
    documentId: 'audit-j2',
    title: '激光嫩膚',
    content: '激光嫩膚\n功效：提亮\n價錢：HKD 950',
    score: 1,
  },
  {
    documentId: 'audit-aa1',
    title: 'Anti-aging Treatment',
    content: 'Anti-aging Treatment\n功效：緊緻輪廓\n價錢：HKD 900',
    score: 1,
  },
  {
    documentId: 'audit-aa2',
    title: 'Anti-aging Facial',
    content: 'Anti-aging Facial\n功效：保濕抗皺\n價錢：HKD 850',
    score: 1,
  },
];

const auditDraftEye: BookingDraft = {
  serviceName: 'eye_treatment',
  serviceDisplayName: 'Eye Treatment',
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

function auditInput(msg: string, draft?: BookingDraft): AiEngineInput {
  return {
    tenant: { id: 't', plan: 'p', settings: {} },
    contact: { id: 'c', name: '客', tags: [] },
    conversation: { id: 'v', channel: ChannelType.WHATSAPP, messageCount: 1 },
    messages: [],
    knowledge: auditKnowledge,
    currentMessage: msg,
    bookingDraft: draft,
  };
}

export function verifyServiceContextRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const hiEye = extractServiceText('Hi, Eye Treatment 幾錢');
  if (!/eye\s*treatment/i.test(hiEye)) {
    failures.push(`extract Hi,: expected Eye Treatment, got "${hiEye}"`);
  }

  const hifuSt = extractServiceText('HIFU 幾錢？').replace(/\s+/g, '');
  if (!/^hifu$/i.test(hifuSt)) {
    failures.push(`extract HIFU: expected HIFU, got "${hifuSt}"`);
  }

  const helloW = extractServiceText('hello 美白 Facial');
  if (!/美白|facial/i.test(helloW)) {
    failures.push(`extract hello: expected 美白/Facial, got "${helloW}"`);
  }

  const highSt = extractServiceText('High intensity facial 幾錢').trim();
  if (!/^high\s+intensity\s+facial/i.test(highSt)) {
    failures.push(`extract High intensity: got "${highSt}"`);
  }

  const rHifuPrice = processMessage(auditInput('HIFU 幾錢？', auditDraftEye), undefined, false, 'unknown');
  if (!rHifuPrice.reply.includes('1200') || !rHifuPrice.reply.includes('HIFU')) {
    failures.push(`price new service: expected HIFU price, got ${rHifuPrice.reply.slice(0, 80)}`);
  }

  const rPronoun = processMessage(auditInput('咁幾錢呀', auditDraftEye), undefined, false, 'unknown');
  if (!rPronoun.reply.includes('680')) {
    failures.push(`pronoun price: expected Eye HKD 680, got ${rPronoun.reply.slice(0, 80)}`);
  }

  const rUnknown = processMessage(auditInput('火星療程幾錢呀', auditDraftEye), undefined, false, 'unknown');
  if (rUnknown.reply.includes('680')) {
    failures.push('unknown service: must not silently use draft Eye price');
  }
  if (!/邊個服務|想了解邊個/i.test(rUnknown.reply)) {
    failures.push(`unknown service: expected clarification prompt, got ${rUnknown.reply.slice(0, 80)}`);
  }

  const rAmbPrice = processMessage(auditInput('激光幾錢', auditDraftEye), undefined, false, 'unknown');
  if (rAmbPrice.reply.includes('680')) {
    failures.push('ambiguous laser price: must not inject draft Eye');
  }
  if (!rAmbPrice.reply.includes('激光祛斑') || !rAmbPrice.reply.includes('激光嫩膚')) {
    failures.push(`ambiguous price: expected both laser options, got ${rAmbPrice.reply.slice(0, 80)}`);
  }

  const rAmbDetail = processMessage(auditInput('anti aging effect', auditDraftEye), undefined, false, 'unknown');
  if (rAmbDetail.reply.includes('黑眼圈')) {
    failures.push('ambiguous detail: must not answer with draft Eye effect');
  }
  if (!rAmbDetail.reply.includes('Anti-aging Treatment') || !rAmbDetail.reply.includes('Anti-aging Facial')) {
    failures.push(`ambiguous detail: expected disambiguation, got ${rAmbDetail.reply.slice(0, 80)}`);
  }

  const rDetailDraft = processMessage(auditInput('有咩功效', auditDraftEye), undefined, false, 'unknown');
  if (!rDetailDraft.reply.includes('黑眼圈')) {
    failures.push(`detail filler + draft: expected Eye effect line, got ${rDetailDraft.reply.slice(0, 80)}`);
  }

  return { ok: failures.length === 0, failures };
}

/**
 * Phase 1A: deposit / payment / salon-style hours must not be routed through SERVICE_DETAIL_TYPES (Answer Planner service path).
 */
export function verifyPhase1AFaqAndSalonNotServiceDetailPath(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const cases: [string, QuestionType][] = [
    ['需要預付訂金嗎', 'faq_deposit'],
    ['可以用信用卡付款嗎', 'faq_payment'],
    ['營業時間', 'faq_hours'],
  ];
  for (const [msg, expected] of cases) {
    const r = classifyQuestion(msg);
    if (r.questionType !== expected) {
      failures.push(`classify "${msg}": expected ${expected}, got ${r.questionType}`);
    }
    if (isServiceDetailQuestionType(r.questionType)) {
      failures.push(`"${msg}" must not use service detail / Answer Planner path, got ${r.questionType}`);
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Service detail rule branch returns before runDecisionEngine; reply must reflect AnswerPlan facts and must not attach DE strategy signals.
 * Uses structured `price` on KB chunk so planAnswer hasData (same as real imports with price column).
 */
export async function verifyPhase1AServiceDetailNoDecisionEngineSignals(): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const knowledgeWithStructuredPrice: KnowledgeChunk[] = [
    {
      documentId: 'p1a-audit-hifu',
      title: 'HIFU 緊緻',
      content: 'HIFU 緊緻\n功效：拉提\n價錢：HKD 1200',
      score: 1,
      price: 'HKD 1200',
    },
  ];
  const input = auditInput('HIFU 幾錢？');
  input.knowledge = knowledgeWithStructuredPrice;
  const result = await runAiEngine(input);
  if (result.signals.strategy !== undefined) {
    failures.push('service detail rule path must not set Decision Engine strategy on signals');
  }
  if (!result.replyText.includes('1200')) {
    failures.push(`expected HIFU price from planner+handler in reply, got ${result.replyText.slice(0, 120)}`);
  }
  return { ok: failures.length === 0, failures };
}

export async function verifyPhase1ReliabilityRegression(): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const baseDraft: BookingDraft = {
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
    date: '2026-04-01',
    time: '15:00',
    customerName: 'Amy',
    phone: '91234567',
  };

  const pendingInput = auditInput('第一次去要注意咩？', baseDraft);
  pendingInput.signals = {
    conversationMode: 'CONFIRMATION_PENDING',
    confirmationPending: true,
  };
  const pendingFaq = await runAiEngine(pendingInput);
  if (pendingFaq.signals.confirmationPending !== true) {
    failures.push('confirmation_pending should survive rule-bypass follow-up');
  }

  const pureName = processMessage(auditInput('我叫 HIFU，電話 91234567'), undefined, false, 'unknown');
  if (pureName.bookingDraft.serviceName) {
    failures.push(`name-like input must not commit service, got ${pureName.bookingDraft.serviceName}`);
  }

  const noDump = processMessage(auditInput('有冇啱我嘅療程呀'), undefined, false, 'unknown');
  if (noDump.reply.includes('Eye Treatment') || noDump.reply.includes('HIFU')) {
    failures.push('low-confidence inquiry should not dump catalog');
  }

  const ambiguousBooking = processMessage(auditInput('我想預約激光', auditDraftEye), undefined, false, 'unknown');
  if (!ambiguousBooking.reply.includes('激光祛斑') || !ambiguousBooking.reply.includes('激光嫩膚')) {
    failures.push('ambiguous booking should ask clarification with top options');
  }

  const lockedDraft = processMessage(
    auditInput('晚上7點', { ...baseDraft }),
    'CONFIRMATION_PENDING',
    true,
    'unknown',
  );
  if (lockedDraft.bookingDraft.time !== '15:00') {
    failures.push(`confirmed time should not be overwritten without explicit correction, got ${lockedDraft.bookingDraft.time}`);
  }

  const explicitCorrection = processMessage(
    auditInput('改為晚上7點', { ...baseDraft }),
    'CONFIRMATION_PENDING',
    true,
    'unknown',
  );
  if (explicitCorrection.bookingDraft.time !== '19:00') {
    failures.push(`explicit correction should update time, got ${explicitCorrection.bookingDraft.time}`);
  }

  return { ok: failures.length === 0, failures };
}

export function verifyManualChatRoutingRegression(): { ok: boolean; failures: string[] } {
  // Placeholder for manual chat routing regression tests
  // Returns ok: true as no specific tests are defined yet
  return { ok: true, failures: [] };
}

/**
 * Phase 1E: End-to-end acceptance checks for booking rhythm + confirmation copy.
 * Uses the same rule-based path as production (processMessage / runAiEngine).
 */
export function verifyPhase1EAcceptancePack(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // 1) Price path stays inquiry — not a 4-field booking form
  const rPrice = processMessage(auditInput('HIFU 幾錢？'), 'INQUIRY', false, 'unknown');
  if (!rPrice.reply.includes('1200')) {
    failures.push(`1e-price: expected HIFU price in reply, got ${rPrice.reply.slice(0, 100)}`);
  }
  if (BOOKING_FORM_DUMP_PATTERN.test(rPrice.reply)) {
    failures.push('1e-price: price reply must not look like booking form dump');
  }

  // 2) Start booking — should not open with a full field table
  const rBookStart = processMessage(
    auditInput('我想預約 Eye Treatment'),
    'INQUIRY',
    false,
    'unknown',
  );
  if (rBookStart.conversationMode !== 'BOOKING_DRAFT') {
    failures.push(`1e-book-start: expected BOOKING_DRAFT, got ${rBookStart.conversationMode}`);
  }
  if (BOOKING_FORM_DUMP_PATTERN.test(rBookStart.reply)) {
    failures.push(`1e-book-start: opening must not be form-table style: ${rBookStart.reply.slice(0, 200)}`);
  }

  // 3) Progressive slots — only phone missing → phone prompt only (no re-asking date block)
  const nearComplete: BookingDraft = {
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
    date: '2026-04-15',
    time: '11:00',
    customerName: '陳小姐',
    phone: null,
  };
  const rPhoneOnly = processMessage(
    auditInput('（補充）', nearComplete),
    'BOOKING_DRAFT',
    false,
    'unknown',
  );
  if (!rPhoneOnly.reply.includes('電話')) {
    failures.push(`1e-phone-only: expected phone ask, got ${rPhoneOnly.reply.slice(0, 120)}`);
  }
  if (/想約邊日|邊日、大概幾點/i.test(rPhoneOnly.reply)) {
    failures.push('1e-phone-only: should not re-ask date/time when only phone missing');
  }

  // 4) Confirmation → submit
  const fullDraft: BookingDraft = {
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
    date: '2026-05-01',
    time: '16:00',
    customerName: 'Amy',
    phone: '91234567',
  };
  const rConfirm = processMessage(
    auditInput('確認預約', fullDraft),
    'CONFIRMATION_PENDING',
    true,
    'unknown',
  );
  if (rConfirm.action !== 'REQUEST_BOOKING' || rConfirm.conversationMode !== 'POST_BOOKING') {
    failures.push(
      `1e-confirm: expected POST_BOOKING + REQUEST_BOOKING, got mode=${rConfirm.conversationMode} action=${rConfirm.action}`,
    );
  }
  if (!rConfirm.reply.includes('提交')) {
    failures.push(`1e-confirm: expected submit wording, got ${rConfirm.reply.slice(0, 100)}`);
  }

  // 4b) Revise while pending — stay pending, re-show summary with update ack
  const pendingForRevise: BookingDraft = {
    ...fullDraft,
    time: '15:00',
  };
  const rRevise = processMessage(
    auditInput('改做晚上7點', pendingForRevise),
    'CONFIRMATION_PENDING',
    true,
    'unknown',
  );
  if (rRevise.conversationMode !== 'CONFIRMATION_PENDING') {
    failures.push(`1e-revise: expected CONFIRMATION_PENDING, got ${rRevise.conversationMode}`);
  }
  if (!rRevise.reply.includes('確認預約')) {
    failures.push(`1e-revise: must re-invite 確認預約, got ${rRevise.reply.slice(0, 160)}`);
  }
  if (!/更新|19:00|晚上|7/.test(rRevise.reply)) {
    failures.push(`1e-revise: expected correction reflection, got ${rRevise.reply.slice(0, 160)}`);
  }

  // 5) Confirmation pending — summary invites explicit phrase
  const rSummary = composeConfirmationSummary(fullDraft, undefined);
  if (!rSummary.reply.includes('確認預約')) {
    failures.push('1e-summary: must invite 確認預約');
  }

  // 6) FAQ / salon isolation — deposit question not booking form (router + engine)
  const dep = classifyQuestion('需要預付訂金嗎');
  if (dep.questionType !== 'faq_deposit') {
    failures.push(`1e-faq-deposit: expected faq_deposit, got ${dep.questionType}`);
  }

  // 7) Handoff — not mistaken for booking collection
  const rHuman = processMessage(
    auditInput('我想搵真人', nearComplete),
    'BOOKING_DRAFT',
    false,
    'unknown',
  );
  if (rHuman.conversationMode !== 'HANDOFF') {
    failures.push(`1e-handoff: expected HANDOFF, got ${rHuman.conversationMode}`);
  }

  return { ok: failures.length === 0, failures };
}
