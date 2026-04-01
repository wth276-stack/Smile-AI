import type {
  AiEngineInput,
  AiTurnTrace,
  BookingDraft,
  ConversationState,
  LLMBrainOutput,
} from './types';
import { emptyDraft, isBookingComplete } from './booking-state';
import type { EngineResponse } from './response-composer';
import { extractServiceCandidate } from './service-candidate-extractor';
import { buildConstraints } from './llm-first-constraints';
import { assembleKbFactBundle } from './llm-first-kb-fact-assembler';
import { runLlmConversationBrain } from './llm-first-brain';
import { applyGuardrailGate } from './llm-first-guardrail-gate';
import { buildServiceCatalog, matchService } from './service-matcher';
import {
  loadConversationState,
  saveConversationState,
} from './llm-first-state-policy';
import {
  commitAssistantTurn,
  hydrateConversationState,
} from './llm-first-state-hydrator';

const TRACE_LOG = '[AI-TURN-TRACE]';

function buildRecentHistoryText(state: ConversationState): string {
  return state.recentHistory
    .map((h) => `${h.role.toUpperCase()}: ${h.content}`)
    .join('\n')
    .trim();
}

function mergeDraft(base: BookingDraft, delta: Partial<BookingDraft>): BookingDraft {
  return {
    serviceName: delta.serviceName ?? base.serviceName,
    serviceDisplayName: base.serviceDisplayName,
    date: delta.date ?? base.date,
    time: delta.time ?? base.time,
    customerName: delta.customerName ?? base.customerName,
    phone: delta.phone ?? base.phone,
  };
}

function decideAction(nextDraft: BookingDraft): EngineResponse['action'] {
  return isBookingComplete(nextDraft) ? 'REQUEST_BOOKING' : 'ASK_INFO';
}

function baseSystemPrompt(): string {
  return [
    'You are AI TOP SALES assistant for beauty/wellness.',
    'Be natural, concise, and conversational in Cantonese Traditional Chinese.',
    'Prefer carrying service context across turns.',
    'When user shows interest, smoothly suggest next practical step.',
    'Do not fabricate service facts or prices.',
  ].join(' ');
}

function isSalonInfoQuestion(msg: string): boolean {
  return /地址|營業時間|你地喺邊|你哋喺邊|美容院地址|where|location|opening/i.test(msg);
}

function composeSalonInfoReply(msg: string, facts: ReturnType<typeof assembleKbFactBundle>): string | null {
  if (!isSalonInfoQuestion(msg)) return null;
  if (/營業時間|opening|business/i.test(msg) && facts.salonInfo.hours) return facts.salonInfo.hours;
  if (/地址|喺邊|where|location|美容院地址/i.test(msg)) {
    return facts.salonInfo.address ?? facts.salonInfo.location ?? null;
  }
  return facts.salonInfo.address ?? facts.salonInfo.hours ?? null;
}

function hasExplicitBookingIntent(msg: string): boolean {
  return /想預約|想book|幫我約|我想約時間|聽日\d|明天\d|預約|book/i.test(msg);
}

function isServiceExistenceQuestion(msg: string): boolean {
  return /有冇|有沒有|有無|有無呢個|有冇呢個服務|有冇.*服務/i.test(msg);
}

function isPriceQuestion(msg: string): boolean {
  return /幾錢|價錢|price|cost|收費/i.test(msg);
}

export async function handleConversationLLMFirst(
  input: AiEngineInput,
): Promise<
  | {
      response: EngineResponse;
      inputTokens: number;
      outputTokens: number;
      trace: AiTurnTrace;
    }
  | null
