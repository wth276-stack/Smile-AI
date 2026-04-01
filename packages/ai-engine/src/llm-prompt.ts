import type { AiEngineInput } from './types';
import { LLM_PLANNER_JSON_INSTRUCTION } from './llm-contract';
import type { StrategyConfig } from './strategy-selector';
import type { ConversationStage } from './conversation-stage';
import type { CustomerSignals } from './customer-signals';
import { buildStrategyGuardPrompt, getStageGuidance } from './llm-strategy-guard';

function catalogSummary(input: AiEngineInput): string {
  const titles = [...new Set(input.knowledge.map((k) => k.title).filter(Boolean))];
  return titles.slice(0, 40).join('、') || '(no documents)';
}

function draftSummary(input: AiEngineInput): string {
  const d = input.bookingDraft;
  if (!d) return 'null';
  return JSON.stringify(
    {
      serviceDisplayName: d.serviceDisplayName,
      date: d.date,
      time: d.time,
      customerName: d.customerName,
      phone: d.phone,
    },
    null,
    0,
  );
}

function recentTranscript(input: AiEngineInput, maxTurns: number): string {
  const lines = input.messages.slice(-maxTurns).map((m) => {
    const who = m.sender === 'CUSTOMER' ? '客戶' : '助手';
    return `${who}: ${m.content}`;
  });
  return lines.join('\n') || '(no prior messages)';
}

/** Optional strategy context for LLM prompt */
export interface StrategyContext {
  strategy: StrategyConfig;
  stage: ConversationStage;
  signals: CustomerSignals;
}

export function buildLlmPlannerMessages(
  input: AiEngineInput,
  strategyContext?: StrategyContext,
): { system: string; user: string } {
  const systemParts: string[] = [
    'You are a planner for a Hong Kong beauty/clinic WhatsApp chat assistant. Your job is to classify intent and extract slots from the customer message — NOT to write the final reply.',
    '',
    '## INTENT RULES',
    '- GREETING: first message or pure greeting only',
    '- PRICE: customer asking about price / cost / 幾錢 / 多少錢',
    '- DETAIL: customer asking about effects / process / ingredients / duration',
    '- INQUIRY: general questions about a service (not price-specific)',
    '- BOOKING: customer wants to book / 預約 and no prior booking draft',
    '- BOOKING_SLOT_FILL: customer is filling in date / time / name / phone for an existing draft',
    '- CONTACT_INFO: customer provides name or phone only, no booking context',
    '- OTHER: anything else',
    '',
    '## SLOT EXTRACTION RULES',
    '- customerName: extract ONLY if the customer explicitly states their own name (e.g. 我叫X, 我係X, X係我). NEVER extract a service name as customerName.',
    '- phone: 8-digit HK numbers, or international format. Strip spaces/dashes.',
    '- date: convert to YYYY-MM-DD. 聽日=tomorrow, 後日=day after tomorrow, 今日=today.',
    '- time: convert to HH:mm 24h format. 下午3點=15:00, 晚上7點=19:00, 早上10點=10:00.',
    '- serviceMention: the service name the customer mentioned, verbatim. null if none.',
    '',
    '## IMPORTANT',
    '- Do NOT put service names into customerName.',
    '- Do NOT invent slots that were not mentioned.',
    '- If the customer message only updates one slot (e.g. just a time), only fill that slot.',
    '- usesDraftContext: true if your answer references the current booking draft.',
    '- switchedAwayFromDraftService: true if customer is now asking about a DIFFERENT service than the draft.',
  ];

  // Add strategy guard if available
  if (strategyContext) {
    systemParts.push('');
    systemParts.push('## RESPONSE STRATEGY');
    systemParts.push(getStageGuidance(strategyContext.stage));
    systemParts.push('');
    systemParts.push(buildStrategyGuardPrompt(
      strategyContext.strategy,
      strategyContext.stage,
      strategyContext.signals,
    ));
  }

  systemParts.push('');
  systemParts.push(LLM_PLANNER_JSON_INSTRUCTION);

  const system = systemParts.join('\n');

  const user = [
    `Known services: ${catalogSummary(input)}`,
    `Current booking draft: ${draftSummary(input)}`,
    `Recent conversation:\n${recentTranscript(input, 14)}`,
    `Latest customer message: ${input.currentMessage}`,
  ].join('\n\n');

  return { system, user };
}