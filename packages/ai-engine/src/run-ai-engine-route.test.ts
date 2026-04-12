/**
 * Smoke: runAiEngine() must route to V2 when USE_V2_ENGINE=true (protects future V1 removal).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AiEngineInput } from './types';

const runAiEngineV2Mock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    replyText: 'ok',
    signals: { intents: ['OTHER'], extractedFields: {}, action: 'REPLY_ONLY' },
    sideEffects: [],
    shouldHandoff: false,
    analytics: { model: 'gpt-4o-mini', inputTokens: 1, outputTokens: 1, durationMs: 1 },
  }),
);

vi.mock('./v2/engine', () => ({
  runAiEngineV2: runAiEngineV2Mock,
}));

vi.mock('./orchestrator', () => ({
  runAiEngine: vi.fn().mockRejectedValue(new Error('V1 should not run')),
}));

import { runAiEngine } from './index';

describe('runAiEngine routing', () => {
  const prev = process.env.USE_V2_ENGINE;

  beforeEach(() => {
    runAiEngineV2Mock.mockClear();
    process.env.USE_V2_ENGINE = 'true';
  });

  afterEach(() => {
    process.env.USE_V2_ENGINE = prev;
  });

  it('calls runAiEngineV2 when USE_V2_ENGINE=true', async () => {
    const input: AiEngineInput = {
      tenant: { id: 't', plan: 'STARTER', settings: {} },
      contact: { id: 'c', tags: [] },
      conversation: { id: 'conv', channel: 'WEBCHAT' as any, messageCount: 1 },
      messages: [],
      currentMessage: 'hi',
      knowledge: [],
    };
    const out = await runAiEngine(input);
    expect(runAiEngineV2Mock).toHaveBeenCalledTimes(1);
    expect(runAiEngineV2Mock).toHaveBeenCalledWith(input);
    expect(out.replyText).toBe('ok');
  });
});
