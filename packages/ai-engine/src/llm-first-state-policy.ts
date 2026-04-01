import type { ConversationState } from './types';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 10;

const stateStore = new Map<string, ConversationState>();

export function emptyConversationState(sessionId: string, now: number): ConversationState {
  return {
    sessionId,
    serviceFocus: null,
    userPhase: 'exploring',
    turnCount: 0,
    recentHistory: [],
    updatedAt: now,
  };
}

export function loadConversationState(sessionId: string, now = Date.now()): ConversationState {
  const existing = stateStore.get(sessionId);
  if (!existing) {
    const created = emptyConversationState(sessionId, now);
    stateStore.set(sessionId, created);
    return created;
  }
  if (now - existing.updatedAt > SESSION_TTL_MS) {
    const fresh = emptyConversationState(sessionId, now);
    stateStore.set(sessionId, fresh);
    return fresh;
  }
  return existing;
}

export function saveConversationState(state: ConversationState, now = Date.now()): ConversationState {
  const trimmedHistory = state.recentHistory.slice(-MAX_HISTORY);
  const next: ConversationState = {
    ...state,
    recentHistory: trimmedHistory,
    updatedAt: now,
  };
  stateStore.set(state.sessionId, next);
  return next;
}

export function clearLlmFirstStateStore(): void {
  stateStore.clear();
}

export function getLlmFirstStateStoreSize(): number {
  return stateStore.size;
}

