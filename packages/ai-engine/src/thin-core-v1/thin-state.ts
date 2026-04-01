/**
 * Lightweight per-conversation focus for carry-forward (e.g. HIFU price → 功效).
 * In-memory only; resets on process restart. LV2 may persist in DB.
 */

export interface ThinSessionFocus {
  lastMatchedEntityId: string | null;
  lastMatchedEntityTitle: string | null;
  /** After one medium-band soft reconfirm, next ambiguous turn is upgraded to high (silent) once */
  suppressNextReconfirm?: boolean;
}

const focusByConversationId = new Map<string, ThinSessionFocus>();

export function getThinSessionFocus(conversationId: string): ThinSessionFocus {
  return (
    focusByConversationId.get(conversationId) ?? {
      lastMatchedEntityId: null,
      lastMatchedEntityTitle: null,
      suppressNextReconfirm: undefined,
    }
  );
}

export function setThinSessionFocus(conversationId: string, next: ThinSessionFocus): void {
  focusByConversationId.set(conversationId, next);
}
