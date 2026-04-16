/**
 * Staging experiment ONLY — does not change production code.
 * Simulates create-booking rows at confirmation boundary (5 slots filled).
 *
 * Run: cd packages/ai-engine && npx tsx scripts/staging-confirmation-boundary-experiment.ts
 *
 * Breakdown predicates MUST stay in sync with src/v2/confirmation-boundary.ts (copy for audit).
 */
import type { BookingDraft } from '../src/types';
import {
  applyConfirmationBoundaryPostProcess,
  replyReflectsDraftForConfirmation,
  timeAppearsInReply,
} from '../src/v2/confirmation-boundary';

function normalizeCompact(s: string): string {
  return s.replace(/\s+/g, '').replace(/[：:，,。．·]/g, '');
}
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}
function dateAppearsInReply(reply: string, ymd: string): boolean {
  if (!ymd) return false;
  if (reply.includes(ymd)) return true;
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3) return false;
  const [, m, d] = parts;
  const patterns = [
    new RegExp(`${m}\\s*月\\s*${d}\\s*日`),
    new RegExp(`${m}月${d}日`),
    new RegExp(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
  ];
  return patterns.some((re) => re.test(reply));
}
function serviceAppearsInReply(reply: string, draft: BookingDraft): boolean {
  const display = (draft.serviceDisplayName ?? draft.serviceName ?? '').trim();
  const code = (draft.serviceName ?? '').trim();
  if (!display && !code) return false;
  const r = reply;
  const n = normalizeCompact(r);
  if (display && (r.includes(display) || n.includes(normalizeCompact(display)))) return true;
  if (code && (r.includes(code) || n.includes(normalizeCompact(code)))) return true;
  const tokens = [display, code].filter(Boolean).flatMap((s) => s.split(/[\s／/]+/));
  return tokens.some((t) => t.length >= 2 && (r.includes(t) || n.includes(normalizeCompact(t))));
}
function nameAppearsInReply(reply: string, name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  return reply.includes(n) || normalizeCompact(reply).includes(normalizeCompact(n));
}
function phoneAppearsInReply(reply: string, phone: string): boolean {
  const p = digitsOnly(phone);
  if (p.length < 8) return true;
  const rd = digitsOnly(reply);
  return rd.includes(p);
}
function reflectionBreakdown(reply: string, draft: BookingDraft) {
  const svcOk = serviceAppearsInReply(reply, draft);
  const dateOk = draft.date ? dateAppearsInReply(reply, draft.date) : false;
  const timeOk = draft.time ? timeAppearsInReply(reply, draft.time) : false;
  const nameOk = draft.customerName ? nameAppearsInReply(reply, draft.customerName) : false;
  const phoneOk = draft.phone ? phoneAppearsInReply(reply, draft.phone) : false;
  return { svcOk, dateOk, timeOk, nameOk, phoneOk };
}

type Row = {
  caseId: string;
  conversationId: string;
  mergedDraft: BookingDraft;
  rawLlmReply: string;
  llmAction: string;
  notes: string;
};

/** Fake conversation ids for table */
const cid = (n: number) => `staging-exp-conv-${String(n).padStart(2, '0')}`;

