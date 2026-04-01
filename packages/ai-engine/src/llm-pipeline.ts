import type { AiEngineInput } from './types';
import type { EngineResponse } from './response-composer';
import { buildServiceCatalog } from './service-matcher';
import { foldIntentMessage, isBookingSlotFollowUp, classifyDetailQuestion } from './intent-classifier';
import { buildLlmPlannerMessages, type StrategyContext } from './llm-prompt';
import { callOpenAiPlannerJson } from './llm-client';
import { parseLlmJson, validateLlmPlannerJson } from './llm-validate';
import { mergeDraftFromPlanner } from './llm-draft-merge';
import { runLlmSemanticChecks } from './llm-semantic-check';
import {
  composeDetailResponse,
  composePriceResponse,
  composeInquiryResponse,
  composeGreeting,
  composeContactInfoResponse,
  composeFallback,
  composeAvailabilityResponse,
  getDisplayName,
} from './response-composer';
import { allowsDraftServiceFallback } from './draft-service-fallback';
import type { LlmPlannerIntent } from './llm-contract';
import { buildBookingDateTime, extractSlots, isBookingComplete } from './booking-state';
import { resolveAiEngineMode, shouldAttemptLlmPlanner } from './llm-config';
import type { ConversationMode } from './conversation-mode';
import { extractServiceCandidate } from './service-candidate-extractor';
import { validateResponseAgainstStrategy } from './llm-strategy-guard';
import type { StrategyConfig } from './strategy-selector';

/** TEMP DEBUG: grep `[LLM-PIPELINE]` — remove when no longer needed. */
const LLM_LOG = '[LLM-PIPELINE]';

function hasDraftProgress(d: {
  serviceName: string | null;
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
}): boolean {
  return !!(d.serviceName || d.date || d.time || d.customerName || d.phone);
}

function isBookingPlannerIntent(i: LlmPlannerIntent): boolean {
  return i === 'BOOKING' || i === 'BOOKING_SLOT_FILL';
}

function bookingSafetyOk(draft: EngineResponse['bookingDraft']): boolean {
  if (!isBookingComplete(draft)) return true;
  try {
    buildBookingDateTime(draft.date!, draft.time!);
    return true;
  } catch {
    return false;
  }
}

// ── Helper: Validate LLM reply against strategy ────────────────────────────────

function validateLlmReply(
  reply: string,
  strategy: StrategyConfig | undefined,
): { valid: boolean; violations: string[] } {
  if (!strategy) {
    return { valid: true, violations: [] };
  }

  const result = validateResponseAgainstStrategy(reply, strategy);

  if (!result.valid) {
    const issues: string[] = [];
    if (result.missingMustDo.length > 0) {
      issues.push(`missingMustDo: ${result.missingMustDo.join(', ')}`);
    }
    if (result.containsForbidden.length > 0) {
      issues.push(`containsForbidden: ${result.containsForbidden.join(', ')}`);
    }
    return { valid: false, violations: issues };
  }

  return { valid: true, violations: [] };
}

/**
 * LLM Planner Pipeline.
 *
 * CRITICAL: Booking flow is NOT handled here.
 *
 * When intent is BOOKING / BOOKING_SLOT_FILL, or when priorMode is
 * BOOKING_DRAFT / CONFIRMATION_PENDING, this function returns null.
 * orchestrator.ts then runs processMessage() which routes through
 * resolveNextMode() -> BOOKING_DRAFT -> CONFIRMATION_PENDING -> POST_BOOKING.
 *
 * CREATE_BOOKING side effects are ONLY emitted by orchestrator.ts's
 * POST_BOOKING handler. Never from this file.
 *
 * LLM pipeline handles: DETAIL, INQUIRY, PRICE, GREETING, CONTACT_INFO,
 * availability questions, and OTHER fallback only.
 */
export async function tryLlmPlannerPipeline(
  input: AiEngineInput,
  priorMode?: ConversationMode,
  priorConfirmationPending?: boolean,
  strategyContext?: StrategyContext,
): Promise<
  | {
      response: EngineResponse;
      inputTokens: number;
      outputTokens: number;
    }
  | null
