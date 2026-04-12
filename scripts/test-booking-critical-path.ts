/**
 * E2E-style booking flow against real OpenAI + runAiEngineV2 (no engine code changes).
 *
 * Outcomes: PASS | SOFT WARN (non-fatal) | HARD FAIL (exit 1 if any).
 *
 * Requires OPENAI_API_KEY and network. From repo root:
 *   npx ts-node --project tsconfig.scripts.json scripts/test-booking-critical-path.ts
 *   pnpm test-booking-critical-path
 */
import { resolve } from 'path';
import { config } from 'dotenv';

config({ path: resolve(__dirname, '../.env') });

import type { AiEngineInput, AiEngineResult, BookingDraft, KnowledgeChunk } from '../packages/ai-engine/src/types';
import { formatHongKongYmd, runAiEngineV2 } from '../packages/ai-engine/src/v2/engine';

type V2Result = AiEngineResult & { _v2Action?: string; _rawLlmJson?: string };

type ScenarioName = string;
type Vertical = 'beauty' | 'clinic';

interface Counters {
  pass: number;
  softWarn: number;
  hardFail: number;
}

const BEAUTY_KB: KnowledgeChunk[] = [
  {
    documentId: 'svc-beauty-laser',
    title: '激光去斑',
    content:
      '激光去斑療程針對色斑、荷爾蒙斑，由專業美容師操作。療程前需皮膚評估。',
    score: 1,
    aliases: ['激光去斑', '去斑', '激光'],
    price: 'HK$2,800',
    duration: '45 分鐘',
    effect: '減淡色斑、均勻膚色',
  },
];

const CLINIC_KB: KnowledgeChunk[] = [
  {
    documentId: 'svc-clinic-gp',
    title: '普通科門診',
    content: '普通科門診由家庭醫生應診，處理一般常見病症。請先預約。',
    score: 1,
    aliases: ['普通科', '門診', 'GP'],
    price: 'HK$350',
    duration: '30 分鐘',
    effect: '一般診症',
  },
];

/** Same calendar rule as engine `resolveRelativeDates` for `9號`. */
function expectedDateForDay9(ref: Date = new Date()): string {
  const dayNum = 9;
  const todayMidnight = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  let target = new Date(ref.getFullYear(), ref.getMonth(), dayNum);
  if (target.getDate() !== dayNum) {
    throw new Error('Invalid day in month');
  }
  if (target < todayMidnight) {
    target = new Date(ref.getFullYear(), ref.getMonth() + 1, dayNum);
    if (target.getDate() !== dayNum) {
      throw new Error('Invalid day in next month');
    }
  }
  return formatHongKongYmd(target);
}

function replySuggestsServiceChoice(reply: string): boolean {
  return /(服務|療程|邊個|哪個|which|揀|選|邊一|咩項|項目|想了解|可以.*(幫你|同你)|預約.*(邊|哪))/.test(reply);
}

function replyLooksLikeBookingSummary(reply: string): boolean {
  return (
    /(預約|日期|時間|電話|確認|陳|91234567|11|9號|4月|以下)/.test(reply) &&
    reply.length > 20
  );
}

function isHumanReadableServiceName(s: string | null | undefined): boolean {
  if (!s || !s.trim()) return false;
  if (/\s/.test(s)) return true;
  if (/[\u4e00-\u9fff]/.test(s)) return true;
  return false;
}

function serviceLineForChecks(draft: BookingDraft | undefined): string {
  const display = draft?.serviceDisplayName?.trim();
  if (display) return display;
  return draft?.serviceName?.trim() ?? '';
}

function serviceIdentifiedHardOk(draft: BookingDraft | undefined, vertical: Vertical): boolean {
  const line = serviceLineForChecks(draft);
  if (!line) return false;
  if (vertical === 'beauty') return /激光|去斑/.test(line);
  return /普通科|門診/.test(line);
}

function anyForbiddenHit(text: string, terms: RegExp[]): RegExp | null {
  for (const t of terms) {
    if (t.test(text)) return t;
  }
  return null;
}

