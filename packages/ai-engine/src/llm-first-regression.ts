import type { BookingDraft, KnowledgeChunk, LLMBrainOutput } from './types';
import { emptyDraft } from './booking-state';
import { emptyConversationState, loadConversationState, clearLlmFirstStateStore } from './llm-first-state-policy';
import { hydrateConversationState } from './llm-first-state-hydrator';
import { assembleKbFactBundle } from './llm-first-kb-fact-assembler';
import { applyGuardrailGate } from './llm-first-guardrail-gate';
import { useLlmFirstPrototype } from './llm-config';
import { __normalizeResolvedServiceForTest } from './llm-first-brain';
import { handleConversationLLMFirst } from './llm-first-handler';

function mockKnowledge(): KnowledgeChunk[] {
  return [
    {
      documentId: 'svc-hifu',
      title: 'HIFU',
      content: 'HIFU\n功效：提拉緊緻\n不適合：孕婦\n價錢：HKD 1200',
      score: 1,
      price: 'HKD 1200',
      effect: '提拉緊緻',
      unsuitable: '孕婦',
      faqItems: [{ question: '有咩人唔啱做？', answer: '孕婦不建議。' }],
    },
  ];
}

function baseBrain(reply: string): LLMBrainOutput {
  return {
    thinking: 'test',
    decisions: {
      userIntent: ['INQUIRY'],
      resolvedService: 'HIFU',
      resolvedServiceConfidence: 0.9,
      nextMove: 'answer',
      detectedSlots: {},
      phaseTransition: 'interested',
    },
    reply,
  };
}

