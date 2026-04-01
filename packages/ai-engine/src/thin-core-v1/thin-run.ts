import type { AiEngineInput, AiEngineResult } from '../types';
import { deserializeMode } from '../conversation-mode';
import { thinFormatKnowledgeContext } from './thin-retriever';
import { runThinBrain } from './thin-brain';
import { parseThinLlmJson, applyThinValidators } from './thin-validator';
import {
  mergeBookingDraftFromThin,
  isBookingReadyForSubmit,
  buildThinCoreResult,
  buildThinConfirmationSummary,
} from './thin-actions';
import { getThinSessionFocus, setThinSessionFocus } from './thin-state';
import type { ThinSessionFocus } from './thin-state';
import { applyDeterministicDateTimeToDraft } from './thin-deterministic-datetime';
import { applyThinBookingGate, isExplicitBookingConfirmation } from './thin-booking-confirm';
import { resolveCarryForward, nextSuppressReconfirmFlag } from './thin-carry-forward';

const LOG = '[THIN-CORE-V1]';

export async function runThinCoreV1(input: AiEngineInput, startTime: number): Promise<AiEngineResult> {
  const priorMode = deserializeMode(input.signals?.conversationMode);
  const priorConfirmationPending = !!input.signals?.confirmationPending;
  const explicitConfirm = isExplicitBookingConfirmation(input.currentMessage.trim());
  const retrieval = thinFormatKnowledgeContext(input.knowledge ?? []);
  const sessionFocus = getThinSessionFocus(input.conversation.id);

  const carry = resolveCarryForward(
    input.currentMessage.trim(),
    sessionFocus,
    input.knowledge ?? [],
    input.bookingDraft,
    sessionFocus.suppressNextReconfirm ?? false,
  );

  const brainFocus: ThinSessionFocus = {
    lastMatchedEntityId: carry.effectiveFocus.lastMatchedEntityId,
    lastMatchedEntityTitle: carry.effectiveFocus.lastMatchedEntityTitle,
  };

  const brain = await runThinBrain(
    input.messages,
    input.currentMessage,
    retrieval.contextText,
    brainFocus,
    priorConfirmationPending,
    carry.policyBlock,
  );

  if (!brain.ok) {
    throw new Error(`thin_brain:${brain.error}`);
  }

  const parsed = parseThinLlmJson(brain.rawJson);
  if (!parsed.ok) {
    throw new Error(`thin_parse:${parsed.error}`);
  }

  let mergedDraft = mergeBookingDraftFromThin(input.bookingDraft, parsed.value, input.currentMessage);
  const det = applyDeterministicDateTimeToDraft(mergedDraft, input.currentMessage);
  mergedDraft = det.draft;
  if (det.dateAmbiguous) {
    mergedDraft = { ...mergedDraft, date: null };
  }

  const bookingComplete = isBookingReadyForSubmit(mergedDraft);

  let thin = applyThinValidators(parsed.value, {
    retrieval,
    bookingComplete,
  });

  thin = applyThinBookingGate({
    thin,
    mergedDraft,
    priorConfirmationPending,
    explicitConfirm,
  });

  if (thin.nextAction === 'booking_confirm') {
    thin = { ...thin, reply: buildThinConfirmationSummary(mergedDraft) };
  }

  const nextSuppress = nextSuppressReconfirmFlag(carry.band, carry.suppressConsumedThisTurn);

  let nextId: string | null;
  let nextTitle: string | null;
  if (thin.matchedEntityId) {
    nextId = thin.matchedEntityId;
    nextTitle = retrieval.entityById.get(thin.matchedEntityId)?.title ?? null;
  } else if (carry.band === 'low') {
    nextId = null;
    nextTitle = null;
  } else if (carry.bookingDraftPrimary) {
    nextId = carry.effectiveFocus.lastMatchedEntityId;
    nextTitle = carry.effectiveFocus.lastMatchedEntityTitle;
  } else {
    nextId = sessionFocus.lastMatchedEntityId;
    nextTitle = sessionFocus.lastMatchedEntityTitle;
  }

  setThinSessionFocus(input.conversation.id, {
    lastMatchedEntityId: nextId,
    lastMatchedEntityTitle: nextTitle,
    suppressNextReconfirm: nextSuppress,
  });

  return buildThinCoreResult({
    thin,
    mergedDraft,
    priorMode,
    inputTokens: brain.inputTokens,
    outputTokens: brain.outputTokens,
    startTime,
  });
}

export function logThinCoreBoot(): void {
  const raw = process.env.THIN_CORE_V1;
  console.log(`${LOG} THIN_CORE_V1=${raw ?? '(unset)'} — single-call LV1 path when enabled`);
}