type ParseRawResult =
  | { status: 'missing' }
  | { status: 'parse_error'; error: string; rawHead: string }
  | { status: 'ok'; parsed: Record<string, unknown> };

function parseRawJsonStrict(raw: string | undefined): ParseRawResult {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { status: 'missing' };
  }
  try {
    let s = String(raw).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const parsed = JSON.parse(s) as Record<string, unknown>;
    return { status: 'ok', parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { status: 'parse_error', error: msg, rawHead: String(raw).slice(0, 120) };
  }
}

function hasActionAndReply(parsed: Record<string, unknown>): boolean {
  const hasAction = typeof parsed.action === 'string' && parsed.action.length > 0;
  const hasReply = typeof parsed.reply === 'string' && parsed.reply.length > 0;
  return hasAction && hasReply;
}

function rawReplyText(parsed: Record<string, unknown>): string {
  return typeof parsed.reply === 'string' ? parsed.reply : '';
}

function recordPass(c: Counters, label: string): void {
  c.pass += 1;
  console.log(`PASS ${label}`);
}

function recordSoftWarn(c: Counters, label: string, detail?: string): void {
  c.softWarn += 1;
  console.log(`SOFT WARN ${label}`);
  if (detail) console.log(`  ${detail}`);
}

function recordHardFail(c: Counters, label: string, detail?: unknown): void {
  c.hardFail += 1;
  console.log(`HARD FAIL ${label}`);
  if (detail !== undefined) console.log(`  actual: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

function compareRawToFinal(
  c: Counters,
  scenario: ScenarioName,
  turn: number,
  parsed: Record<string, unknown> | null,
  finalAction: string | undefined,
): void {
  if (!parsed || typeof parsed.action !== 'string') return;
  const rawAct = parsed.action;
  if (rawAct !== finalAction) {
    recordSoftWarn(
      c,
      `[${scenario} Turn ${turn}] raw LLM action differs from final engine action`,
      `raw=${rawAct} final=${finalAction ?? 'MISSING'}`,
    );
  } else {
    recordPass(c, `[${scenario} Turn ${turn}] raw action matches final (${finalAction})`);
  }
}

/**
 * Raw JSON pipeline: missing → SOFT WARN; parse error → HARD; shape → HARD; leakage on raw reply → HARD.
 */
function auditRawLlmJson(
  c: Counters,
  scenario: ScenarioName,
  turn: number,
  raw: string | undefined,
  forbiddenTerms: RegExp[],
  finalAction: string | undefined,
): Record<string, unknown> | null {
  const labelBase = `[${scenario} Turn ${turn}]`;
  const pr = parseRawJsonStrict(raw);

  if (pr.status === 'missing') {
    recordSoftWarn(c, `${labelBase} _rawLlmJson missing entirely`);
    return null;
  }

  if (pr.status === 'parse_error') {
    recordHardFail(c, `${labelBase} _rawLlmJson present but JSON parse failed`, pr.error + ' | head: ' + pr.rawHead);
    return null;
  }

  const shapeOk = hasActionAndReply(pr.parsed);
  if (!shapeOk) {
    recordHardFail(
      c,
      `${labelBase} parsed JSON must include string "action" and "reply"`,
      JSON.stringify(Object.keys(pr.parsed)),
    );
  } else {
    recordPass(c, `${labelBase} parsed JSON has "action" and "reply"`);
  }

  const rtext = rawReplyText(pr.parsed);
  const leakRaw = rtext ? anyForbiddenHit(rtext, forbiddenTerms) : null;
  if (leakRaw) {
    recordHardFail(c, `${labelBase} parsed raw "reply" contains forbidden cross-tenant term`, String(leakRaw));
  } else if (rtext) {
    recordPass(c, `${labelBase} parsed raw "reply" passes forbidden-term check`);
  }

  if (shapeOk) {
    compareRawToFinal(c, scenario, turn, pr.parsed, finalAction);
  }

  return pr.parsed;
}

function auditDraftServiceLeakage(
  c: Counters,
  scenario: ScenarioName,
  turn: number,
  draft: BookingDraft | undefined,
  forbiddenTerms: RegExp[],
): void {
  const labelBase = `[${scenario} Turn ${turn}]`;
  const display = draft?.serviceDisplayName?.trim();
  if (display) {
    const hit = anyForbiddenHit(display, forbiddenTerms);
    if (hit) {
      recordHardFail(c, `${labelBase} bookingDraft.serviceDisplayName contains forbidden term`, String(hit));
    } else {
      recordPass(c, `${labelBase} bookingDraft.serviceDisplayName passes forbidden-term check`);
    }
  }

  const name = draft?.serviceName?.trim();
  if (!name) return;

  if (isHumanReadableServiceName(name)) {
    const hit = anyForbiddenHit(name, forbiddenTerms);
    if (hit) {
      recordHardFail(c, `${labelBase} bookingDraft.serviceName (human-readable) contains forbidden term`, String(hit));
    } else {
      recordPass(c, `${labelBase} bookingDraft.serviceName (human-readable) passes forbidden-term check`);
    }
  } else {
    recordSoftWarn(
      c,
      `${labelBase} bookingDraft.serviceName not treated as human-readable; skipped forbidden check`,
      name.slice(0, 80),
    );
  }
}

function auditReplyTextLeakage(
  c: Counters,
  scenario: ScenarioName,
  turn: number,
  replyText: string,
  forbiddenTerms: RegExp[],
): void {
  const hit = anyForbiddenHit(replyText, forbiddenTerms);
  if (hit) {
    recordHardFail(c, `[${scenario} Turn ${turn}] replyText contains forbidden cross-tenant term`, String(hit));
  } else {
    recordPass(c, `[${scenario} Turn ${turn}] replyText passes forbidden-term check`);
  }
}

async function runScenario(params: {
  name: ScenarioName;
  vertical: Vertical;
  tenantId: string;
  settings: Record<string, unknown>;
  knowledge: KnowledgeChunk[];
  turn2Message: string;
  forbiddenTerms: RegExp[];
  c: Counters;
}): Promise<void> {
  const { name: scenario, vertical, forbiddenTerms, c } = params;

  const messages: AiEngineInput['messages'] = [];
  let bookingDraft: BookingDraft | undefined;
  let confirmationPending = false;

  const baseInput = (): Omit<AiEngineInput, 'currentMessage'> => ({
    tenant: {
      id: params.tenantId,
      plan: 'GROWTH',
      settings: params.settings,
    },
    contact: { id: `contact-${params.tenantId}`, name: undefined, tags: [] },
    conversation: {
      id: `conv-${params.tenantId}`,
      channel: 'WEBCHAT' as AiEngineInput['conversation']['channel'],
      messageCount: messages.length,
    },
    messages: [...messages],
    knowledge: params.knowledge,
    bookingDraft,
    signals: { confirmationPending },
  });

  const runTurn = async (currentMessage: string): Promise<V2Result> => {
    const input: AiEngineInput = {
      ...baseInput(),
      currentMessage,
      messages: [...messages],
    };
    const result = (await runAiEngineV2(input)) as V2Result;
    messages.push({
      sender: 'CUSTOMER',
      content: currentMessage,
      createdAt: new Date().toISOString(),
    });
    messages.push({
      sender: 'AI',
      content: result.replyText,
      createdAt: new Date().toISOString(),
    });
    bookingDraft = result.signals.bookingDraft;
    confirmationPending = !!(result.signals as { confirmationPending?: boolean }).confirmationPending;
    return result;
  };

  const expectedDate = expectedDateForDay9();

  // Turn 1
  console.log(`\n── ${scenario} — Turn 1: 我想預約 ──`);
  const r1 = await runTurn('我想預約');
  const action1 = r1._v2Action ?? 'MISSING';
  if (action1 === 'COLLECT_BOOKING') {
    recordPass(c, `[${scenario} Turn 1] final engine action === COLLECT_BOOKING`);
  } else {
    recordHardFail(c, `[${scenario} Turn 1] final engine action wrong (expected COLLECT_BOOKING)`, action1);
  }

  auditRawLlmJson(c, scenario, 1, r1._rawLlmJson, forbiddenTerms, action1);
  auditReplyTextLeakage(c, scenario, 1, r1.replyText, forbiddenTerms);
  auditDraftServiceLeakage(c, scenario, 1, r1.signals.bookingDraft, forbiddenTerms);

  if (replySuggestsServiceChoice(r1.replyText)) {
    recordPass(c, `[${scenario} Turn 1] heuristic: reply asks which service`);
  } else {
    recordSoftWarn(c, `[${scenario} Turn 1] heuristic: reply may not ask which service`, r1.replyText.slice(0, 200));
  }

  // Turn 2
  console.log(`\n── ${scenario} — Turn 2: service + 9號11點 ──`);
  const r2 = await runTurn(params.turn2Message);
  const action2 = r2._v2Action ?? 'MISSING';
  if (action2 === 'COLLECT_BOOKING') {
    recordPass(c, `[${scenario} Turn 2] final engine action === COLLECT_BOOKING`);
  } else {
    recordHardFail(c, `[${scenario} Turn 2] final engine action wrong (expected COLLECT_BOOKING)`, action2);
  }

  const draft2 = r2.signals.bookingDraft;
  if (serviceIdentifiedHardOk(draft2, vertical)) {
    recordPass(c, `[${scenario} Turn 2] expected service identified (display/name)`);
  } else {
    recordHardFail(c, `[${scenario} Turn 2] expected service not identified in bookingDraft`, {
      serviceDisplayName: draft2?.serviceDisplayName,
      serviceName: draft2?.serviceName,
    });
  }

  if (draft2?.date === expectedDate) {
    recordPass(c, `[${scenario} Turn 2] bookingDraft.date === ${expectedDate}`);
  } else {
    recordHardFail(c, `[${scenario} Turn 2] bookingDraft.date wrong`, draft2?.date);
  }

  const timeNorm = (draft2?.time ?? '').replace(/^(\d{1,2}):(\d{2})$/, (_, h: string, m: string) =>
    `${String(h).padStart(2, '0')}:${m}`,
  );
  if (timeNorm === '11:00') {
    recordPass(c, `[${scenario} Turn 2] bookingDraft.time === 11:00`);
  } else {
    recordHardFail(c, `[${scenario} Turn 2] bookingDraft.time wrong`, draft2?.time);
  }

  const dayNum = draft2?.date ? parseInt(draft2.date.split('-')[2] ?? '0', 10) : 0;
  const hourNum = parseInt((draft2?.time ?? '0:0').split(':')[0] ?? '0', 10);
  const swapped = dayNum === 11 && hourNum === 9;
  if (!swapped) {
    recordPass(c, `[${scenario} Turn 2] date/time not swapped (guard: not day=11 & hour=9)`);
  } else {
    recordHardFail(c, `[${scenario} Turn 2] date/time appear swapped`, { dayNum, hourNum });
  }

  const parsed2 = auditRawLlmJson(c, scenario, 2, r2._rawLlmJson, forbiddenTerms, action2);
  auditReplyTextLeakage(c, scenario, 2, r2.replyText, forbiddenTerms);
  auditDraftServiceLeakage(c, scenario, 2, draft2, forbiddenTerms);

  if (parsed2) {
    const ns = parsed2.newSlots as Record<string, unknown> | undefined;
    if (ns && typeof ns.date === 'string') {
      if (ns.date === expectedDate) {
        recordPass(c, `[${scenario} Turn 2] raw JSON newSlots.date === ${expectedDate}`);
      } else {
        recordHardFail(c, `[${scenario} Turn 2] raw JSON newSlots.date !== expected`, ns.date);
      }
    }
  }

  // Turn 3
  console.log(`\n── ${scenario} — Turn 3: name + phone ──`);
  const r3 = await runTurn('陳小姐 91234567');
  const action3 = r3._v2Action ?? 'MISSING';
  if (action3 === 'CONFIRM_BOOKING') {
    recordPass(c, `[${scenario} Turn 3] final engine action === CONFIRM_BOOKING`);
  } else {
    recordHardFail(c, `[${scenario} Turn 3] final engine action wrong (expected CONFIRM_BOOKING)`, action3);
  }

  const pending = (r3.signals as { confirmationPending?: boolean }).confirmationPending === true;
  if (pending) {
    recordPass(c, `[${scenario} Turn 3] confirmationPending === true`);
  } else {
    recordHardFail(c, `[${scenario} Turn 3] confirmationPending !== true`, (r3.signals as any).confirmationPending);
  }

  auditRawLlmJson(c, scenario, 3, r3._rawLlmJson, forbiddenTerms, action3);
  auditReplyTextLeakage(c, scenario, 3, r3.replyText, forbiddenTerms);
  auditDraftServiceLeakage(c, scenario, 3, r3.signals.bookingDraft, forbiddenTerms);

  if (replyLooksLikeBookingSummary(r3.replyText)) {
    recordPass(c, `[${scenario} Turn 3] heuristic: reply looks like booking summary`);
  } else {
    recordSoftWarn(c, `[${scenario} Turn 3] heuristic: reply may not look like booking summary`, r3.replyText.slice(0, 220));
  }

  // Turn 4
  console.log(`\n── ${scenario} — Turn 4: 好 ──`);
  const r4 = await runTurn('好');
  const action4 = r4._v2Action ?? 'MISSING';
  if (action4 === 'SUBMIT_BOOKING') {
    recordPass(c, `[${scenario} Turn 4] final engine action === SUBMIT_BOOKING`);
  } else {
    recordHardFail(c, `[${scenario} Turn 4] final engine action wrong (expected SUBMIT_BOOKING)`, action4);
  }

  auditRawLlmJson(c, scenario, 4, r4._rawLlmJson, forbiddenTerms, action4);
  auditReplyTextLeakage(c, scenario, 4, r4.replyText, forbiddenTerms);
  auditDraftServiceLeakage(c, scenario, 4, r4.signals.bookingDraft, forbiddenTerms);
}

async function main() {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error('Missing OPENAI_API_KEY in environment (.env).');
    process.exit(1);
  }

  console.log('Using runAiEngineV2 with real OpenAI. Expected 9號 date:', expectedDateForDay9());
  console.log('Model:', process.env.OPENAI_MODEL || 'gpt-4o-mini');

  const beautyForbidden = [/診所/i, /doctor/i, /patients/i];
  const clinicForbidden = [/美容/, /salon/i, /aftercare/i];

  const c: Counters = { pass: 0, softWarn: 0, hardFail: 0 };

  await runScenario({
    name: 'BEAUTY',
    vertical: 'beauty',
    tenantId: 'demo-tenant-beauty-test',
    settings: {
      businessName: '美容療程示範店',
      businessType: 'beauty and wellness salon',
      assistantRole: '親切、專業、不硬銷',
      language: '粵語為主',
    },
    knowledge: BEAUTY_KB,
    turn2Message: '激光去斑，9號11點',
    forbiddenTerms: beautyForbidden,
    c,
  });

  await runScenario({
    name: 'CLINIC',
    vertical: 'clinic',
    tenantId: 'clinic-demo-tenant-test',
    settings: {
      businessName: '康健家庭醫學診所',
      businessType: 'medical clinic',
      assistantRole: '專業、清晰、不作診斷',
      language: '粵語為主',
    },
    knowledge: CLINIC_KB,
    turn2Message: '普通科門診，9號11點',
    forbiddenTerms: clinicForbidden,
    c,
  });

  console.log(`\n========== SUMMARY ==========`);
  console.log(`PASS: ${c.pass}`);
  console.log(`SOFT WARN: ${c.softWarn}`);
  console.log(`HARD FAIL: ${c.hardFail}`);
  process.exit(c.hardFail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
