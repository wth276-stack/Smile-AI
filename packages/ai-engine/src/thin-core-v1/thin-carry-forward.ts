/**
 * 3-level carry-forward confidence for thin-core-v1 (generic patterns + retrieval).
 * High: silent follow-up | Medium: soft reconfirm | Low: drop previous focus
 */

import type { BookingDraft, KnowledgeChunk } from '../types';
import type { ThinSessionFocus } from './thin-state';

export type CarryForwardBand = 'high' | 'medium' | 'low';

export interface CarryForwardResolution {
  band: CarryForwardBand;
  /** What the LLM should treat as the active topic (may be cleared on low) */
  effectiveFocus: { lastMatchedEntityId: string | null; lastMatchedEntityTitle: string | null };
  /** Booking draft service is authoritative for this turn */
  bookingDraftPrimary: boolean;
  /** Injected into user payload for the model */
  policyBlock: string;
  /** True when medium was downgraded to high because suppressNextReconfirm was set */
  suppressConsumedThisTurn: boolean;
}

const RETRIEVAL_SHIFT_MIN_SCORE = 0.28;

/** Clear info follow-up — no new product noun required */
const HIGH_FOLLOWUP =
  /(?:^|[\s，。！？!?])(?:幾錢|幾多錢|價錢|收費|價格|試做價|正價|多少錢|點計|點收|fee|price|cost)(?:\s|$|[?？])/i;

const HIGH_EFFECT_DETAIL =
  /功效|效果|好處|benefit|做後|術後|恢復|downtime|維持幾耐|維持多久|幾耐見效|幾時見效/i;

const HIGH_SUITABILITY =
  /唔啱|不適合|邊類|邊啲人|有咩人|邊種人|適合邊|適唔適合|禁忌|contraindicat|孕婦/i;

const HIGH_PRECAUTION =
  /注意|護理|做完|術後|要點|會唔會|紅腫|反黑|結痂|precaution|aftercare/i;

const HIGH_PROCEDURE =
  /幾耐|幾長|時長|步驟|過程|點做|怎樣做|procedure|幾多次|一節|一堂/i;

const HIGH_PAIN_SIDE =
  /痛唔痛|會痛|麻醉|副作用|敏感|紅|腫|副作用/i;

/** Vague exploration / booking-ish without explicit "change" semantics */
const MEDIUM_VAGUE =
  /(?:想|要)?\s*(?:book|預約|約|訂位|留位)|想約|想book|了解下|想了解|想問下|想查|有冇|有無|有咩(?!人)|問下|問吓|推介|推薦|介紹下|邊隻好|邊個好|邊樣好/i;

const MEDIUM_GENERIC =
  /^(?:你好|hi|hello|喂|在嗎|在唔在|有人嗎|help|\?|？|唔該|多謝|thanks)[!.！。…\s]*$/i;

/** Booking correction / reschedule — draft service wins */
const BOOKING_UPDATE =
  /改|改期|改時間|改日|換時間|換日|取消預約|取消booking|cancel|reschedule|延遲|另約|換到|提早|推遲|唔要呢個時間|唔要呢個位/i;

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function isBookingDraftServiceLocked(draft: BookingDraft | undefined): boolean {
  return !!(norm(draft?.serviceName) || norm(draft?.serviceDisplayName));
}

export function isBookingUpdateIntent(message: string): boolean {
  return BOOKING_UPDATE.test(message.trim());
}

function resolveDraftToKnowledge(
  draft: BookingDraft | undefined,
  knowledge: KnowledgeChunk[],
): { id: string | null; title: string | null } {
  if (!draft) return { id: null, title: null };
  const label = norm(draft.serviceDisplayName) || norm(draft.serviceName);
  if (!label) return { id: null, title: draft.serviceDisplayName || draft.serviceName || null };

  for (const ch of knowledge) {
    const t = norm(ch.title);
    if (!t) continue;
    if (t === label || t.includes(label) || label.includes(t)) {
      return { id: ch.documentId, title: ch.title };
    }
  }
  return { id: null, title: draft.serviceDisplayName || draft.serviceName };
}

function retrievalSuggestsNewTopic(
  session: ThinSessionFocus,
  knowledge: KnowledgeChunk[],
  message: string,
): boolean {
  if (!session.lastMatchedEntityId || knowledge.length === 0) return false;
  const top = knowledge[0];
  if (!top || top.documentId === session.lastMatchedEntityId) return false;
  if ((top.score ?? 0) < RETRIEVAL_SHIFT_MIN_SCORE) return false;

  if (norm(top.title).length >= 2 && message.includes(top.title.trim())) return true;

  if ((top.score ?? 0) >= 0.38 && top.documentId !== session.lastMatchedEntityId) {
    if (HIGH_FOLLOWUP.test(message) || HIGH_EFFECT_DETAIL.test(message)) return false;
    return true;
  }

  return false;
}

function isHighConfidenceFollowUp(message: string): boolean {
  const t = message.trim();
  if (t.length < 2) return false;
  return (
    HIGH_FOLLOWUP.test(t) ||
    HIGH_EFFECT_DETAIL.test(t) ||
    HIGH_SUITABILITY.test(t) ||
    HIGH_PRECAUTION.test(t) ||
    HIGH_PROCEDURE.test(t) ||
    HIGH_PAIN_SIDE.test(t)
  );
}

