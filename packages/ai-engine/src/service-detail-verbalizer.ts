/**
 * Phase 1B — Lightweight verbalization for service detail replies only.
 *
 * Does not select fields; does not read ServiceEntry beyond what caller passes as preservation tokens.
 * planAnswer() / FIELD_PRIORITY remain the only facts source upstream.
 */

import type { AnswerPlan } from './answer-planner';
import type { QuestionType } from './question-router';

export interface VerbalizeServiceDetailInput {
  questionType: QuestionType;
  /** Raw reply from getServiceSection (after AnswerPlan overlay). */
  baseReply: string;
  /** Substrings that must remain in the output (from AnswerPlan.facts). */
  preservationTokens: string[];
}

const TRAILING_CTA_PATTERNS: RegExp[] = [
  /\n\n想預約或者了解更多，隨時話我知 😊/,
  /\n\n想了解更多或預約，可以直接話我知 😊/,
  /\n\n想預約可以直接話我知 😊/,
];

/** Phase 1D: must match booking-transition-policy replacement target. */
export const SERVICE_DETAIL_SOFT_CLOSE = '\n\n有咩想再問，隨時話我知。';

/**
 * Build non-empty substrings that must appear in any verbalized reply for facts-preserving checks.
 * Mirrors keys populated by planAnswer extractFacts — no new field selection.
 */
export function preservationTokensFromFacts(facts: AnswerPlan['facts']): string[] {
  const out: string[] = [];
  const push = (s?: string | null) => {
    const t = s?.trim();
    if (t) out.push(t);
  };
  push(facts.discountPrice);
  push(facts.price);
  push(facts.effect);
  push(facts.precaution);
  push(facts.suitable);
  push(facts.unsuitable);
  push(facts.duration);
  if (facts.steps?.length) {
    for (const step of facts.steps) push(step);
  }
  if (facts.faqItems?.length) {
    for (const item of facts.faqItems) {
      push(item.question);
      push(item.answer);
    }
  }
  push(facts.content);
  return out;
}

function allTokensPresent(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (!text.includes(t)) return false;
  }
  return true;
}

/**
 * Light touch: softer closing, fewer emoji on price lines, slightly more spoken connectors — only if every preservation token stays.
 */
export function verbalizeServiceDetailReply(input: VerbalizeServiceDetailInput): string {
  const { baseReply, preservationTokens, questionType } = input;
  const tokens = preservationTokens.filter((t) => t.length > 0);
  let candidate = baseReply;

  // 1) Softer closing (same info invitation, less template / emoji)
  for (const re of TRAILING_CTA_PATTERNS) {
    if (re.test(candidate)) {
      const next = candidate.replace(re, SERVICE_DETAIL_SOFT_CLOSE);
      if (allTokensPresent(next, tokens)) candidate = next;
      break;
    }
  }

  // 2) Price: drop decorative 💰 (keep HKD / numbers as part of tokens)
  if (questionType === 'service_price') {
    const next = candidate.replace(/ 💰/g, '');
    if (allTokensPresent(next, tokens)) candidate = next;
  }

  // 3) Connectors: slightly more spoken, only when label+colon pattern exists
  if (questionType === 'service_effect' || questionType === 'service_expected_result') {
    let next = candidate.replace(/」功效：/g, '」嘅功效係 ');
    if (!allTokensPresent(next, tokens)) next = candidate;
    else candidate = next;
  }
  if (questionType === 'service_precaution' || questionType === 'service_aftercare') {
    let next = candidate.replace(/」注意事項：/g, '」要注意嘅係 ');
    if (!allTokensPresent(next, tokens)) next = candidate;
    else candidate = next;
  }
  if (questionType === 'service_suitable_for') {
    let next = candidate.replace(/」適合對象：/g, '」適合 ');
    if (!allTokensPresent(next, tokens)) next = candidate;
    else candidate = next;
  }
  if (questionType === 'service_unsuitable_for') {
    let next = candidate.replace(/」不適合對象：/g, '」唔適合 ');
    if (!allTokensPresent(next, tokens)) next = candidate;
    else candidate = next;
  }
  if (questionType === 'service_duration') {
    let next = candidate.replace(/」時長：/g, '」大約 ');
    if (!allTokensPresent(next, tokens)) next = candidate;
    else candidate = next;
  }
  if (questionType === 'service_procedure') {
    let next = candidate.replace(/」療程步驟：\n/g, '」步驟如下：\n');
    if (!allTokensPresent(next, tokens)) next = candidate;
    else candidate = next;
  }

  if (!allTokensPresent(candidate, tokens)) {
    return baseReply;
  }
  return candidate;
}

