/**
 * Phase 1E: Booking slot collection + confirmation wording only.
 * Does not change draft shape, validators, or mode transitions — copy + rhythm only.
 */

import type { BookingDraft } from './types';
import {
  getMissingSlots,
  formatDateDisplay,
  formatTimeDisplay,
} from './booking-state';

/** Multi-line form dump: avoid sounding like a spreadsheet in one breath. */
export const BOOKING_FORM_DUMP_PATTERN =
  /日期[:：].*時間[:：].*姓名[:：].*電話|日期.*\n.*時間.*\n.*姓名.*\n.*電話/s;

function ackForNextSlot(draft: BookingDraft, nextSlot: keyof BookingDraft): string {
  if (nextSlot === 'serviceName') {
    return '';
  }
  if (nextSlot === 'date' && draft.serviceDisplayName) {
    return `收到，「${draft.serviceDisplayName}」～\n`;
  }
  if (nextSlot === 'time' && draft.date) {
    return `收到，${formatDateDisplay(draft.date)} 呢日～\n`;
  }
  if (nextSlot === 'customerName' && draft.date && draft.time) {
    return `收到，${formatDateDisplay(draft.date)} ${formatTimeDisplay(draft.time)} 呢個時段～\n`;
  }
  if (nextSlot === 'phone' && draft.customerName) {
    return `多謝 ${draft.customerName}，\n`;
  }
  return '';
}

const SLOT_QUESTION: Record<string, string> = {
  serviceName: '想預約邊項服務？講個名就得。',
  date: '想約邊日？話我知個日子（例如「下星期三」）。',
  time: '大概幾點方便？講個時間（例如「下午3點」或「15:00」）。',
  customerName: '點稱呼你呀？',
  phone: '方便留個聯絡電話？同事確認預約會用呢個號聯絡你。',
};

function combinedDateTimeQuestion(): string {
  return (
    '想約邊日、大概幾點？一句講都得（例如「下星期三下午3點」），我幫你記低。'
  );
}

/**
 * Natural next-step prompt: one primary ask per turn, with optional safe
 * date+time merge when both are still empty (service already chosen).
 */
export function buildSlotCollectionPrompt(draft: BookingDraft): string {
  const missing = getMissingSlots(draft);
  if (missing.length === 0) return '';

  const next = missing[0];

  if (
    next === 'date' &&
    !draft.date &&
    !draft.time &&
    draft.serviceName
  ) {
    const prefix = ackForNextSlot(draft, 'date');
    return `${prefix}${combinedDateTimeQuestion()}`;
  }

  const prefix = ackForNextSlot(draft, next);
  const q = SLOT_QUESTION[next] ?? '';
  return `${prefix}${q}`;
}

export function buildAmbiguousServicePrompt(optionLabels: string): string {
  return `想預約邊一項呢？我哋有：${optionLabels}`;
}

/**
 * P3-safe copy: 已記低 / 幫你整理 — never "已預約成功" before explicit confirm.
 */
export function buildConfirmationSummaryReply(
  draft: BookingDraft,
  options?: { updatedField?: string; updatedValue?: string },
): string {
  const svc = draft.serviceDisplayName || draft.serviceName || '服務';
  const dateLabel = draft.date ? formatDateDisplay(draft.date) : '未提供';
  const timeLabel = draft.time ? formatTimeDisplay(draft.time) : '';
  const name = draft.customerName || '未提供';
  const phone = draft.phone || '未提供';

  let updateAck = '';
  if (options?.updatedField && options?.updatedValue) {
    const fieldLabels: Record<string, string> = {
      date: '日期',
      time: '時間',
      customerName: '稱呼',
      phone: '電話',
      serviceName: '療程',
    };
    const label = fieldLabels[options.updatedField] || options.updatedField;
    updateAck = `好，${label}已更新做「${options.updatedValue}」。\n\n`;
  }

  return (
    `${updateAck}幫你整理咗預約資料，睇下啱唔啱：\n` +
    `療程：${svc}\n` +
    `時間：${dateLabel}${timeLabel ? ' ' + timeLabel : ''}\n` +
    `聯絡：${name}（${phone}）\n\n` +
    `無問題請回覆「確認預約」，我就幫你提交申請。\n` +
    `想改日子、時間或聯絡資料，直接講出嚟就得。`
  );
}

/** After explicit confirm — same semantics as before; wording only. */
export function buildPostBookingSubmittedReply(draft: BookingDraft): string {
  const svc = draft.serviceDisplayName || draft.serviceName || '服務';
  const dateLabel = draft.date ? formatDateDisplay(draft.date) : '';
  const timeLabel = draft.time ? formatTimeDisplay(draft.time) : '';
  return (
    `好㗎！已幫你提交預約申請 🎉\n` +
    `療程：${svc}\n` +
    `時間：${dateLabel} ${timeLabel}\n` +
    `聯絡：${draft.customerName}（${draft.phone}）\n\n` +
    `同事確認後會再聯絡你，到時見！`
  );
}

export function verifyBookingConversationPolicyRegression(): {
  ok: boolean;
  failures: string[];
} {
  const failures: string[] = [];

  const empty: BookingDraft = {
    serviceName: null,
    serviceDisplayName: null,
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };
  const onlyService: BookingDraft = {
    ...empty,
    serviceName: 'eye_treatment',
    serviceDisplayName: 'Eye Treatment',
  };
  const p1 = buildSlotCollectionPrompt(onlyService);
  if (!p1.includes('邊日') && !p1.includes('幾點')) {
    failures.push(`combined date/time prompt expected 邊日/幾點, got: ${p1.slice(0, 120)}`);
  }
  if (BOOKING_FORM_DUMP_PATTERN.test(p1)) {
    failures.push('combined prompt must not look like a 4-line form dump');
  }

  const dateOnly: BookingDraft = {
    ...onlyService,
    date: '2026-04-10',
  };
  const p2 = buildSlotCollectionPrompt(dateOnly);
  if (!/幾點|時間|下午|點鐘/i.test(p2)) {
    failures.push(`time-only step expected time ask, got: ${p2.slice(0, 120)}`);
  }

  const conf = buildConfirmationSummaryReply(
    {
      serviceName: 'x',
      serviceDisplayName: 'Eye Treatment',
      date: '2026-03-25',
      time: '14:00',
      customerName: 'Amy',
      phone: '91234567',
    },
    { updatedField: 'time', updatedValue: '下午3點' },
  );
  if (!conf.includes('確認預約')) {
    failures.push('confirmation summary must invite 確認預約');
  }
  if (!conf.includes('更新')) {
    failures.push('correction ack should mention 更新');
  }

  const post = buildPostBookingSubmittedReply({
    serviceName: 'x',
    serviceDisplayName: 'Test',
    date: '2026-01-02',
    time: '10:00',
    customerName: 'Bob',
    phone: '90000000',
  });
  if (/搞掂|成功預約|已經預約|預約咗/.test(post)) {
    failures.push('post-booking reply must not use premature success claims');
  }

  return { ok: failures.length === 0, failures };
}