> {
  const startedAt = Date.now();
  const sessionId = input.conversation.id;
  const draft = input.bookingDraft ?? emptyDraft();
  const msg = input.currentMessage.trim();
  const catalog = buildServiceCatalog(input.knowledge);
  const rawServiceCandidate = extractServiceCandidate(msg, {
    date: null,
    time: null,
    customerName: null,
    phone: null,
  });
  const matchedCandidate =
    rawServiceCandidate.length >= 2 ? matchService(rawServiceCandidate, catalog) : { type: 'none', matches: [] as any[] };
  const serviceCandidate =
    matchedCandidate.type === 'exact' || matchedCandidate.type === 'close'
      ? matchedCandidate.matches[0]?.service.displayName ?? null
      : null;

  const stateBefore = loadConversationState(sessionId);
  const hydrated = hydrateConversationState(
    stateBefore,
    msg,
    serviceCandidate,
  );

  const kbFacts = assembleKbFactBundle(input.knowledge, msg, hydrated.serviceFocus);
  const directSalonReply = composeSalonInfoReply(msg, kbFacts);
  if (directSalonReply) {
    const committedSalon = commitAssistantTurn(
      hydrated,
      directSalonReply,
      hydrated.userPhase,
      hydrated.serviceFocus,
    );
    const stateAfterSalon = saveConversationState(committedSalon);
    const trace: AiTurnTrace = {
      sessionId,
      turnNumber: stateAfterSalon.turnCount,
      userMessage: msg,
      serviceFocusBefore: stateBefore.serviceFocus,
      serviceFocusAfter: stateAfterSalon.serviceFocus,
      phaseBefore: stateBefore.userPhase,
      phaseAfter: stateAfterSalon.userPhase,
      retrievedServiceId: kbFacts.serviceFocus?.code ?? null,
      faqIds: kbFacts.faqMatches.map((f) => f.id),
      llmDecisions: null,
      guardrailIssues: ['salon_info_direct_answer'],
      finalReply: directSalonReply,
      latencyMs: Date.now() - startedAt,
    };
    console.log(`${TRACE_LOG} ${JSON.stringify(trace)}`);
    return {
      response: {
        reply: directSalonReply,
        intents: ['FAQ'],
        extractedFields: {},
        action: 'REPLY_ONLY',
        bookingDraft: draft,
      },
      inputTokens: 0,
      outputTokens: 0,
      trace,
    };
  }
  const constraints = buildConstraints(msg, kbFacts, draft);

  const brainCall = await runLlmConversationBrain({
    systemPrompt: baseSystemPrompt(),
    recentHistory: buildRecentHistoryText(hydrated),
    userMessage: msg,
    factsSummary: kbFacts.summary,
    constraints,
  });
  if (!brainCall.ok) {
    // Throw so orchestrator can surface exact fallbackReason.
    throw new Error(`LLM_FIRST_ERROR:llm_brain_failed:${brainCall.error}`);
  }

  const guardrail = applyGuardrailGate({
    userMessage: msg,
    kbFacts,
    draft,
    brain: brainCall.output as LLMBrainOutput,
  });
  if (guardrail.hardBlock) {
    throw new Error(`LLM_FIRST_ERROR:guardrail_hard_block:${guardrail.hardBlock.reason}`);
  }

  const nextDraft = mergeDraft(draft, guardrail.slots);
  // If user is still asking service existence/price, do not over-trigger booking collection.
  if (
    brainCall.output.decisions.nextMove === 'ask_booking_info' &&
    !hasExplicitBookingIntent(msg)
  ) {
    if (isPriceQuestion(msg) && kbFacts.exactPrice) {
      guardrail.reply = `${kbFacts.serviceFocus?.displayName ?? '呢個服務'} 參考價為 ${kbFacts.exactPrice}。如果想預約，我可以再幫你安排。`;
    } else if (isServiceExistenceQuestion(msg)) {
      if (kbFacts.serviceFocus) {
        guardrail.reply = `有提供「${kbFacts.serviceFocus.displayName}」。你想先了解價錢、功效，定係適合對象？`;
      } else {
        guardrail.reply = '有提供相關療程。你可以講你想做邊類（例如袪斑、補濕、緊緻），我幫你對應。';
      }
    }
  }
  // Booking slot validation: if LLM wanted to post booking but we don't have slots, hard block.
  if (brainCall.output.decisions.nextMove === 'post_booking' && !isBookingComplete(nextDraft)) {
    throw new Error('LLM_FIRST_ERROR:booking_slot_validation_failed:post_booking_without_complete_slots');
  }
  const action = guardrail.shouldHandoff ? 'REPLY_ONLY' : decideAction(nextDraft);
  const intents = guardrail.shouldHandoff
    ? (['OTHER'] as const)
    : (['PRODUCT_INQUIRY'] as const);

  const committed = commitAssistantTurn(
    hydrated,
    guardrail.reply,
    guardrail.phaseAfter,
    kbFacts.serviceFocus?.displayName ?? hydrated.serviceFocus,
  );
  const stateAfter = saveConversationState(committed);

  const trace: AiTurnTrace = {
    sessionId,
    turnNumber: stateAfter.turnCount,
    userMessage: msg,
    serviceFocusBefore: stateBefore.serviceFocus,
    serviceFocusAfter: stateAfter.serviceFocus,
    phaseBefore: stateBefore.userPhase,
    phaseAfter: stateAfter.userPhase,
    retrievedServiceId: kbFacts.serviceFocus?.code ?? null,
    faqIds: kbFacts.faqMatches.map((f) => f.id),
    llmDecisions: brainCall.output.decisions,
    guardrailIssues: guardrail.issues,
    finalReply: guardrail.reply,
    latencyMs: Date.now() - startedAt,
    tokenUsage: {
      inputTokens: brainCall.inputTokens,
      outputTokens: brainCall.outputTokens,
    },
  };
  console.log(`${TRACE_LOG} ${JSON.stringify(trace)}`);

  return {
    response: {
      reply: guardrail.reply,
      intents: [...intents],
      extractedFields: {
        ...(nextDraft.customerName ? { name: nextDraft.customerName } : {}),
        ...(nextDraft.phone ? { phone: nextDraft.phone } : {}),
      },
      action,
      bookingDraft: nextDraft,
      conversationMode: guardrail.shouldHandoff ? 'HANDOFF' : undefined,
      confirmationPending: isBookingComplete(nextDraft),
    },
    inputTokens: brainCall.inputTokens,
    outputTokens: brainCall.outputTokens,
    trace,
  };
}

