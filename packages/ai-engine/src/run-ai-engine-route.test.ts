/**
 * Smoke: runAiEngine() routes to V2 by default (slot gate, etc.); opt out with USE_V1_ENGINE=1.
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
  const prevV1 = process.env.USE_V1_ENGINE;
  const prevV2 = process.env.USE_V2_ENGINE;

  beforeEach(() => {
    runAiEngineV2Mock.mockClear();
    delete process.env.USE_V1_ENGINE;
    delete process.env.USE_V2_ENGINE;
  });

  afterEach(() => {
    if (prevV1 === undefined) delete process.env.USE_V1_ENGINE;
    else process.env.USE_V1_ENGINE = prevV1;
    if (prevV2 === undefined) delete process.env.USE_V2_ENGINE;
    else process.env.USE_V2_ENGINE = prevV2;
  });

  it('defaults to runAiEngineV2 when no engine env is set (production path)', async () => {
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
