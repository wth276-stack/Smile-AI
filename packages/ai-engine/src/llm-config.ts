export type AiEngineMode = 'rule' | 'llm' | 'auto';

/**
 * Default is now **auto**: uses LLM when OPENAI_API_KEY is set, falls back to rule otherwise.
 * Set AI_ENGINE_MODE=rule to force rule-only mode.
 */
export function resolveAiEngineMode(): AiEngineMode {
  const raw = (process.env.AI_ENGINE_MODE || 'auto').trim().toLowerCase();
  if (raw === 'llm' || raw === 'auto' || raw === 'rule') return raw;
  return 'auto';
}

export function shouldAttemptLlmPlanner(): boolean {
  const mode = resolveAiEngineMode();
  if (mode === 'rule') return false;
  const key = process.env.OPENAI_API_KEY?.trim();
  return !!key;
}

export function llmTimeoutMs(): number {
  const n = parseInt(process.env.AI_ENGINE_LLM_TIMEOUT_MS || '15000', 10);
  return Number.isFinite(n) && n >= 3000 ? n : 15000;
}

export function llmModelId(): string {
  return process.env.OPENAI_DEFAULT_MODEL?.trim() || 'gpt-4o-mini';
}

function envTruthy(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Legacy LLM-first handler (separate from thin-core-v1). Default off — set USE_LLM_FIRST=true to enable. */
export function useLlmFirstPrototype(): boolean {
  return envTruthy(process.env.USE_LLM_FIRST);
}

/** LV1 thin engine: single-call JSON path. Default off — set THIN_CORE_V1=true to enable. Takes precedence over USE_LLM_FIRST. */
export function useThinCoreV1(): boolean {
  return envTruthy(process.env.THIN_CORE_V1);
}