/**
 * Compare V2 system prompts for two tenant personas (read-only; no engine changes).
 *
 * Run from repo root:
 *   npx ts-node --project tsconfig.scripts.json scripts/test-persona-switch.ts
 */
import type { PromptContext } from '../packages/ai-engine/src/v2/types';
import type { BookingDraft, KnowledgeChunk } from '../packages/ai-engine/src/types';
import { buildSystemPrompt } from '../packages/ai-engine/src/v2/prompt';

const emptyDraft: BookingDraft = {
  bookingId: null,
  serviceName: null,
  serviceDisplayName: null,
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

/** One structured chunk without suitable/precaution so KB defaults appear in output. */
function mockKbChunk(): KnowledgeChunk[] {
  return [
    {
      documentId: 'mock-svc-1',
      title: '示範服務',
      content: '示範內容',
      score: 1,
      price: 'HK$100',
      duration: '30 分鐘',
      effect: '示範功效',
    },
  ];
}

function baseCtx(overrides: Partial<PromptContext>): PromptContext {
  return {
    tenantProfile: {},
    knowledgeChunks: mockKbChunk(),
    conversationHistory: [],
    currentMessage: 'hi',
    currentDraft: emptyDraft,
    contactName: null,
    tenantSettings: {},
    ...overrides,
  };
}

function excerptOpening(prompt: string, lines = 25): string {
  return prompt.split('\n').slice(0, lines).join('\n');
}

function main() {
  const beauty = baseCtx({
    tenantProfile: {
      businessName: '美容療程示範店',
      businessType: 'beauty and wellness salon',
    },
  });

  const clinic = baseCtx({
    tenantProfile: {
      businessName: '康健家庭醫學診所',
      businessType: 'medical clinic',
    },
  });

  const p1 = buildSystemPrompt(beauty);
  const p2 = buildSystemPrompt(clinic);

  console.log('========== BEAUTY (beauty and wellness salon) ==========\n');
  console.log(excerptOpening(p1, 80));
  console.log('\n--- Snippets to verify ---');
  console.log(
    p1.includes('You are a WhatsApp sales assistant for 美容療程示範店, a beauty and wellness salon')
      ? 'OK: opening line matches beauty tenant'
      : 'MISS: beauty opening line',
  );
  console.log(
    p1.includes('Suitable for: General customers') ? 'OK: KB default suitable (beauty branch)' : 'Check: suitable line',
  );
  console.log('\n--- Knowledge Base excerpt (beauty) ---');
  console.log(kbExcerpt(p1));

  console.log('\n\n========== CLINIC (medical clinic) ==========\n');
  console.log(excerptOpening(p2, 80));
  console.log('\n--- Snippets to verify ---');
  console.log(
    p2.includes('You are a WhatsApp sales assistant for 康健家庭醫學診所, a medical clinic')
      ? 'OK: opening line matches clinic tenant'
      : 'MISS: clinic opening line',
  );
  console.log(
    p2.includes('Suitable for: General patients') ? 'OK: KB default suitable (clinic branch)' : 'Check: suitable line',
  );
  console.log('\n--- Knowledge Base excerpt (clinic) ---');
  console.log(kbExcerpt(p2));
}

/** Lines under ## Knowledge Base through ## Booking State (visual compare). */
function kbExcerpt(full: string): string {
  const start = full.indexOf('## Knowledge Base');
  const end = full.indexOf('## Booking State');
  if (start === -1) return '(Knowledge Base section not found)';
  const slice = end === -1 ? full.slice(start) : full.slice(start, end);
  return slice.trim();
}

main();
