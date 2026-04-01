import { callOpenAiPlannerJson } from '../llm-client';
import { buildThinSystemPrompt } from './thin-system-prompt';
import type { AiMessageContext } from '../types';
import type { ThinSessionFocus } from './thin-state';

export interface ThinBrainUserPayload {
  sessionFocus: ThinSessionFocus;
  recentTranscript: string;
  knowledgeContext: string;
  currentMessage: string;
  /** Persisted: waiting for explicit 確認預約 */
  confirmationPending: boolean;
  /** 3-level carry-forward policy (injected before session_focus) */
  carryForwardPolicyBlock: string;
}

export function buildThinUserPayload(payload: ThinBrainUserPayload): string {
  const focusLines = [
    payload.carryForwardPolicyBlock.trim(),
    '',
    '[session_focus]',
    payload.sessionFocus.lastMatchedEntityTitle
      ? `last_topic_title: ${payload.sessionFocus.lastMatchedEntityTitle}`
      : 'last_topic_title: (none)',
    payload.sessionFocus.lastMatchedEntityId
      ? `last_matched_entity_id: ${payload.sessionFocus.lastMatchedEntityId}`
      : 'last_matched_entity_id: (none)',
    '',
    '[booking_state]',
    payload.confirmationPending
      ? 'confirmation_pending: true — user already saw a summary; only submit booking after they reply with explicit confirmation (e.g. 確認預約).'
      : 'confirmation_pending: false',
    '',
    '[recent_messages]',
    payload.recentTranscript || '(none)',
    '',
    '[knowledge_base]',
    payload.knowledgeContext,
    '',
    '[current_user_message]',
    payload.currentMessage,
  ];
  return focusLines.join('\n');
}

function formatRecentMessages(messages: AiMessageContext[], maxTurns: number): string {
  const slice = messages.slice(-maxTurns);
  return slice
    .map((m) => {
      const who = m.sender === 'CUSTOMER' ? '客' : m.sender === 'AI' ? '店' : '人';
      return `${who}: ${m.content}`;
    })
    .join('\n');
}

export async function runThinBrain(
  messages: AiMessageContext[],
  currentMessage: string,
  knowledgeContext: string,
  sessionFocus: ThinSessionFocus,
  confirmationPending: boolean,
  carryForwardPolicyBlock: string,
): Promise<
  | { ok: true; rawJson: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string }
> {
  const system = buildThinSystemPrompt();
  const user = buildThinUserPayload({
    sessionFocus,
    recentTranscript: formatRecentMessages(messages, 14),
    knowledgeContext,
    currentMessage,
    confirmationPending,
    carryForwardPolicyBlock,
  });
  const res = await callOpenAiPlannerJson(system, user);
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    rawJson: res.content,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
  };
}
