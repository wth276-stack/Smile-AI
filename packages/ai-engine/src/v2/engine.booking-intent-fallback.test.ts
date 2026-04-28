import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelType } from '@ats/shared';
import type { BookingDraft, KnowledgeChunk, AiEngineInput } from '../types';

// ── Mock OpenAI so runAiEngineV2 never makes a real API call ──

const { mockCreate, MockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  }
  return { mockCreate, MockOpenAI };
});
vi.mock('openai', () => ({
  default: MockOpenAI,
  APIConnectionError: class extends Error {},
  APIConnectionTimeoutError: class extends Error {},
}));

import { runAiEngineV2 } from './engine';

// ── Fixtures ──

const HIFU_KB: KnowledgeChunk = {
  documentId: 'doc-hifu',
  title: 'HIFU 緊緻療程',
  content: 'HIFU 高強度聚焦超聲波，有效緊緻肌膚，提升輪廓。',
  score: 0.95,
  aliases: ['hifu', 'HIFU'],
};

const BOTOX_KB: KnowledgeChunk = {
  documentId: 'doc-botox',
  title: 'Botox 瘦面療程',
  content: 'Botox 肉毒桿菌素瘦面療程，有效修飾面形。',
  score: 0.92,
  aliases: ['botox', 'Botox'],
};

const FAQ_PRICE_KB: KnowledgeChunk = {
  documentId: 'doc-faq-price',
  title: 'HIFU 價錢',
  content: 'HIFU 療程價錢由 $2000 起。',
  score: 0.90,
};

const FAQ_EFFECT_KB: KnowledgeChunk = {
  documentId: 'doc-faq-effect',
  title: 'HIFU 有咩功效',
  content: 'HIFU 主要功效係緊緻肌膚、提升輪廓、減少皺紋。',
  score: 0.90,
};

function makeInput(overrides: Partial<AiEngineInput> & { currentMessage: string }): AiEngineInput {
  return {
    tenant: { id: 'test-tenant', plan: 'professional', settings: {} },
    contact: { id: 'contact-1', name: 'Test User', tags: [] },
    conversation: { id: 'conv-1', channel: ChannelType.WHATSAPP, messageCount: 1 },
    messages: [],
    knowledge: [],
    ...overrides,
  };
}

