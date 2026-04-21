import { buildAiMessageMetadata } from './ai-message-metadata';
import type { AiEngineResult } from '@ats/ai-engine';

function makeResult(opts: {
  rawLlmJson?: string;
  _v2Action?: string;
  replyText?: string;
  intents?: string[];
}): AiEngineResult & { _rawLlmJson?: string; _v2Action?: string } {
  return {
    replyText: opts.replyText ?? '',
    signals: {
      intents: opts.intents ?? ['OTHER'],
      extractedFields: {},
      action: 'REPLY',
      bookingDraft: {} as any,
      confirmationPending: false,
    },
    sideEffects: [],
    shouldHandoff: false,
    analytics: { model: 'test', inputTokens: 0, outputTokens: 0, durationMs: 0 },
    _rawLlmJson: opts.rawLlmJson,
    _v2Action: opts._v2Action,
  } as any;
}

describe('buildAiMessageMetadata', () => {
  it('patches action from raw LLM REPLY to validated CONFIRM_BOOKING', () => {
    const raw = JSON.stringify({
      reply: '好的，請確認以上預約資料是否正確！',
      intent: 'REPLY',
      action: 'REPLY',
      newSlots: { date: '2026-04-23', time: '16:00' },
    });

    const result = makeResult({ rawLlmJson: raw, _v2Action: 'CONFIRM_BOOKING', intents: ['BOOKING_REQUEST'] });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };
    const parsed = JSON.parse(meta.rawLlmJson);

    expect(parsed.action).toBe('CONFIRM_BOOKING');
  });

  it('patches intent to validated value', () => {
    const raw = JSON.stringify({
      reply: '好的，請確認以上預約資料是否正確！',
      intent: 'REPLY',
      action: 'REPLY',
    });

    const result = makeResult({ rawLlmJson: raw, _v2Action: 'CONFIRM_BOOKING', intents: ['BOOKING_REQUEST'] });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };
    const parsed = JSON.parse(meta.rawLlmJson);

    expect(parsed.intent).toBe('BOOKING_REQUEST');
  });

  it('preserves original reply and newSlots after patching action/intent', () => {
    const raw = JSON.stringify({
      reply: '好的，請確認！',
      intent: 'REPLY',
      action: 'REPLY',
      newSlots: { date: '2026-04-23', time: '16:00', customerName: 'Yuki' },
    });

    const result = makeResult({ rawLlmJson: raw, _v2Action: 'CONFIRM_BOOKING', intents: ['BOOKING_REQUEST'] });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };
    const parsed = JSON.parse(meta.rawLlmJson);

    expect(parsed.reply).toBe('好的，請確認！');
    expect(parsed.newSlots).toEqual({ date: '2026-04-23', time: '16:00', customerName: 'Yuki' });
  });

  it('falls back to raw string when rawLlmJson is invalid JSON', () => {
    const invalid = '{not valid json';
    const result = makeResult({ rawLlmJson: invalid, _v2Action: 'CONFIRM_BOOKING' });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };

    expect(meta.rawLlmJson).toBe(invalid);
  });

  it('falls back to raw string when rawLlmJson parses to non-object (array)', () => {
    const arrayJson = JSON.stringify([1, 2, 3]);
    const result = makeResult({ rawLlmJson: arrayJson, _v2Action: 'CONFIRM_BOOKING' });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };

    expect(meta.rawLlmJson).toBe(arrayJson);
  });

  it('falls back to raw string when rawLlmJson parses to non-object (string)', () => {
    const stringJson = JSON.stringify('hello');
    const result = makeResult({ rawLlmJson: stringJson, _v2Action: 'CONFIRM_BOOKING' });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };

    expect(meta.rawLlmJson).toBe(stringJson);
  });

  it('does not patch when action already matches _v2Action', () => {
    const raw = JSON.stringify({
      reply: 'ok',
      intent: 'BOOKING_REQUEST',
      action: 'CONFIRM_BOOKING',
    });

    const result = makeResult({ rawLlmJson: raw, _v2Action: 'CONFIRM_BOOKING', intents: ['BOOKING_REQUEST'] });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };

    // Should be identical (no unnecessary re-serialization differences)
    const parsed = JSON.parse(meta.rawLlmJson);
    expect(parsed.action).toBe('CONFIRM_BOOKING');
    expect(parsed.intent).toBe('BOOKING_REQUEST');
  });

  it('synthesizes JSON from _v2Action and replyText when no rawLlmJson', () => {
    const result = makeResult({ _v2Action: 'CONFIRM_BOOKING', replyText: '請確認', intents: ['BOOKING_REQUEST'] });
    const meta = buildAiMessageMetadata(result) as { rawLlmJson: string };
    const parsed = JSON.parse(meta.rawLlmJson);

    expect(parsed.action).toBe('CONFIRM_BOOKING');
    expect(parsed.reply).toBe('請確認');
    expect(parsed.intent).toBe('BOOKING_REQUEST');
  });

  it('returns undefined when no rawLlmJson and no _v2Action', () => {
    const result = makeResult({});
    const meta = buildAiMessageMetadata(result);

    expect(meta).toBeUndefined();
  });
});