import type { BookingDraft, ServiceMatchResult } from './types';
import type { LlmPlannerOutput } from './llm-contract';
import { emptyDraft, extractSlots, type SlotExtraction } from './booking-state';
import { foldIntentMessage } from './intent-classifier';
import { matchService } from './service-matcher';
import { applyDraftPatch } from './draft-update-policy';
import type { ServiceEntry } from './types';

/**
 * Slot merge priority (per field):
 * 1. Deterministic extraction from current message wins if present
 * 2. LLM extraction wins if present and deterministic is absent
 * 3. Prior draft value preserved if neither current message source has it
 *
 * This prevents a message like "15:00" from wiping the date that was
 * already stored in the prior draft.
 */
function mergeSlot(
  det: string | null,
  llm: string | null,
  prior: string | null,
): string | null {
  if (det) return det;       // deterministic extraction from this message
  if (llm) return llm;       // LLM extraction from this message
  return prior ?? null;      // fall back to what was already in draft
}

export interface MergeFromPlannerContext {
  currentMessage: string;
  priorDraft: BookingDraft | undefined;
  planner: LlmPlannerOutput;
  catalog: ServiceEntry[];
}

/**
 * Merge LLM extractions with deterministic extractSlots; deterministic wins on conflict.
 * Prior draft slots are preserved when neither the current message nor LLM provides a value.
 */
export function mergeDraftFromPlanner(ctx: MergeFromPlannerContext): {
  draft: BookingDraft;
  serviceMatch: ServiceMatchResult;
} {
  const msg = foldIntentMessage(ctx.currentMessage.trim());
  const det: SlotExtraction = extractSlots(msg);

  let draft: BookingDraft = ctx.priorDraft ? { ...ctx.priorDraft } : emptyDraft();
  const { planner, catalog } = ctx;

  const strongTopicSwitch =
    planner.switchedAwayFromDraftService &&
    (planner.intent === 'PRICE' || planner.intent === 'DETAIL' || planner.intent === 'INQUIRY');

  if (strongTopicSwitch) {
    draft.serviceName = null;
    draft.serviceDisplayName = null;
  }

  let serviceMatch: ServiceMatchResult = { type: 'none', matches: [] };
  const mention = planner.serviceMention?.trim();
  if (mention && mention.length >= 1) {
    serviceMatch = matchService(mention, catalog);
  }

  // KEY FIX: use shared patch logic so rule + LLM paths preserve prior slots consistently.
  const mergedSlots: SlotExtraction = {
    date: mergeSlot(det.date, planner.extracted.date, ctx.priorDraft?.date ?? null),
    time: mergeSlot(det.time, planner.extracted.time, ctx.priorDraft?.time ?? null),
    customerName: mergeSlot(det.customerName, planner.extracted.customerName, ctx.priorDraft?.customerName ?? null),
    phone: mergeSlot(det.phone, planner.extracted.phone, ctx.priorDraft?.phone ?? null),
  };
  draft = applyDraftPatch(draft, {
    message: msg,
    slots: mergedSlots,
    nextService:
      serviceMatch.type === 'exact' || serviceMatch.type === 'close'
        ? {
            serviceName: serviceMatch.matches[0].service.code,
            serviceDisplayName: serviceMatch.matches[0].service.displayName,
          }
        : null,
  }).draft;

  /** If matcher says ambiguous, do not commit a single service onto draft for booking safety. */
  if (serviceMatch.type === 'ambiguous') {
    if (planner.intent === 'BOOKING' || planner.intent === 'BOOKING_SLOT_FILL') {
      if (!ctx.priorDraft?.serviceName) {
        draft.serviceName = null;
        draft.serviceDisplayName = null;
      }
    }
  }

  return { draft, serviceMatch };
}