function isMediumVagueOrBookingLike(message: string): boolean {
  const t = message.trim();
  if (MEDIUM_GENERIC.test(t)) return true;
  return MEDIUM_VAGUE.test(t);
}

function buildPolicyBlock(
  band: CarryForwardBand,
  title: string | null,
  id: string | null,
  bookingDraftPrimary: boolean,
): string {
  const t = title ?? '（上一個話題）';
  if (bookingDraftPrimary) {
    return (
      `[carry_forward_policy]\n` +
      `band: high (booking_draft_locked)\n` +
      `The active service for booking changes is locked: "${t}"` +
      (id ? ` (documentId=${id})` : '') +
      `.\n` +
      `For date/time/correction messages, use this service only — do not ask which treatment unless the user clearly switches service.\n`
    );
  }

  if (band === 'high') {
    return (
      `[carry_forward_policy]\n` +
      `band: high\n` +
      `Silently continue the previous topic: "${t}"` +
      (id ? ` (documentId=${id})` : '') +
      `.\n` +
      `Answer follow-up detail/price questions as the same service unless the user clearly changes subject.\n`
    );
  }

  if (band === 'medium') {
    return (
      `[carry_forward_policy]\n` +
      `band: medium\n` +
      `Previous topic was "${t}"` +
      (id ? ` (documentId=${id})` : '') +
      `, but the user message may be a new intent.\n` +
      `Ask ONE short Cantonese question to clarify — e.g. 你係想繼續了解「${t}」，定係想問其他療程呀？ or 你而家係想約「${t}」，定係另一個療程呀？ — then wait; do not give a long factual answer yet.\n`
    );
  }

  return (
    `[carry_forward_policy]\n` +
    `band: low\n` +
    `Do NOT assume the previous topic. Resolve matchedEntityId from this message and knowledge base only.\n`
  );
}

/**
 * Classify carry-forward and build effective focus + policy block for the LLM.
 * @param suppressNextReconfirm — if true, medium is upgraded to high (silent) for this turn
 */
export function resolveCarryForward(
  message: string,
  session: ThinSessionFocus,
  knowledge: KnowledgeChunk[],
  bookingDraft: BookingDraft | undefined,
  suppressNextReconfirm: boolean,
): CarryForwardResolution {
  const msg = message.trim();

  if (isBookingDraftServiceLocked(bookingDraft) && isBookingUpdateIntent(msg)) {
    const resolved = resolveDraftToKnowledge(bookingDraft, knowledge);
    return {
      band: 'high',
      effectiveFocus: {
        lastMatchedEntityId: resolved.id,
        lastMatchedEntityTitle: resolved.title,
      },
      bookingDraftPrimary: true,
      policyBlock: buildPolicyBlock('high', resolved.title, resolved.id, true),
      suppressConsumedThisTurn: false,
    };
  }

  if (!session.lastMatchedEntityId && !session.lastMatchedEntityTitle) {
    return {
      band: 'low',
      effectiveFocus: { lastMatchedEntityId: null, lastMatchedEntityTitle: null },
      bookingDraftPrimary: false,
      policyBlock: buildPolicyBlock('low', null, null, false),
      suppressConsumedThisTurn: false,
    };
  }

  const prevTitle = session.lastMatchedEntityTitle;
  const prevId = session.lastMatchedEntityId;

  if (isHighConfidenceFollowUp(msg)) {
    return {
      band: 'high',
      effectiveFocus: { lastMatchedEntityId: prevId, lastMatchedEntityTitle: prevTitle },
      bookingDraftPrimary: false,
      policyBlock: buildPolicyBlock('high', prevTitle, prevId, false),
      suppressConsumedThisTurn: false,
    };
  }

  if (retrievalSuggestsNewTopic(session, knowledge, msg)) {
    return {
      band: 'low',
      effectiveFocus: { lastMatchedEntityId: null, lastMatchedEntityTitle: null },
      bookingDraftPrimary: false,
      policyBlock: buildPolicyBlock('low', prevTitle, prevId, false),
      suppressConsumedThisTurn: false,
    };
  }

  if (isMediumVagueOrBookingLike(msg)) {
    let band: CarryForwardBand = 'medium';
    let suppressConsumed = false;
    if (suppressNextReconfirm) {
      band = 'high';
      suppressConsumed = true;
    }
    return {
      band,
      effectiveFocus: { lastMatchedEntityId: prevId, lastMatchedEntityTitle: prevTitle },
      bookingDraftPrimary: false,
      policyBlock: buildPolicyBlock(band, prevTitle, prevId, false),
      suppressConsumedThisTurn: suppressConsumed,
    };
  }

  return {
    band: 'high',
    effectiveFocus: { lastMatchedEntityId: prevId, lastMatchedEntityTitle: prevTitle },
    bookingDraftPrimary: false,
    policyBlock: buildPolicyBlock('high', prevTitle, prevId, false),
    suppressConsumedThisTurn: false,
  };
}

/**
 * After this turn: if we showed medium reconfirm, next user turn should suppress another reconfirm once.
 */
export function nextSuppressReconfirmFlag(
  band: CarryForwardBand,
  suppressConsumedThisTurn: boolean,
): boolean {
  if (suppressConsumedThisTurn) return false;
  if (band === 'medium') return true;
  return false;
}