const cases: Row[] = [
  {
    caseId: 'C1',
    conversationId: cid(1),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'botox_slim',
      serviceDisplayName: 'Botox 瘦面療程',
      date: '2026-04-16',
      time: '14:00',
      customerName: 'Tony Wong',
      phone: '61234567',
    },
    rawLlmReply:
      '好呀，幫你 book 咗聽日晏晝兩點 Botox，Tony Wong，電話 61234567，睇下有冇問題？',
    llmAction: 'REPLY',
    notes: 'relative: 聽日 (no literal YYYY-MM-DD / 4月16日)',
  },
  {
    caseId: 'C2',
    conversationId: cid(2),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'hydrafacial',
      serviceDisplayName: '水光針療程',
      date: '2026-04-17',
      time: '11:00',
      customerName: '阿芬',
      phone: '91234567',
    },
    rawLlmReply: '確認後日朝早11點打水光針，阿芬 91234567 OK？',
    llmAction: 'REPLY',
    notes: 'relative: 後日',
  },
  {
    caseId: 'C3',
    conversationId: cid(3),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'facial',
      serviceDisplayName: '深層清潔面部護理',
      date: '2026-04-15',
      time: '16:00',
      customerName: 'Mary Chan',
      phone: '99887766',
    },
    rawLlmReply:
      'Mary，星期三下晝4點做深層清潔，電話尾邊個都記低咗 99887766，啱唔啱？',
    llmAction: 'REPLY',
    notes: 'relative: 星期三 (draft = that Wed; reply 無 4月15日)',
  },
  {
    caseId: 'C4',
    conversationId: cid(4),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'massage',
      serviceDisplayName: '全身按摩 60分鐘',
      date: '2026-04-18',
      time: '18:30',
      customerName: '李先生',
      phone: '62345678',
    },
    rawLlmReply: '下星期六傍晚6點半全身按摩，李先生 62345678，可以嗎？',
    llmAction: 'REPLY',
    notes: 'relative: 下星期六 (no 4月18 / MM-DD match)',
  },
  {
    caseId: 'C5',
    conversationId: cid(5),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'ipl',
      serviceDisplayName: 'IPL 光子嫩膚',
      date: '2026-04-18',
      time: '10:00',
      customerName: '陳小姐',
      phone: '61112233',
    },
    rawLlmReply:
      '幫你確認：IPL 光子嫩膚，4月18日朝早10點，陳小姐，61112233。以上啱唔啱？',
    llmAction: 'CONFIRM_BOOKING',
    notes: 'absolute: 4月18日 + full-ish',
  },
  {
    caseId: 'C6',
    conversationId: cid(6),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'hifu',
      serviceDisplayName: 'HIFU 拉提',
      date: '2026-04-18',
      time: '15:00',
      customerName: 'Peter',
      phone: '69998888',
    },
    rawLlmReply: 'Peter，18號下晝3點 HIFU 拉提，69998888 對嗎？',
    llmAction: 'REPLY',
    notes: 'absolute: 18號 only (check vs datePatterns from Y-M-D)',
  },
  {
    caseId: 'C7',
    conversationId: cid(7),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'ipl_segment',
      serviceDisplayName: '分段強脈衝光去斑',
      date: '2026-04-20',
      time: '12:00',
      customerName: 'Kelly',
      phone: '67778899',
    },
    rawLlmReply: 'Kelly，下星期一中午做 IPL，67778899，時間OK嗎？',
    llmAction: 'REPLY',
    notes: 'service: 英文 IPL vs 長中文 display',
  },
  {
    caseId: 'C8',
    conversationId: cid(8),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'hifu_full',
      serviceDisplayName: 'HIFU 全臉拉提',
      date: '2026-04-21',
      time: '09:30',
      customerName: '王建明',
      phone: '54443322',
    },
    rawLlmReply:
      '王建明先生，HIFU 全臉拉提，2026-04-21 09:30，54443322，請確認。',
    llmAction: 'CONFIRM_BOOKING',
    notes: 'service: HIFU exact display + ISO date in reply',
  },
  {
    caseId: 'C9',
    conversationId: cid(9),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'botox',
      serviceDisplayName: 'Botox 瘦面療程',
      date: '2026-04-22',
      time: '11:00',
      customerName: 'Chan Tai Man',
      phone: '61234567',
    },
    rawLlmReply: 'Botox 瘦面，4月22日 11:00，Chan Tai Man，61234567 — 確認？',
    llmAction: 'CONFIRM_BOOKING',
    notes: 'short English name + Botox token',
  },
  {
    caseId: 'C10',
    conversationId: cid(10),
    mergedDraft: {
      bookingId: null,
      mode: null,
      serviceName: 'combo',
      serviceDisplayName: '水光針 + 面膜',
      date: '2026-04-19',
      time: '14:00',
      customerName: '王小花',
      phone: '98887766',
    },
    rawLlmReply: '好，收到。',
    llmAction: 'REPLY',
    notes: 'multi-turn style: overly terse, no slot echo',
  },
];