function fakeLlmResponse(overrides: {
  reply: string;
  action: string;
  intent: string;
  newSlots?: Partial<BookingDraft>;
}) {
  return {
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: JSON.stringify({
            thinking: '',
            reply: overrides.reply,
            intent: overrides.intent,
            action: overrides.action,
            newSlots: overrides.newSlots ?? {},
          }),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

describe('Booking-intent deterministic fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_ENGINE_V2_DEBUG = '';
  });

  afterEach(() => {
    delete process.env.AI_ENGINE_V2_DEBUG;
  });

  // ── Core regression: the real bug ──
  // LLM returns REPLY with empty newSlots, but user message has booking intent
  // AND KB contains the matching service → deterministic fallback must upgrade
  // to COLLECT_BOOKING and set BOOKING_REQUEST intent.

  it('我想預約hifu — LLM returns REPLY+empty slots → fallback upgrades to COLLECT_BOOKING', async () => {
    // This is the real bug scenario: LLM misclassifies as REPLY with no slots,
    // but deterministic fallback + inferMissingService fills the service name
    mockCreate.mockResolvedValue(
      fakeLlmResponse({
        reply: 'HIFU 係一個緊緻療程嚟嘅，你想了解多啲？',
        action: 'REPLY',
        intent: 'PRODUCT_INQUIRY',
        newSlots: {}, // LLM returns NO slots — service name filled by deterministic fallback
      }),
    );

    const result = await runAiEngineV2(
      makeInput({
        currentMessage: '我想預約hifu',
        knowledge: [HIFU_KB],
        bookingDraft: {
          bookingId: null,
          mode: null,
          serviceName: null,
          serviceDisplayName: null,
          date: null,
          time: null,
          customerName: null,
          phone: null,
        },
      }),
    );

    expect((result as any)._v2Action).toBe('COLLECT_BOOKING');
    expect(result.signals.action).toBe('ASK_INFO');
    expect(result.signals.intents).toContain('BOOKING_REQUEST');
    expect(result.signals.bookingDraft?.serviceName).toBeTruthy();
  });

  it('我想預約botox — LLM returns REPLY_ONLY + slots → fallback upgrades', async () => {
    // Botox case: LLM does return serviceName, but misclassifies action as REPLY_ONLY
    mockCreate.mockResolvedValue(
      fakeLlmResponse({
        reply: 'Botox 可以幫你瘦面，有咩想了解？',
        action: 'REPLY_ONLY',
        intent: 'PRODUCT_INQUIRY',
        newSlots: { serviceName: 'Botox 瘦面療程', serviceDisplayName: 'Botox 瘦面療程' },
      }),
    );

    const result = await runAiEngineV2(
      makeInput({
        currentMessage: '我想預約botox',
        knowledge: [BOTOX_KB],
        bookingDraft: {
          bookingId: null,
          mode: null,
          serviceName: null,
          serviceDisplayName: null,
          date: null,
          time: null,
          customerName: null,
          phone: null,
        },
      }),
    );

    expect((result as any)._v2Action).toBe('COLLECT_BOOKING');
    expect(result.signals.action).toBe('ASK_INFO');
    expect(result.signals.intents).toContain('BOOKING_REQUEST');
    expect(result.signals.bookingDraft?.serviceName).toBeTruthy();
  });

  // ── Negative: price FAQ must stay REPLY ──

  it('hifu幾錢 → stays REPLY (price FAQ, no booking intent words)', async () => {
    mockCreate.mockResolvedValue(
      fakeLlmResponse({
        reply: 'HIFU 療程價錢由 $2000 起。',
        action: 'REPLY',
        intent: 'PRICE_INQUIRY',
        newSlots: { serviceName: 'HIFU 緊緻療程' },
      }),
    );

    const result = await runAiEngineV2(
      makeInput({
        currentMessage: 'hifu幾錢',
        knowledge: [HIFU_KB, FAQ_PRICE_KB],
      }),
    );

    // No booking intent word (預約/想約/book/訂位/訂座) in message
    expect((result as any)._v2Action).toBe('REPLY');
    expect(result.signals.action).toBe('REPLY_ONLY');
  });

  // ── Negative: non-booking service inquiry must stay REPLY ──

  it('hifu有咩功效 → stays REPLY (no booking intent words)', async () => {
    mockCreate.mockResolvedValue(
      fakeLlmResponse({
        reply: 'HIFU 主要功效係緊緻肌膚、提升輪廓。',
        action: 'REPLY',
        intent: 'PRODUCT_INQUIRY',
        newSlots: { serviceName: 'HIFU 緊緻療程' },
      }),
    );

    const result = await runAiEngineV2(
      makeInput({
        currentMessage: 'hifu有咩功效',
        knowledge: [HIFU_KB, FAQ_EFFECT_KB],
      }),
    );

    expect((result as any)._v2Action).toBe('REPLY');
    expect(result.signals.action).toBe('REPLY_ONLY');
  });

  // ── Negative: modify mode must NOT be upgraded ──

  it('modify mode must NOT be upgraded by booking-intent fallback', async () => {
    mockCreate.mockResolvedValue(
      fakeLlmResponse({
        reply: '你想改期？請提供新嘅日期同時間。',
        action: 'REPLY',
        intent: 'BOOKING_CHANGE',
        newSlots: {},
      }),
    );

    const result = await runAiEngineV2(
      makeInput({
        currentMessage: '我想預約改期hifu',
        knowledge: [HIFU_KB],
        bookingDraft: {
          bookingId: 'booking-1',
          mode: 'modify',
          serviceName: 'HIFU 緊緻療程',
          serviceDisplayName: 'HIFU 緊緻療程',
          date: '2026-04-20',
          time: '14:00',
          customerName: 'Test',
          phone: '91234567',
        },
      }),
    );

    // The fallback must NOT fire for modify mode
    expect(result.signals.intents).not.toContain('BOOKING_REQUEST');
    expect((result as any)._v2Action).not.toBe('COLLECT_BOOKING');
  });

  // ── Negative: cancel mode must NOT be upgraded ──

  it('cancel mode must NOT be upgraded by booking-intent fallback', async () => {
    mockCreate.mockResolvedValue(
      fakeLlmResponse({
        reply: '你係咪想取消預約？',
        action: 'REPLY',
        intent: 'BOOKING_CANCEL',
        newSlots: {},
      }),
    );

    const result = await runAiEngineV2(
      makeInput({
        currentMessage: '我想預約取消',
        knowledge: [HIFU_KB],
        bookingDraft: {
          bookingId: 'booking-1',
          mode: 'cancel',
          serviceName: 'HIFU 緊緻療程',
          serviceDisplayName: 'HIFU 緊緻療程',
          date: '2026-04-20',
          time: '14:00',
          customerName: 'Test',
          phone: '91234567',
        },
      }),
    );

    expect(result.signals.intents).not.toContain('BOOKING_REQUEST');
    expect((result as any)._v2Action).not.toBe('COLLECT_BOOKING');
  });
});