export async function verifyLlmFirstPrototypeRegression(): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const knowledge = mockKnowledge();

  // 1) carry-forward: HIFU 幾錢 -> 功效係咩
  let state = emptyConversationState('s1', 0);
  state = hydrateConversationState(state, 'HIFU 幾錢', 'HIFU');
  state = hydrateConversationState(state, '功效係咩', null);
  if (state.serviceFocus !== 'HIFU') {
    failures.push(`carry-forward service focus expected HIFU, got ${state.serviceFocus}`);
  }
  const facts1 = assembleKbFactBundle(knowledge, '功效係咩', state.serviceFocus);
  if (facts1.serviceFocus?.displayName !== 'HIFU') {
    failures.push('carry-forward facts should resolve HIFU');
  }

  // 2) carry-forward suitability
  const facts2 = assembleKbFactBundle(knowledge, '有咩人唔啱做', state.serviceFocus);
  if (facts2.serviceFocus?.displayName !== 'HIFU') {
    failures.push('suitability follow-up should still resolve HIFU');
  }

  // 3) handoff reliability
  const handoff = applyGuardrailGate({
    userMessage: '我想搵真人傾下',
    kbFacts: facts2,
    draft: emptyDraft(),
    brain: baseBrain('可以先同我講多啲嗎？'),
  });
  if (!handoff.shouldHandoff || !/同事|真人/.test(handoff.reply)) {
    failures.push(`handoff must be enforced, got ${handoff.reply}`);
  }

  // 4) natural interest transition signal
  const s2 = hydrateConversationState(emptyConversationState('s2', 0), 'HIFU 有咩功效？我有啲興趣想了解下', 'HIFU');
  if (s2.userPhase !== 'interested') {
    failures.push(`interest message should set phase interested, got ${s2.userPhase}`);
  }

  // 5) price safety patch
  const patched = applyGuardrailGate({
    userMessage: 'HIFU 幾錢',
    kbFacts: facts1,
    draft: emptyDraft(),
    brain: baseBrain('而家做緊 HKD 999'),
  });
  if (!patched.reply.includes('HKD 1200')) {
    failures.push(`price must be patched to KB exact value, got ${patched.reply}`);
  }

  // 6) multi-slot extraction in one message
  const withSlots = applyGuardrailGate({
    userMessage: '我想約 HIFU 4月10日 下午3點，我叫 Amy，電話 91234567',
    kbFacts: facts1,
    draft: emptyDraft(),
    brain: baseBrain('收到，幫你記低。'),
  });
  if (!(withSlots.slots.date && withSlots.slots.time && withSlots.slots.customerName && withSlots.slots.phone)) {
    failures.push(`slot extraction should capture date/time/name/phone, got ${JSON.stringify(withSlots.slots)}`);
  }

  // 7) TTL expiration
  clearLlmFirstStateStore();
  const first = loadConversationState('ttl-a', 0);
  first.serviceFocus = 'HIFU';
  const second = loadConversationState('ttl-a', 31 * 60 * 1000);
  if (second.serviceFocus !== null || second.turnCount !== 0) {
    failures.push('TTL expiration should reset session state after 30m inactivity');
  }

  // 8) USE_LLM_FIRST env toggles prototype gate (no forced-on in production)
  const prev = process.env.USE_LLM_FIRST;
  delete process.env.USE_LLM_FIRST;
  if (useLlmFirstPrototype()) {
    failures.push('useLlmFirstPrototype should be false when USE_LLM_FIRST unset');
  }
  process.env.USE_LLM_FIRST = 'true';
  if (!useLlmFirstPrototype()) {
    failures.push('useLlmFirstPrototype should be true when USE_LLM_FIRST=true');
  }
  if (prev !== undefined) process.env.USE_LLM_FIRST = prev;
  else delete process.env.USE_LLM_FIRST;

  // 9) normalize unresolved service placeholders
  const placeholders = ['', 'none', 'null', 'undefined', 'unknown', 'n/a'];
  for (const p of placeholders) {
    if (__normalizeResolvedServiceForTest(p) !== null) {
      failures.push(`resolvedService placeholder should normalize to null: "${p}"`);
    }
  }

  // 10) "hi" should not trigger service hallucination hard block
  const hiNoBlock = applyGuardrailGate({
    userMessage: 'hi',
    kbFacts: facts1,
    draft: emptyDraft(),
    brain: {
      ...baseBrain('Hi～可以幫到你咩？'),
      decisions: { ...baseBrain('').decisions, resolvedService: 'hi' },
    },
  });
  if (hiNoBlock.hardBlock) {
    failures.push(`"hi" should not hard block, got ${hiNoBlock.hardBlock.reason}`);
  }

  // 11) generic discovery should not hard block on unresolved/generic service
  const facialNoBlock = applyGuardrailGate({
    userMessage: '我想問有冇facial做',
    kbFacts: facts1,
    draft: emptyDraft(),
    brain: {
      ...baseBrain('我哋有唔同 facial 類型，可以講下你想改善咩。'),
      decisions: { ...baseBrain('').decisions, resolvedService: 'facial' },
    },
  });
  if (facialNoBlock.hardBlock) {
    failures.push(`generic discovery should not hard block, got ${facialNoBlock.hardBlock.reason}`);
  }

  // 12) truly invented service in assistant reply should still hard-block
  const inventedBlock = applyGuardrailGate({
    userMessage: '有咩療程',
    kbFacts: facts1,
    draft: emptyDraft(),
    brain: {
      ...baseBrain('我推薦 MarsLift Pro，效果好快。'),
      decisions: { ...baseBrain('').decisions, resolvedService: 'MarsLift Pro' },
    },
  });
  if (!inventedBlock.hardBlock || !/service_hallucination/i.test(inventedBlock.hardBlock.reason)) {
    failures.push('invented assistant service name should hard-block');
  }

  // 13) salon address question should answer salon info directly
  const salonKnowledge: KnowledgeChunk[] = [
    {
      documentId: 'salon-info',
      title: 'Salon Info',
      content: '地址：尖沙咀彌敦道 100 號\n營業時間：10:00-20:00',
      score: 1,
    },
  ];
  const savedMock = process.env.LLM_FIRST_MOCK_BRAIN;
  process.env.LLM_FIRST_MOCK_BRAIN = '1';
  const salonResult = await handleConversationLLMFirst({
    tenant: { id: 't', plan: 'p', settings: {} },
    contact: { id: 'c', name: 'Demo', tags: [] },
    conversation: { id: 'salon-reg', channel: 'WEBCHAT' as any, messageCount: 1 },
    messages: [],
    currentMessage: '你地地址喺邊',
    knowledge: salonKnowledge,
    bookingDraft: emptyDraft(),
    signals: {},
  });
  if (savedMock === undefined) delete process.env.LLM_FIRST_MOCK_BRAIN;
  else process.env.LLM_FIRST_MOCK_BRAIN = savedMock;
  if (!salonResult?.response.reply.includes('地址')) {
    failures.push(`salon address should answer direct info, got: ${salonResult?.response.reply}`);
  }

  // 14) correction text should preserve topic and avoid reset/degrade
  const s3a = hydrateConversationState(emptyConversationState('s3', 0), 'HIFU 幾錢', 'HIFU');
  const s3b = hydrateConversationState(s3a, '係，頭先打錯字', null);
  if (s3b.serviceFocus !== 'HIFU') {
    failures.push(`correction turn should preserve service focus, got ${s3b.serviceFocus}`);
  }

  // 15) explicit booking intent still enters booking phase
  const s4 = hydrateConversationState(emptyConversationState('s4', 0), '我想預約聽日7點', 'HIFU');
  if (s4.userPhase !== 'booking') {
    failures.push(`explicit booking intent should enter booking phase, got ${s4.userPhase}`);
  }

  return { ok: failures.length === 0, failures };
}