// ── Regression ────────────────────────────────────────────────────────────────

export function verifyServiceDetailVerbalizationRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const factsPrice: AnswerPlan['facts'] = {
    discountPrice: 'HKD 880',
    price: 'HKD 1200',
  };
  const basePrice =
    '「HIFU」原價 HKD 1200，而家優惠價 HKD 880 💰\n\n想預約或者了解更多，隨時話我知 😊';
  const tokP = preservationTokensFromFacts(factsPrice);
  const vPrice = verbalizeServiceDetailReply({
    questionType: 'service_price',
    baseReply: basePrice,
    preservationTokens: tokP,
  });
  if (!vPrice.includes('HKD 880') || !vPrice.includes('HKD 1200')) {
    failures.push(`PRICE verbalization lost amounts: ${vPrice}`);
  }
  if (vPrice.includes('💰')) {
    failures.push('PRICE verbalization should drop 💰 when tokens preserved');
  }

  const factsEffect: AnswerPlan['facts'] = { effect: '拉提緊緻，改善輪廓' };
  const baseEffect =
    '「HIFU」功效：拉提緊緻，改善輪廓\n\n想了解更多或預約，可以直接話我知 😊';
  const vEffect = verbalizeServiceDetailReply({
    questionType: 'service_effect',
    baseReply: baseEffect,
    preservationTokens: preservationTokensFromFacts(factsEffect),
  });
  if (!vEffect.includes('拉提緊緻，改善輪廓')) {
    failures.push(`EFFECT lost fact: ${vEffect}`);
  }

  const factsPre: AnswerPlan['facts'] = { precaution: '術後避免暴曬' };
  const basePre =
    '「HIFU」注意事項：術後避免暴曬\n\n想了解更多或預約，可以直接話我知 😊';
  const vPre = verbalizeServiceDetailReply({
    questionType: 'service_precaution',
    baseReply: basePre,
    preservationTokens: preservationTokensFromFacts(factsPre),
  });
  if (!vPre.includes('術後避免暴曬')) {
    failures.push(`PRECAUTION lost fact: ${vPre}`);
  }

  const factsSu: AnswerPlan['facts'] = { suitable: '皮膚鬆弛人士' };
  const baseSu =
    '「HIFU」適合對象：皮膚鬆弛人士\n\n想了解更多或預約，可以直接話我知 😊';
  const vSu = verbalizeServiceDetailReply({
    questionType: 'service_suitable_for',
    baseReply: baseSu,
    preservationTokens: preservationTokensFromFacts(factsSu),
  });
  if (!vSu.includes('皮膚鬆弛人士')) {
    failures.push(`SUITABLE lost fact: ${vSu}`);
  }

  const factsUn: AnswerPlan['facts'] = { unsuitable: '孕婦' };
  const baseUn =
    '「HIFU」不適合對象：孕婦\n\n想了解更多或預約，可以直接話我知 😊';
  const vUn = verbalizeServiceDetailReply({
    questionType: 'service_unsuitable_for',
    baseReply: baseUn,
    preservationTokens: preservationTokensFromFacts(factsUn),
  });
  if (!vUn.includes('孕婦')) {
    failures.push(`UNSUITABLE lost fact: ${vUn}`);
  }

  // If token cannot be preserved, must fall back to base
  const broken = verbalizeServiceDetailReply({
    questionType: 'service_effect',
    baseReply: baseEffect,
    preservationTokens: ['絕不會出現嘅假字串'],
  });
  if (broken !== baseEffect) {
    failures.push('should return baseReply when tokens cannot be preserved');
  }

  return { ok: failures.length === 0, failures };
}
