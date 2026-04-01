import type { ConversationState, UserPhase } from './types';
import { extractSlots } from './booking-state';
import { foldIntentMessage } from './intent-classifier';

function inferPhase(msg: string, current: UserPhase): UserPhase {
  if (/真人|人工|客服|同事|manager/i.test(msg)) return 'handoff';
  if (/確認預約|submit booking|confirm booking/i.test(msg)) return 'post_booking';
  if (/想預約|想book|幫我約|我想約時間|預約|book|訂位/i.test(msg)) return 'booking';
  if (/有興趣|想了解下|想試|想做|interested/i.test(msg)) return 'interested';
  return current;
}

function serviceSwitchSignal(msg: string): boolean {
  return /唔係呢個|唔要呢個|轉做|改做|換做|instead|switch/i.test(msg);
}

function correctionContinuationSignal(msg: string): boolean {
  return /^(係|啱|好|ok|頭先打錯字|打錯字|更正|我想知道有冇呢個服務)/i.test(msg.trim());
}

export function hydrateConversationState(
  prev: ConversationState,
  userMessage: string,
  serviceCandidate: string | null,
): ConversationState {
  const folded = foldIntentMessage(userMessage.trim());
  const slots = extractSlots(folded);
  const nextPhase = inferPhase(folded, prev.userPhase);
  const explicitSwitch = serviceCandidate && serviceSwitchSignal(folded);
  const serviceFocus =
    correctionContinuationSignal(folded)
      ? prev.serviceFocus
      : explicitSwitch || !prev.serviceFocus
      ? (serviceCandidate ?? prev.serviceFocus)
      : prev.serviceFocus;

  const turnWithUser = prev.recentHistory.concat({
    role: 'user' as const,
    content: userMessage,
    ts: Date.now(),
  });

  // Slot-rich message is a strong booking signal.
  const hasSlotPayload = !!(slots.date || slots.time || slots.customerName || slots.phone);
  const stabilizedPhase = correctionContinuationSignal(folded) ? prev.userPhase : nextPhase;

  return {
    ...prev,
    serviceFocus,
    userPhase: hasSlotPayload ? 'booking' : stabilizedPhase,
    turnCount: prev.turnCount + 1,
    recentHistory: turnWithUser.slice(-10),
  };
}

export function commitAssistantTurn(
  state: ConversationState,
  reply: string,
  phaseHint?: UserPhase | null,
  serviceFocusHint?: string | null,
): ConversationState {
  return {
    ...state,
    serviceFocus: serviceFocusHint ?? state.serviceFocus,
    userPhase: phaseHint ?? state.userPhase,
    recentHistory: state.recentHistory
      .concat({
        role: 'assistant',
        content: reply,
        ts: Date.now(),
      })
      .slice(-10),
  };
}

