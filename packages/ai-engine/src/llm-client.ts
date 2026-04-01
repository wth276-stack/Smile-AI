import OpenAI from 'openai';
import { llmModelId, llmTimeoutMs } from './llm-config';

export type LlmCallResult =
  | { ok: true; content: string; inputTokens: number; outputTokens: number }
  | { ok: false; error: string };

/**
 * Calls OpenAI chat completions with JSON mode. Caller handles parse/validate.
 */
export async function callOpenAiPlannerJson(system: string, user: string): Promise<LlmCallResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: 'missing_api_key' };

  const client = new OpenAI({ apiKey, timeout: llmTimeoutMs() });

  try {
    const res = await client.chat.completions.create({
      model: llmModelId(),
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const content = res.choices[0]?.message?.content;
    if (!content) return { ok: false, error: 'empty_content' };
    const usage = res.usage;
    return {
      ok: true,
      content,
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
