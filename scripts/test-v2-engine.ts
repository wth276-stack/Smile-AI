import { runAiEngineV2 } from '../packages/ai-engine/src/v2/engine';
import type { AiEngineInput, KnowledgeChunk } from '../packages/ai-engine/src/types';

const knowledgeChunks: KnowledgeChunk[] = [
  {
    documentId: 'd1',
    title: 'HIFU 拉提緊緻',
    content: 'HIFU 超聲波拉提療程，針對面部輪廓提升',
    score: 1.0,
    price: 'HKD 1200',
    effect: '提拉緊緻',
    duration: '60分鐘',
  },
  {
    documentId: 'd2',
    title: '補濕亮肌 Facial',
    content: '深層清潔補濕 facial，適合乾性肌膚，包括潔面、去角質、補濕面膜',
    score: 1.0,
    price: 'HKD 480',
    effect: '深層補濕、亮白',
    duration: '75分鐘',
  },
  {
    documentId: 'd3',
    title: '肩頸按摩',
    content: '專業肩頸推拿按摩，紓緩都市人肩頸疲勞',
    score: 1.0,
    price: 'HKD 380',
    effect: '紓緩肩頸痛',
    duration: '45分鐘',
  },
];

const test1Input: AiEngineInput = {
  tenant: { id: 'test-tenant', plan: 'pro', settings: {} },
  contact: { id: 'test-contact', name: 'Alice', tags: [] },
  conversation: { id: 'test-conv', channel: 'WEBCHAT' as any, messageCount: 1 },
  messages: [],
  currentMessage: 'Hi，想問下你哋有咩facial做？',
  knowledge: knowledgeChunks,
};

const test2Input: AiEngineInput = {
  tenant: { id: 'test-tenant', plan: 'pro', settings: {} },
  contact: { id: 'test-contact', name: 'Alice', tags: [] },
  conversation: { id: 'test-conv', channel: 'WEBCHAT' as any, messageCount: 3 },
  messages: [
    { sender: 'AI', content: '你好！有咩可以幫到你？', createdAt: new Date().toISOString() },
    { sender: 'CUSTOMER', content: '我想預約facial', createdAt: new Date().toISOString() },
  ],
  currentMessage: '我想book聽日下午3點做補濕亮肌Facial，我叫陳小明，電話98765432',
  knowledge: knowledgeChunks,
};

(async () => {
  try {
    console.log('=== Test 1: Smoke Test ===');
    console.log('Input message:', test1Input.currentMessage);
    console.log();
    const result1 = await runAiEngineV2(test1Input);
    console.log('Result:');
    console.log(JSON.stringify(result1, null, 2));

    console.log('\n========================================\n');

    console.log('=== Test 2: Booking Flow Test ===');
    console.log('Input message:', test2Input.currentMessage);
    console.log();
    const result2 = await runAiEngineV2(test2Input);
    console.log('Result:');
    console.log(JSON.stringify(result2, null, 2));
  } catch (err) {
    console.error('Smoke test failed:', err);
    process.exit(1);
  }
})();
