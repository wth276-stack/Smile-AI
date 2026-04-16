/**
 * Read-only replay: real AiRun + Message pairs → confirmation boundary metrics.
 * Run from packages/database: npx tsx scripts/replay-real-confirmation-boundary.ts
 *
 * Does not change production. Prefers V2 `signals._auditPreBoundary` when present;
 * otherwise uses merged bookingDraft from AiRun.signals and raw LLM JSON from
 * Message.metadata.rawLlmJson (OpenAI response string when present).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import type { AuditPreBoundarySnapshot, BookingDraft } from '../../ai-engine/src/types';
import {
  applyConfirmationBoundaryPostProcess,
  replyReflectsDraftForConfirmation,
  timeAppearsInReply,
} from '../../ai-engine/src/v2/confirmation-boundary';
import { bookingDraftHasAllRequiredSlots } from '../../ai-engine/src/booking-state';

const prisma = new PrismaClient();

type Meta = { rawLlmJson?: string } & Record<string, unknown>;

function getAudit(sig: Record<string, unknown>): AuditPreBoundarySnapshot | undefined {
  const a = sig._auditPreBoundary;
  if (!a || typeof a !== 'object') return undefined;
  const o = a as Record<string, unknown>;
  if (
    typeof o.finalReplyBeforeBoundary !== 'string' ||
    typeof o.finalActionBeforeBoundary !== 'string' ||
    typeof o.confirmationPendingIn !== 'boolean' ||
    typeof o.currentMessageIn !== 'string' ||
    !o.mergedDraftBeforeBoundary ||
    typeof o.mergedDraftBeforeBoundary !== 'object'
  ) {
    return undefined;
  }
  return o as unknown as AuditPreBoundarySnapshot;
}

function parseRawLlm(raw: string | undefined): {
  reply: string;
  action: string;
  quality: 'parsed' | 'no-json' | 'parse-error';
} {
  if (!raw || !raw.trim()) return { reply: '', action: 'REPLY_ONLY', quality: 'no-json' };
  try {
    let s = raw;
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const o = JSON.parse(s) as Record<string, unknown>;
    const reply = String(o.replyText ?? o.reply ?? '');
    const action = String(o.action ?? 'REPLY_ONLY');
    return { reply, action, quality: 'parsed' };
  } catch {
    return { reply: '', action: 'REPLY_ONLY', quality: 'parse-error' };
  }
}

function reflectionBreakdown(reply: string, draft: BookingDraft) {
  const normalizeCompact = (s: string) => s.replace(/\s+/g, '').replace(/[：:，,。．·]/g, '');
  const digitsOnly = (s: string) => s.replace(/\D/g, '');
  const dateAppearsInReply = (r: string, ymd: string): boolean => {
    if (!ymd) return false;
    if (r.includes(ymd)) return true;
    const parts = ymd.split('-').map(Number);
    if (parts.length !== 3) return false;
    const [, m, d] = parts;
    const patterns = [
      new RegExp(`${m}\\s*月\\s*${d}\\s*日`),
      new RegExp(`${m}月${d}日`),
      new RegExp(`${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`),
    ];
    return patterns.some((re) => re.test(r));
  };
  const serviceAppearsInReply = (r: string, d: BookingDraft): boolean => {
    const display = (d.serviceDisplayName ?? d.serviceName ?? '').trim();
    const code = (d.serviceName ?? '').trim();
    if (!display && !code) return false;
    const n = normalizeCompact(r);
    if (display && (r.includes(display) || n.includes(normalizeCompact(display)))) return true;
    if (code && (r.includes(code) || n.includes(normalizeCompact(code)))) return true;
    const tokens = [display, code].filter(Boolean).flatMap((x) => x.split(/[\s／/]+/));
    return tokens.some((t) => t.length >= 2 && (r.includes(t) || n.includes(normalizeCompact(t))));
  };
  const nameAppearsInReply = (r: string, name: string): boolean => {
    const n = name.trim();
    if (!n) return true;
    return r.includes(n) || normalizeCompact(r).includes(normalizeCompact(n));
  };
  const phoneAppearsInReply = (r: string, phone: string): boolean => {
    const p = digitsOnly(phone);
    if (p.length < 8) return true;
    const rd = digitsOnly(r);
    return rd.includes(p);
  };

  const svcOk = serviceAppearsInReply(reply, draft);
  const dateOk = draft.date ? dateAppearsInReply(reply, draft.date) : false;
  const timeOk = draft.time ? timeAppearsInReply(reply, draft.time) : false;
  const nameOk = draft.customerName ? nameAppearsInReply(reply, draft.customerName) : false;
  const phoneOk = draft.phone ? phoneAppearsInReply(reply, draft.phone) : false;
  return { svcOk, dateOk, timeOk, nameOk, phoneOk };
}

function isCreateFlowDraft(d: BookingDraft): boolean {
  const m = d.mode;
  if (m === 'modify' || m === 'cancel') return false;
  return true;
}

async function main() {
  /** When `AUDIT_ONLY=1`, only AiRuns that already have `signals._auditPreBoundary` (post-deploy V2). */
  const auditOnly = process.env.AUDIT_ONLY === '1' || process.env.AUDIT_ONLY === 'true';

  const rows = await prisma.$queryRaw<
    Array<{
      ai_run_id: string;
      conversationId: string;
      run_at: Date;
      signals: unknown;
      msg_id: string;
      content: string;
      metadata: unknown;
      msg_at: Date;
    }>
  >`
    SELECT ar.id AS ai_run_id,
           ar."conversationId" AS "conversationId",
           ar."createdAt" AS run_at,
           ar.signals,
           m.id AS msg_id,
           m.content,
           m.metadata,
           m."createdAt" AS msg_at
    FROM ai_runs ar
    JOIN LATERAL (
      SELECT *
      FROM messages m
      WHERE m."conversationId" = ar."conversationId"
        AND m.sender = 'AI'
        AND m."createdAt" <= ar."createdAt"
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) m ON true
    ${auditOnly ? Prisma.sql`WHERE ar.signals->'_auditPreBoundary' IS NOT NULL` : Prisma.empty}
    ORDER BY ar."createdAt" DESC
    LIMIT 15000
  `;

  const candidates: typeof rows = [];
  for (const r of rows) {
    const sig = r.signals as Record<string, unknown> | null;
    if (!sig || typeof sig !== 'object') continue;
    const audit = getAudit(sig);
    const bd = (audit?.mergedDraftBeforeBoundary ?? sig.bookingDraft) as BookingDraft | undefined;
    if (!bd || !bookingDraftHasAllRequiredSlots(bd)) continue;
    if (!isCreateFlowDraft(bd)) continue;

    const meta = r.metadata as Meta;
    const rawStr = typeof meta?.rawLlmJson === 'string' ? meta.rawLlmJson : undefined;
    if (!rawStr && !audit) continue;

    const legacyAction = sig.action as string | undefined;
    if (legacyAction === 'MODIFY_BOOKING' || legacyAction === 'CANCEL_BOOKING') continue;

    candidates.push(r);
  }

  const scored: typeof candidates = [];
  for (const r of candidates) {
    const sig = r.signals as Record<string, unknown>;
    const audit = getAudit(sig);
    let preAction: string;
    let preReply: string;
    if (audit) {
      preAction = audit.finalActionBeforeBoundary;
      preReply = audit.finalReplyBeforeBoundary;
    } else {
      const rawStr = (r.metadata as Meta).rawLlmJson as string;
      const parsed = parseRawLlm(rawStr);
      if (parsed.quality !== 'parsed' || !parsed.reply.trim()) continue;
      preAction = parsed.action;
      preReply = parsed.reply;
    }
    /** Create-confirmation (boundary Case 3 applies): SUBMIT/MODIFY/CANCEL/HANDOFF bypass template branch. */
    if (
      preAction === 'SUBMIT_BOOKING' ||
      preAction === 'MODIFY_BOOKING' ||
      preAction === 'CANCEL_BOOKING' ||
      preAction === 'HANDOFF'
    ) {
      continue;
    }
    scored.push(r);
  }

  const picked = scored.slice(0, 20);
  const confirmOnly = scored.filter((row) => {
    const sig = row.signals as Record<string, unknown>;
    const audit = getAudit(sig);
    if (audit) return audit.finalActionBeforeBoundary === 'CONFIRM_BOOKING';
    const rawStr = (row.metadata as Meta).rawLlmJson as string;
    return parseRawLlm(rawStr).action === 'CONFIRM_BOOKING';
  });

  console.log(
    JSON.stringify(
      {
        auditOnlyFilter: auditOnly,
        scannedAiRuns: rows.length,
        candidatesFullSlotsCreate: candidates.length,
        scoredNonSubmitActions: scored.length,
        confirmBookingRowsInScored: confirmOnly.length,
        picked: picked.length,
      },
      null,
      2,
    ),
  );

  const table: Array<Record<string, unknown>> = [];
  let usedTemplateCount = 0;
  const failByField = { svc: 0, date: 0, time: 0, name: 0, phone: 0 };
  let overallReflectTrue = 0;

  /** Sub-cohort: strict create-confirmation (LLM already chose CONFIRM_BOOKING). */
  let confirmSub = { n: 0, usedTemplate: 0, reflectPass: 0, fail: { svc: 0, date: 0, time: 0, name: 0, phone: 0 } };

  for (const r of picked) {
    const sig = r.signals as Record<string, unknown>;
    const audit = getAudit(sig);
    const draft = {
      ...((audit?.mergedDraftBeforeBoundary ?? sig.bookingDraft) as BookingDraft),
    };
    let rawReply: string;
    let rawAction: string;
    let replayInputSource: 'audit' | 'rawLlmJson';
    if (audit) {
      rawReply = audit.finalReplyBeforeBoundary;
      rawAction = audit.finalActionBeforeBoundary;
      replayInputSource = 'audit';
    } else {
      const rawStr = (r.metadata as Meta).rawLlmJson as string;
      const parsed = parseRawLlm(rawStr);
      rawReply = parsed.reply;
      rawAction = parsed.action;
      replayInputSource = 'rawLlmJson';
    }

    const overallReflection = replyReflectsDraftForConfirmation(rawReply, draft);
    if (overallReflection) overallReflectTrue++;

    const rb = reflectionBreakdown(rawReply, draft);
    if (!rb.svcOk) failByField.svc++;
    if (!rb.dateOk) failByField.date++;
    if (!rb.timeOk) failByField.time++;
    if (!rb.nameOk) failByField.name++;
    if (!rb.phoneOk) failByField.phone++;

    const boundary = applyConfirmationBoundaryPostProcess(draft, rawReply, rawAction, {
      currentMessage: audit ? audit.currentMessageIn : undefined,
      confirmationPending: audit ? audit.confirmationPendingIn : !!(sig as { confirmationPending?: boolean }).confirmationPending,
    });
    if (boundary.usedTemplate) usedTemplateCount++;

    if (rawAction === 'CONFIRM_BOOKING') {
      confirmSub.n++;
      if (boundary.usedTemplate) confirmSub.usedTemplate++;
      if (overallReflection) confirmSub.reflectPass++;
      if (!rb.svcOk) confirmSub.fail.svc++;
      if (!rb.dateOk) confirmSub.fail.date++;
      if (!rb.timeOk) confirmSub.fail.time++;
      if (!rb.nameOk) confirmSub.fail.name++;
      if (!rb.phoneOk) confirmSub.fail.phone++;
    }

    table.push({
      aiRunId: r.ai_run_id,
      conversationId: r.conversationId,
      messageId: r.msg_id,
      runAt: r.run_at.toISOString(),
      replayInputSource,
      mergedDraftAtBoundary: draft,
      rawLlmReplyBeforeBoundary: rawReply.slice(0, 400) + (rawReply.length > 400 ? '…' : ''),
      rawLlmAction: rawAction,
      replyAfterBoundaryReplay: boundary.reply.slice(0, 400) + (boundary.reply.length > 400 ? '…' : ''),
      svcOk: rb.svcOk,
      dateOk: rb.dateOk,
      timeOk: rb.timeOk,
      nameOk: rb.nameOk,
      phoneOk: rb.phoneOk,
      overallReflection,
      boundaryUsedTemplate: boundary.usedTemplate,
      persistedAssistantReply: (r.content as string).slice(0, 400) + ((r.content as string).length > 400 ? '…' : ''),
    });
  }

  console.log('\n--- TABLE (JSON) ---\n');
  console.log(JSON.stringify(table, null, 2));

  const n = picked.length;
  console.log('\n--- SUMMARY ---\n');
  console.log(
    JSON.stringify(
      {
        cohortNote:
          'Non-SUBMIT actions only. Prefers AiRun.signals._auditPreBoundary when present; else Message.metadata.rawLlmJson.',
        sampleSize: n,
        syntheticStagingUsedTemplateRate: 0.8,
        realReplayRawJsonUsedTemplateRate: n ? usedTemplateCount / n : null,
        overallReflectionPassRate: n ? overallReflectTrue / n : null,
        failBreakdownOnRawReply: failByField,
        confirmBookingOnlySubcohort: {
          sampleSizeInPicked: confirmSub.n,
          usedTemplateRate: confirmSub.n ? confirmSub.usedTemplate / confirmSub.n : null,
          overallReflectionPassRate: confirmSub.n ? confirmSub.reflectPass / confirmSub.n : null,
          failBreakdownOnRawReply: confirmSub.fail,
        },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
