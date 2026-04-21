import type { Prisma } from '@prisma/client';
import type { AiEngineResult } from '@ats/ai-engine';

/** V2: prefer full LLM JSON from metadata for engine history (preserves action). Legacy rows use plain content. */
export function messageContentForAiEngine(m: { sender: string; content: string; metadata: unknown }): string {
  if (m.sender !== 'AI') return m.content;
  const meta = m.metadata as Record<string, unknown> | null | undefined;
  const raw = meta && typeof meta.rawLlmJson === 'string' ? meta.rawLlmJson.trim() : '';
  return raw.length > 0 ? raw : m.content;
}

/** Store raw LLM JSON in Message.metadata.rawLlmJson for next-turn V2 context.
 *  Patches action/intent to match the validated/effective values so the next
 *  turn's conversation history reflects what the system actually did. */
export function buildAiMessageMetadata(result: AiEngineResult): Prisma.InputJsonValue | undefined {
  const r = result as AiEngineResult & { _rawLlmJson?: string; _v2Action?: string };
  const raw = r._rawLlmJson;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (typeof r._v2Action === 'string' && parsed.action !== r._v2Action) {
          parsed.action = r._v2Action;
        }
        const validatedIntent = result.signals?.intents?.[0];
        if (typeof validatedIntent === 'string' && parsed.intent !== validatedIntent) {
          parsed.intent = validatedIntent;
        }
        return { rawLlmJson: JSON.stringify(parsed) };
      }
      return { rawLlmJson: raw };
    } catch {
      return { rawLlmJson: raw };
    }
  }
  if (typeof r._v2Action === 'string' && result.replyText) {
    return {
      rawLlmJson: JSON.stringify({
        reply: result.replyText,
        action: r._v2Action,
        intent: result.signals?.intents?.[0] ?? 'OTHER',
      }),
    };
  }
  return undefined;
}