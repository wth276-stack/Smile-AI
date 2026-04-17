import type { BookingDraft } from '../types';
import { bookingDraftHasAllRequiredSlots, formatDateDisplay, formatTimeDisplay } from '../booking-state';
import { isBookingConfirmationRejectionMessage } from './booking-confirmation-rejection';

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

/** 12-hour clock face (1–12), AM/PM for English matching. */
function toEnglish12Parts(h24: number): { h12: number; pm: boolean } {
  const pm = h24 >= 12;
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { h12, pm };
}

/** Spoken period prefixes for HK Cantonese / Mandarin (draft uses HK 24h slot). */
function periodsForSpokenHour(h24: number): string[] {
  if (h24 >= 0 && h24 <= 4) return ['凌晨', '深夜'];
  if (h24 >= 5 && h24 <= 11) return ['上午', '朝早', '早上'];
  if (h24 === 12) return ['中午', '下午'];
  if (h24 >= 13 && h24 <= 17) return ['下午'];
  if (h24 === 18) return ['下午', '傍晚', '晚上'];
  if (h24 >= 19 && h24 <= 23) return ['晚上', '下午'];
  return ['下午'];
}

const HOUR_ZH: Partial<Record<number, string>> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九',
  10: '十',
  11: '十一',
  12: '十二',
};

function buildSpokenTimeFingerprints(h24: number, min: number): Set<string> {
  const zh = new Set<string>();
  const h12 = toEnglish12Parts(h24).h12;
  const minStr = String(min).padStart(2, '0');
  const minN = min;

  const fpZh = (s: string) => zh.add(normalizeCompact(s));

  const periods = periodsForSpokenHour(h24);
  const hourNumeral = HOUR_ZH[h12];
  for (const period of periods) {
    fpZh(`${period}${h12}點`);
    fpZh(`${period}${h12}點鐘`);
    fpZh(`${period}${h12}：${minStr}`);
    fpZh(`${period}${h12}:${minStr}`);
    if (hourNumeral) {
      fpZh(`${period}${hourNumeral}點`);
    }
    if (h12 === 2) {
      fpZh(`${period}兩點`);
    }
    if (minN !== 0) {
      fpZh(`${period}${h12}點${minN}分`);
      fpZh(`${period}${h12}點${minStr}分`);
    }
    if (minN === 30) {
      fpZh(`${period}${h12}點半`);
      if (hourNumeral) fpZh(`${period}${hourNumeral}點半`);
    }
  }

  fpZh(`${h24}:${minStr}`);

  if (minN === 0 && h24 >= 13) {
    fpZh(`${h24}點`);
  }

  const slotForDisplay = `${String(h24).padStart(2, '0')}:${minStr}`;
  const d = formatTimeDisplay(slotForDisplay);
  fpZh(d);
  if (minN === 0) {
    fpZh(d.replace(/:00$/u, '點'));
  } else {
    fpZh(d.replace(/:(\d+)$/u, (_, mm) => `點${mm}分`));
    if (minN === 30) fpZh(d.replace(/:30$/u, '點半'));
  }

  return zh;
}

/** Avoid false positives like matching 1:00pm inside 11:00pm. */
function englishSpokenTimeMatches(reply: string, h24: number, min: number): boolean {
  const low = reply.toLowerCase();
  const { h12, pm } = toEnglish12Parts(h24);
  const ms = String(min).padStart(2, '0');
  const ap = pm ? 'pm' : 'am';
  const reList = [
    new RegExp(`(?<![0-9])${h12}:${ms}\\s*${ap}\\b`, 'i'),
    new RegExp(`(?<![0-9])${h12}:${min}\\s*${ap}\\b`, 'i'),
  ];
  if (min === 0) {
    reList.push(new RegExp(`(?<![0-9])${h12}\\s*${ap}\\b`, 'i'));
  }
  return reList.some((re) => re.test(low));
}

/**
 * True when the reply plausibly names the same clock time as the draft slot (HH:mm).
 * Accepts colloquial Cantonese/Mandarin (下午1點, 朝早11點, 晚上7點) and common English (7:30pm).
 */
export function timeAppearsInReply(reply: string, time: string): boolean {
  if (!time) return true;
  if (reply.includes(time)) return true;
  const display = formatTimeDisplay(time);
  const ncReply = normalizeCompact(reply);
  if (ncReply.includes(normalizeCompact(display))) return true;

  const parts = time.trim().split(':');
  const h24 = Number(parts[0]);
  const min = parts.length > 1 ? Number(parts[1]) : 0;
  if (Number.isNaN(h24) || Number.isNaN(min) || h24 < 0 || h24 > 23 || min < 0 || min > 59) {
    return false;
  }

  const zh = buildSpokenTimeFingerprints(h24, min);
  for (const fp of zh) {
    if (fp && ncReply.includes(fp)) return true;
  }
  if (englishSpokenTimeMatches(reply, h24, min)) return true;
  return false;
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

export interface ConfirmationBoundaryOptions {
  /** Current user message (for rejection / modify intent). */
  currentMessage?: string;
  /** True when the previous turn ended in CONFIRM_BOOKING / awaiting confirmation. */
  confirmationPending?: boolean;
  /**
   * When set (e.g. duplicate-affirm guard coerced SUBMIT → REPLY_ONLY), skip Case 3
   * deterministic confirmation template so the reply does not look like pending confirmation.
   */
  skipDeterministicConfirmationTemplate?: boolean;
}

/**
 * Post-process after LLM + slot merge: server-owned confirmation state when all slots are filled.
 * Cases: (1) complete + CONFIRM → keep (2) complete + wrong action → keep text, set CONFIRM (3) incomplete → template + CONFIRM.
 */
export function applyConfirmationBoundaryPostProcess(
  mergedDraft: BookingDraft,
  reply: string,
  action: string,
  opts?: ConfirmationBoundaryOptions,
): ConfirmationBoundaryResult {
  if (!bookingDraftHasAllRequiredSlots(mergedDraft)) {
    return { reply, action, usedTemplate: false };
  }

  if (
    opts?.confirmationPending &&
    opts.currentMessage &&
    isBookingConfirmationRejectionMessage(opts.currentMessage)
  ) {
    let a = action;
    if (a === 'CONFIRM_BOOKING' || a === 'REPLY' || a === 'REPLY_ONLY') {
      a = 'COLLECT_BOOKING';
    }
    if (a === 'SUBMIT_BOOKING') {
      a = 'COLLECT_BOOKING';
    }
    return { reply, action: a, usedTemplate: false };
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
    if (opts?.skipDeterministicConfirmationTemplate) {
      return { reply, action, usedTemplate: false };
    }
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