function main() {
  console.log('# Staging: confirmation-boundary experiment (create-booking, simulated LLM replies)\n');

  const rows: {
    caseId: string;
    conversationId: string;
    draftJson: string;
    rawLlmReply: string;
    svcOk: boolean;
    dateOk: boolean;
    timeOk: boolean;
    nameOk: boolean;
    phoneOk: boolean;
    overallReflection: boolean;
    usedTemplate: boolean;
    finalReply: string;
    finalAction: string;
  }[] = [];

  let templateCount = 0;
  const failByField = { svc: 0, date: 0, time: 0, name: 0, phone: 0 };

  for (const c of cases) {
    const d = c.mergedDraft;
    const bd = reflectionBreakdown(c.rawLlmReply, d);
    const overall = replyReflectsDraftForConfirmation(c.rawLlmReply, d);

    const boundary = applyConfirmationBoundaryPostProcess(d, c.rawLlmReply, c.llmAction, {
      confirmationPending: false,
    });
    if (boundary.usedTemplate) templateCount++;
    if (!overall) {
      if (!bd.svcOk) failByField.svc++;
      if (!bd.dateOk) failByField.date++;
      if (!bd.timeOk) failByField.time++;
      if (!bd.nameOk) failByField.name++;
      if (!bd.phoneOk) failByField.phone++;
    }

    rows.push({
      caseId: c.caseId,
      conversationId: c.conversationId,
      draftJson: JSON.stringify(d),
      rawLlmReply: c.rawLlmReply,
      svcOk: bd.svcOk,
      dateOk: bd.dateOk,
      timeOk: bd.timeOk,
      nameOk: bd.nameOk,
      phoneOk: bd.phoneOk,
      overallReflection: overall,
      usedTemplate: boundary.usedTemplate,
      finalReply: boundary.reply,
      finalAction: boundary.action,
    });
  }

  // Markdown table
  console.log('| Case | conversationId | overallReflection | svc | date | time | name | phone | usedTemplate |');
  console.log('|------|----------------|------------------|-----|------|------|------|-------|--------------|');
  for (const r of rows) {
    console.log(
      `| ${r.caseId} | ${r.conversationId} | ${r.overallReflection} | ${r.svcOk} | ${r.dateOk} | ${r.timeOk} | ${r.nameOk} | ${r.phoneOk} | ${r.usedTemplate} |`,
    );
  }

  console.log('\n## Raw LLM reply (trunc) / final reply (trunc)\n');
  for (let i = 0; i < cases.length; i++) {
    const r = rows[i];
    const note = cases[i]!.notes;
    console.log(`### ${cases[i]!.caseId} — ${note}`);
    console.log('- mergedDraft:', r.draftJson);
    console.log('- rawLlmReply:', r.rawLlmReply);
    console.log('- reflection:', r.overallReflection, '| usedTemplate:', r.usedTemplate, '| finalAction:', r.finalAction);
    console.log(
      '- finalReply:',
      r.finalReply.length > 200 ? r.finalReply.slice(0, 200) + '…' : r.finalReply,
    );
    console.log('');
  }

  const rate = (templateCount / cases.length) * 100;
  console.log('\n---\n');
  console.log('Template override rate:', `${templateCount}/${cases.length} (${rate.toFixed(0)}%)`);
  console.log('Reflection fail breakdown (only when overallReflection=false):', failByField);
  console.log('\n## Conclusion (staging, simulated LLM; not live OpenAI)\n');
  console.log(
    '- If high usedTemplate with plausible Cantonese confirm text → **replyReflectsDraftForConfirmation/日期模式** is a strong first fix candidate.',
  );
  console.log(
    '- This script does **not** exercise validator L156 or chat.service; run a **live L156** experiment next if boundary rates are low but production still fails.',
  );
}

main();
