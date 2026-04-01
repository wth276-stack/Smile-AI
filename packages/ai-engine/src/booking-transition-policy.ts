/**
 * Phase 1D — Natural transition after informational (service detail) answers.
 *
 * Does not start or validate booking; does not change booking-state. Only replaces the
 * standard verbalizer soft-close when the *current user message* signals a tier
 * (explicit booking intent, human/WhatsApp first, or soft lead). Default: keep info-only close.
 *
 * No LLM. Tier = deterministic regex on folded user message (order matters).
 */

import { SERVICE_DETAIL_SOFT_CLOSE } from './service-detail-verbalizer';

export type TransitionTier = 'explicit_booking' | 'human_first' | 'lead_soft' | 'info_only';

/**
 * Classify how aggressively to suggest next step. First match wins.
 * - explicit_booking: user already showing booking action intent in this message
 * - human_first: prefers human / WhatsApp / contact
 * - lead_soft: exploring, compare, suitability — not ready to book
 * - info_only: pure info question → keep default soft close (no extra push)
 */
export function classifyTransitionTier(foldedMsg: string): TransitionTier {
  const msg = foldedMsg.trim();
  if (
    /想預約|幫我\s*book|約時間|有冇位|有冇得約|幾時得|book(ing)?|預約|想約/i.test(msg)
  ) {
    return 'explicit_booking';
  }
  if (/真人|whatsapp|留電話|留電|聯絡方式|點聯絡|搵同事|同同事傾|想搵人/i.test(msg)) {
    return 'human_first';
  }
  if (/有興趣|想了解下|想比較|適唔適合|再問清楚|多啲資料|想知多啲|想清楚啲/i.test(msg)) {
    return 'lead_soft';
  }
  return 'info_only';
}

function transitionClosingLine(tier: TransitionTier): string {
  switch (tier) {
    case 'explicit_booking':
      return '\n\n想預約嘅話，話我知邊日、邊個時段方便，我幫你跟進。';
    case 'human_first':
      return '\n\n想同事詳細跟進或 WhatsApp，留低聯絡方式，我可以幫你轉達。';
    case 'lead_soft':
      return '\n\n如果想再睇邊款啱你，講多啲你嘅情況，我可以幫你對。';
    case 'info_only':
      return SERVICE_DETAIL_SOFT_CLOSE;
  }
}

/**
 * Replace Phase 1B soft close only when tier !== info_only. Preserves all body text / facts.
 * If reply does not end with the expected soft close (e.g. missing-field path), unchanged.
 */
export function applyBookingTransitionToServiceDetailReply(reply: string, foldedMsg: string): string {
  const tier = classifyTransitionTier(foldedMsg);
  if (tier === 'info_only') {
    return reply;
  }
  if (!reply.endsWith(SERVICE_DETAIL_SOFT_CLOSE)) {
    return reply;
  }
  return reply.slice(0, -SERVICE_DETAIL_SOFT_CLOSE.length) + transitionClosingLine(tier);
}

// ── Regression ────────────────────────────────────────────────────────────────

export function verifyBookingTransitionPolicyRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const body = '「HIFU」功效：測試內容';
  const base = body + SERVICE_DETAIL_SOFT_CLOSE;

  if (applyBookingTransitionToServiceDetailReply(base, 'HIFU 有咩功效') !== base) {
    failures.push('pure info question should keep default close');
  }

  const t1 = applyBookingTransitionToServiceDetailReply(base, '想預約 HIFU');
  if (!t1.includes('邊日') || t1.includes(SERVICE_DETAIL_SOFT_CLOSE)) {
    failures.push(`explicit_booking should replace close: ${t1}`);
  }
  if (!t1.includes('測試內容')) {
    failures.push('explicit_booking must preserve fact body');
  }

  const t2 = applyBookingTransitionToServiceDetailReply(base, 'whatsapp 問下');
  if (!t2.includes('WhatsApp') || !t2.includes('同事')) {
    failures.push(`human_first should mention colleague/whatsapp: ${t2}`);
  }

  const t3 = applyBookingTransitionToServiceDetailReply(base, '有興趣想了解下');
  if (!t3.includes('情況')) {
    failures.push(`lead_soft should offer soft next step: ${t3}`);
  }

  if (classifyTransitionTier('') !== 'info_only') {
    failures.push('empty msg should be info_only');
  }

  return { ok: failures.length === 0, failures };
}
