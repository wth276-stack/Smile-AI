import type { BookingDraft, KnowledgeChunk } from './types';
import { mergeDraftFromPlanner } from './llm-draft-merge';
import type { LlmPlannerOutput } from './llm-contract';
import { buildServiceCatalog } from './service-matcher';

const eyeDraft: BookingDraft = {
  serviceName: 'eye_treatment',
  serviceDisplayName: 'Eye Treatment',
  date: null,
  time: null,
  customerName: null,
  phone: null,
};

const knowledge: KnowledgeChunk[] = [
  { documentId: '1', title: 'Eye Treatment', content: 'Eye Treatment\n價錢：HKD 680', score: 1 },
  { documentId: '2', title: 'HIFU 緊緻', content: 'HIFU\n價錢：HKD 1200', score: 1 },
];

function planner(partial: Partial<LlmPlannerOutput> & Pick<LlmPlannerOutput, 'intent'>): LlmPlannerOutput {
  return {
    schemaVersion: 1,
    replyText: '',
    serviceMention: null,
    extracted: { date: null, time: null, customerName: null, phone: null },
    usesDraftContext: true,
    switchedAwayFromDraftService: false,
    needsClarification: false,
    clarificationReason: null,
    nextExpectedSlot: null,
    ...partial,
  } as LlmPlannerOutput;
}

/**
 * Deterministic merge + routing prep (no OpenAI).
 * node -e "const r=require('./dist/llm-regression.js').verifyLlmMergeRegression(); console.log(r); process.exit(r.ok?0:1);"
 */
export function verifyLlmMergeRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const catalog = buildServiceCatalog(knowledge);

  const pPriceSwitch = planner({
    intent: 'PRICE',
    serviceMention: 'HIFU',
    switchedAwayFromDraftService: true,
  });
  const m1 = mergeDraftFromPlanner({
    currentMessage: 'HIFU 幾錢？',
    priorDraft: eyeDraft,
    planner: pPriceSwitch,
    catalog,
  });
  if (m1.draft.serviceDisplayName !== 'HIFU 緊緻') {
    failures.push(`price switch: expected HIFU draft, got ${m1.draft.serviceDisplayName}`);
  }

  const pSlot = planner({ intent: 'BOOKING_SLOT_FILL' });
  const m2 = mergeDraftFromPlanner({
    currentMessage: '聽日晚上7點',
    priorDraft: eyeDraft,
    planner: pSlot,
    catalog,
  });
  if (!m2.draft.date || m2.draft.time !== '19:00') {
    failures.push(`slot merge: want date + 19:00, got ${m2.draft.date} ${m2.draft.time}`);
  }

  return { ok: failures.length === 0, failures };
}