> {
  const attempt = shouldAttemptLlmPlanner();
  const mode = resolveAiEngineMode();
  const keySet = !!process.env.OPENAI_API_KEY?.trim();
  console.log(
    `${LLM_LOG} shouldAttemptLlmPlanner=${attempt} mode=${mode} OPENAI_API_KEY_set=${keySet}` +
    (priorMode ? ` priorMode=${priorMode}` : ''),
  );

  if (!attempt) {
    console.log(`${LLM_LOG} fallback=no_call`);
    return null;
  }

  // ── Defer booking modes to orchestrator BEFORE calling OpenAI ────────────
  // Saves a token round-trip and prevents any accidental booking path here.
  if (
    priorMode === 'BOOKING_DRAFT' ||
    priorMode === 'CONFIRMATION_PENDING'
  ) {
    console.log(
      `${LLM_LOG} defer_to_orchestrator reason=prior_mode_${priorMode}`,
    );
    return null;
  }

  const msg = foldIntentMessage(input.currentMessage.trim());
  const catalog = buildServiceCatalog(input.knowledge);
  const { system, user } = buildLlmPlannerMessages(input, strategyContext);

  const call = await callOpenAiPlannerJson(system, user);
  if (!call.ok) {
    const reason = call.error === 'empty_content' ? 'empty_content' : 'openai_call_failed';
    console.log(`${LLM_LOG} fallback=${reason} detail=${JSON.stringify(call.error)}`);
    return null;
  }

  const parsed = parseLlmJson(call.content);
  if (!parsed.ok) {
    console.log(`${LLM_LOG} fallback=parseLlmJson_failed`);
    return null;
  }

  const validated = validateLlmPlannerJson(parsed.parsed);
  if (!validated.ok) {
    console.log(`${LLM_LOG} fallback=validateLlmPlannerJson_failed reason=${validated.reason}`);
    return null;
  }

  const planner = validated.value;

  // ── Defer booking intents to orchestrator AFTER parsing ──────────────────
  // Belt-and-suspenders: even if priorMode was not booking, if LLM says
  // BOOKING/BOOKING_SLOT_FILL, let mode engine handle it.
  if (isBookingPlannerIntent(planner.intent)) {
    console.log(
      `${LLM_LOG} defer_to_orchestrator intent=${planner.intent} reason=booking_intent`,
    );
    return null;
  }

  const merged = mergeDraftFromPlanner({
    currentMessage: input.currentMessage,
    priorDraft: input.bookingDraft,
    planner,
    catalog,
  });

  const { draft, serviceMatch } = merged;

  const semantic = runLlmSemanticChecks({
    foldedMsg: msg,
    priorDraft: input.bookingDraft,
    planner,
    mergedDraft: draft,
    serviceMatch,
  });
  if (!semantic.ok) {
    console.log(`${LLM_LOG} fallback=semantic_check_failed reason=${semantic.reason}`);
    return null;
  }

  if (!bookingSafetyOk(draft)) {
    console.log(`${LLM_LOG} fallback=bookingSafetyOk_failed`);
    return null;
  }

  const fields: Record<string, string> = {};
  if (draft.customerName) fields.name = draft.customerName;
  if (draft.phone) fields.phone = draft.phone;

  const contactName = getDisplayName(input.contact.name);
  const serviceText = extractServiceCandidate(msg, extractSlots(msg));

  // ── Availability questions ────────────────────────────────────────────────
  const isAvailabilityQuestion =
    /咩時間有位|幾時有位|有冇位|幾時得|有冇得約|幾時可以|what time.*available|any.*slot/i.test(msg);

  if (isAvailabilityQuestion && hasDraftProgress(draft)) {
    console.log(`${LLM_LOG} success intent=${planner.intent} composer=availability`);
    return {
      response: composeAvailabilityResponse(draft, fields),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  // ── DETAIL ────────────────────────────────────────────────────────────────
  if (planner.intent === 'DETAIL') {
    const llmReply = planner.replyText?.trim();
    if (llmReply && llmReply.length > 20) {
      // Validate against strategy if available
      const strategy = strategyContext?.strategy;
      const validation = validateLlmReply(llmReply, strategy);
      if (!validation.valid) {
        console.log(`${LLM_LOG} strategy_violation intent=${planner.intent} violations=${validation.violations.join('; ')}`);
      }
      console.log(`${LLM_LOG} success intent=${planner.intent} composer=detail_llm`);
      return {
        response: {
          reply: llmReply,
          intents: ['PRODUCT_INQUIRY'],
          extractedFields: fields,
          action: 'REPLY_ONLY',
          bookingDraft: draft,
        },
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
      };
    }
    const detailType = classifyDetailQuestion(msg);
    const allowDraft = allowsDraftServiceFallback(msg, 'DETAIL_QUESTION', serviceMatch, serviceText);
    console.log(`${LLM_LOG} success intent=${planner.intent} composer=detail_deterministic`);
    return {
      response: composeDetailResponse(msg, detailType, draft, serviceMatch, catalog, fields, allowDraft),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  // ── PRICE ─────────────────────────────────────────────────────────────────
  if (planner.intent === 'PRICE') {
    const allowDraft = allowsDraftServiceFallback(msg, 'PRICE', serviceMatch, serviceText);
    let sm = serviceMatch;
    if (allowDraft && sm.type === 'none' && draft.serviceName) {
      const contextService = catalog.find((s) => s.code === draft.serviceName);
      if (contextService) {
        sm = { type: 'exact', matches: [{ service: contextService, confidence: 1.0 }] };
      }
    }
    console.log(`${LLM_LOG} success intent=${planner.intent} composer=price`);
    return {
      response: composePriceResponse(sm, draft, fields),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  // ── INQUIRY ───────────────────────────────────────────────────────────────
  if (planner.intent === 'INQUIRY') {
    if (serviceMatch.type === 'none' && serviceText.length >= 2) {
      console.log(`${LLM_LOG} success intent=${planner.intent} composer=inquiry_clarify`);
      return {
        response: {
          reply: `你想了解邊個療程？可以講服務名，或者問價錢、功效、適合對象都得 😊`,
          intents: ['PRODUCT_INQUIRY'],
          extractedFields: fields,
          action: 'REPLY_ONLY',
          bookingDraft: draft,
        },
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
      };
    }
    const llmReply = planner.replyText?.trim();
    if (llmReply && llmReply.length > 20) {
      // Validate against strategy if available
      const strategy = strategyContext?.strategy;
      const validation = validateLlmReply(llmReply, strategy);
      if (!validation.valid) {
        console.log(`${LLM_LOG} strategy_violation intent=${planner.intent} violations=${validation.violations.join('; ')}`);
      }
      console.log(`${LLM_LOG} success intent=${planner.intent} composer=inquiry_llm`);
      return {
        response: {
          reply: llmReply,
          intents: ['PRODUCT_INQUIRY'],
          extractedFields: fields,
          action: 'REPLY_ONLY',
          bookingDraft: draft,
        },
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
      };
    }
    console.log(`${LLM_LOG} success intent=${planner.intent} composer=inquiry_deterministic`);
    return {
      response: composeInquiryResponse(serviceMatch, catalog, draft, fields),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  // ── GREETING ──────────────────────────────────────────────────────────────
  if (planner.intent === 'GREETING') {
    console.log(`${LLM_LOG} success intent=${planner.intent} composer=greeting`);
    return {
      response: composeGreeting(contactName, draft, fields),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  // ── CONTACT_INFO ──────────────────────────────────────────────────────────
  if (planner.intent === 'CONTACT_INFO') {
    console.log(`${LLM_LOG} success intent=${planner.intent} composer=contact_info`);
    return {
      response: composeContactInfoResponse(draft, fields),
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
    };
  }

  // ── OTHER / fallback ──────────────────────────────────────────────────────
  console.log(`${LLM_LOG} success intent=${planner.intent} composer=fallback`);
  return {
    response: composeFallback(draft, fields),
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}
