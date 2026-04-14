import type { BookingDraft } from '../types';
import { bookingDraftHasAllRequiredSlots, formatDateDisplay, formatTimeDisplay } from '../booking-state';

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

function timeAppearsInReply(reply: string, time: string): boolean {
  if (!time) return true;
  if (reply.includes(time)) return true;
  const display = formatTimeDisplay(time);
  return normalizeCompact(reply).includes(normalizeCompact(display));
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

/**
 * Returns true when the reply text plausibly contains all booking details from the merged draft
 * (substring match — not semantic judging).
 */
export function replyReflectsDraftForConfirmation(reply: string, draft: BookingDraft): boolean {
  if (!reply.trim()) return false;
  const svcOk = serviceAppearsInReply(reply, draft);
  const dateOk = draft.date ? dateAppearsInReply(reply, draft.date) : false;
  const timeOk = draft.time ? timeAppearsInReply(reply, draft.time) : false;
  const nameOk = draft.customerName ? nameAppearsInReply(reply, draft.customerName) : false;
  const phoneOk = draft.phone ? phoneAppearsInReply(reply, draft.phone) : false;
  return svcOk && dateOk && timeOk && nameOk && phoneOk;
}

export function buildDeterministicConfirmationReply(draft: BookingDraft): string {
  const service = (draft.serviceDisplayName ?? draft.serviceName ?? '').trim();
  const dateLine = draft.date ? formatDateDisplay(draft.date) : '';
  const timeLine = draft.time ? formatTimeDisplay(draft.time) : '';
  const name = draft.customerName?.trim() ?? '';
  const phone = draft.phone?.trim() ?? '';
  return [
    '幫你確認一下預約資料：',
    '',
    `- 服務：${service}`,
    `- 日期：${dateLine}`,
    `- 時間：${timeLine}`,
    `- 姓名：${name}`,
    `- 電話：${phone}`,
    '',
    '請問以上資料正確嗎？',
  ].join('\n');
}

export interface ConfirmationBoundaryResult {
  reply: string;
  action: string;
  /** True when a deterministic template replaced the LLM reply (Case 3). */
  usedTemplate: boolean;
}

/**
 * Post-process after LLM + slot merge: server-owned confirmation state when all slots are filled.
 * Cases: (1) complete + CONFIRM → keep (2) complete + wrong action → keep text, set CONFIRM (3) incomplete → template + CONFIRM.
 */
export function applyConfirmationBoundaryPostProcess(
  mergedDraft: BookingDraft,
  reply: string,
  action: string,
): ConfirmationBoundaryResult {
  if (!bookingDraftHasAllRequiredSlots(mergedDraft)) {
    return { reply, action, usedTemplate: false };
  }

  if (
    action === 'SUBMIT_BOOKING' ||
    action === 'MODIFY_BOOKING' ||
    action === 'CANCEL_BOOKING' ||
    action === 'HANDOFF'
  ) {
    return { reply, action, usedTemplate: false };
  }

  const complete = replyReflectsDraftForConfirmation(reply, mergedDraft);

  if (!complete) {
    return {
      reply: buildDeterministicConfirmationReply(mergedDraft),
      action: 'CONFIRM_BOOKING',
      usedTemplate: true,
    };
  }

  if (action === 'CONFIRM_BOOKING') {
    return { reply, action, usedTemplate: false };
  }

  return { reply, action: 'CONFIRM_BOOKING', usedTemplate: false };
}
