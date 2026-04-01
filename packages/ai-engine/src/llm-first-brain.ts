import type { LLMBrainOutput } from './types';
import { callOpenAiPlannerJson } from './llm-client';
import { parseLlmJson } from './llm-validate';

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

const SERVICE_PLACEHOLDERS = new Set(['', 'null', 'undefined', 'unknown', 'n/a', 'none']);

function normalizeResolvedServiceValue(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (SERVICE_PLACEHOLDERS.has(t.toLowerCase())) return null;
  return t;
}

function normalizeBrainOutput(raw: unknown): LLMBrainOutput | null {
  if (!isObject(raw)) return null;
  if (typeof raw.reply !== 'string' || !isObject(raw.decisions)) return null;
  const d = raw.decisions as Record<string, unknown>;
  const output: LLMBrainOutput = {
    thinking: typeof raw.thinking === 'string' ? raw.thinking : '',
    decisions: {
      userIntent: Array.isArray(d.userIntent) ? d.userIntent.map((x) => String(x)) : [],
      resolvedService: normalizeResolvedServiceValue(d.resolvedService),
      resolvedServiceConfidence:
        typeof d.resolvedServiceConfidence === 'number' ? d.resolvedServiceConfidence : 0,
      nextMove:
        d.nextMove === 'ask_clarify' ||
        d.nextMove === 'ask_booking_info' ||
        d.nextMove === 'handoff' ||
        d.nextMove === 'post_booking'
          ? d.nextMove
          : 'answer',
      detectedSlots: isObject(d.detectedSlots)
        ? {
            serviceName:
              typeof d.detectedSlots.serviceName === 'string' ? d.detectedSlots.serviceName : undefined,
            date: typeof d.detectedSlots.date === 'string' ? d.detectedSlots.date : undefined,
            time: typeof d.detectedSlots.time === 'string' ? d.detectedSlots.time : undefined,
            customerName:
              typeof d.detectedSlots.customerName === 'string'
                ? d.detectedSlots.customerName
                : undefined,
            phone: typeof d.detectedSlots.phone === 'string' ? d.detectedSlots.phone : undefined,
          }
        : {},
      phaseTransition:
        d.phaseTransition === 'exploring' ||
        d.phaseTransition === 'interested' ||
        d.phaseTransition === 'booking' ||
        d.phaseTransition === 'handoff' ||
        d.phaseTransition === 'post_booking'
          ? d.phaseTransition
          : null,
    },
    reply: raw.reply,
  };
  return output;
}

// Exported for focused regression tests.
export const __normalizeResolvedServiceForTest = normalizeResolvedServiceValue;

export async function runLlmConversationBrain(input: {
  systemPrompt: string;
  recentHistory: string;
  userMessage: string;
  factsSummary: string;
  constraints: string;
}): Promise<
  | {
      ok: true;
      output: LLMBrainOutput;
      inputTokens: number;
      outputTokens: number;
    }
  | { ok: false; error: string }
> {
  const mockRaw = (process.env.LLM_FIRST_MOCK_BRAIN ?? '').trim().toLowerCase();
  const mockEnabled = mockRaw === '1' || mockRaw === 'true' || mockRaw === 'yes';
  if (mockEnabled) {
    const focusMatch = input.factsSummary.match(/ServiceFocus:\s*(.+)/i);
    const resolvedService = normalizeResolvedServiceValue(focusMatch ? focusMatch[1].trim() : null);

    const wantsHandoff = /HANDOFF_CONSTRAINT/i.test(input.constraints);
    const bookingMissing = /BOOKING_MISSING_SLOT/i.test(input.constraints);

    const nextMove = wantsHandoff ? 'handoff' : bookingMissing ? 'ask_booking_info' : 'answer';
    const phaseTransition = wantsHandoff ? 'handoff' : bookingMissing ? 'booking' : 'interested';

    const reply = wantsHandoff
      ? '明白，我幫你轉交同事跟進。請稍等，同事會盡快聯絡你 🙏'
      : bookingMissing
        ? '明白～我會一步步幫你記低。你想約邊日，定係幾點方便先？'
        : '收到～如果你想，我可以由「功效/適合對象」同你逐步講清楚，跟住再幫你安排預約。';

    return {
      ok: true,
      output: {
        thinking: 'mock',
        decisions: {
          userIntent: wantsHandoff ? ['HANDOFF'] : bookingMissing ? ['BOOKING'] : ['INQUIRY'],
          resolvedService,
          resolvedServiceConfidence: resolvedService ? 0.9 : 0,
          nextMove,
          detectedSlots: {},
          phaseTransition,
        },
        reply,
      },
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const system = `${input.systemPrompt}
You must output JSON with this schema:
{
  "thinking": "short rationale",
  "decisions": {
    "userIntent": ["..."],
    "resolvedService": "string|null",
    "resolvedServiceConfidence": 0-1,
    "nextMove": "answer|ask_clarify|ask_booking_info|handoff|post_booking",
    "detectedSlots": {"serviceName?":"","date?":"","time?":"","customerName?":"","phone?":""},
    "phaseTransition": "exploring|interested|booking|handoff|post_booking|null"
  },
  "reply": "final customer-facing reply in Cantonese Traditional Chinese"
}`;
  const user = [
    `RECENT_HISTORY:\n${input.recentHistory || '(empty)'}`,
    `USER_MESSAGE:\n${input.userMessage}`,
    `FACTS:\n${input.factsSummary || '(none)'}`,
    `CONSTRAINTS:\n${input.constraints || '(none)'}`,
  ].join('\n\n');

  const call = await callOpenAiPlannerJson(system, user);
  if (!call.ok) {
    const err = call.error || 'unknown';
    if (/missing_api_key/i.test(err)) return { ok: false, error: 'llm_missing_api_key' };
    if (/timed out|timeout/i.test(err)) return { ok: false, error: 'llm_timeout' };
    return { ok: false, error: err };
  }

  const parsed = parseLlmJson(call.content);
  if (!parsed.ok) return { ok: false, error: 'json_parse_failure' };

  const output = normalizeBrainOutput(parsed.parsed);
  if (!output) return { ok: false, error: 'invalid_schema' };

  return {
    ok: true,
    output,
    inputTokens: call.inputTokens,
    outputTokens: call.outputTokens,
  };
}

