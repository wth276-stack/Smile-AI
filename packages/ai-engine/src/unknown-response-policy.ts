/**
 * Phase 1C — Consistent wording for graceful unknown, clarify, missing-data honesty, and handoff.
 *
 * Does not classify intent, route questions, or select KB fields. Call sites remain unchanged;
 * this module only supplies reply frames. No LLM.
 *
 * Intentionally no imports from unknown-handler / handoff-trigger (avoids circular deps).
 */

// ── Handoff triggers that ship a customer reply (subset of handoff-trigger.ts) ─

export type PolicyHandoffReplyTrigger = 'explicit_handoff' | 'special_request' | 'multiple_corrections';

// ── Scene labels (documentation / tests) ─────────────────────────────────────

export type UnknownPolicyScene =
  | 'missing_field_honesty'
  | 'clarify_service'
  | 'clarify_ambiguous_option'
  | 'graceful_unknown_business'
  | 'graceful_unknown_casual'
  | 'needs_user_clarification'
  | 'handoff_to_human'
  | 'transition_soft_close';

// ── Missing structured data (Answer Planner / service detail) ─────────────────

export function missingFieldPriceHonesty(serviceName: string): string {
  return (
    `「${serviceName}」暫時未有價錢資料，唔會亂報。` +
    `方便嘅話用 WhatsApp 問同事，可以幫你查清楚。`
  );
}

export function missingFieldOtherHonesty(serviceName: string, missingLabels: string): string {
  return (
    `「${serviceName}」暫時未有${missingLabels}相關資料，我唔會亂講。` +
    `你可以 WhatsApp 問同事，或者問我其他已入庫嘅項目。`
  );
}

// ── Service context unclear (no match / ambiguous) ───────────────────────────

export function clarifyWhichService(): string {
  return '你想知邊個服務？話我知服務名稱，我先幫你對準資料。';
}

export function clarifyPickOne(optionsDisplay: string): string {
  return `有幾個可能係你想問嘅：${optionsDisplay}。你想了解邊一項？`;
}

export function clarifyWhichAspect(): string {
  return '你想知邊一方面？講多啲我可以幫你對。';
}

// ── Graceful unknown (question router → unknown) ─────────────────────────────

export function unknownCasualFollowUp(): string {
  return '收到。有咩想問？';
}

export function unknownAskMoreDetail(): string {
  return '想問邊部分？講多啲，我幫你睇。';
}

export function unknownShortPrompt(): string {
  return '收到。想問咩？可以講詳細啲。';
}

export function unknownBusinessPriceFollowUp(): string {
  return '價錢要睇返最新報價，我唔夠資料亂答。同事可以幫你查，你亦可以留聯絡方式。';
}

export function unknownBusinessServiceFollowUp(): string {
  return '呢個要睇返你嘅情況同最新安排，我唔亂應承。同事可以幫你跟進，或者你留低聯絡方式。';
}

export function unknownBusinessBookingFollowUp(): string {
  return '排期要同事確認。你可以留聯絡方式，佢哋會覆你。';
}

export function unknownBusinessGenericFollowUp(): string {
  return '呢方面我唔夠資料亂答。同事可以幫你跟進，你亦可以留聯絡方式。';
}

// ── Handoff (P7 lite — customer-facing only; detection stays in handoff-trigger) ─

export function handoffReplyForTrigger(triggerType: PolicyHandoffReplyTrigger): string {
  switch (triggerType) {
    case 'explicit_handoff':
      return '好，我幫你交俾同事跟進，佢哋會盡快聯絡你。';
    case 'special_request':
      return '收到，你講嘅情況需要同事親自跟進。我轉交俾佢哋，會有人聯絡你確認。';
    case 'multiple_corrections':
      return '見到你改咗幾次，為免安排錯，我轉交同事同你直接確認，佢哋會聯絡你。';
  }
}

/** Map legacy unknown classification to policy reply (classification logic unchanged). */
export function replyForUnknownType(type: string, messageLower: string): string {
  const m = messageLower;
  if (type === 'casual_chat') {
    return unknownCasualFollowUp();
  }
  if (type === 'needs_clarification') {
    return unknownAskMoreDetail();
  }
  if (type === 'short_input') {
    return unknownShortPrompt();
  }
  // business_question
  if (/幾錢|價錢|收費|費用|貴|平/.test(m)) {
    return unknownBusinessPriceFollowUp();
  }
  if (/療程|做.*嗎|可以.*嗎|適合|唔適合/.test(m)) {
    return unknownBusinessServiceFollowUp();
  }
  if (/有冇位|幾時有位|約.*嗎|得唔得/.test(m)) {
    return unknownBusinessBookingFollowUp();
  }
  return unknownBusinessGenericFollowUp();
}

// ── Regression ────────────────────────────────────────────────────────────────

export function verifyUnknownResponsePolicyRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const p = missingFieldPriceHonesty('測試療程');
  if (!p.includes('測試療程') || !p.includes('價錢')) {
    failures.push(`missingFieldPriceHonesty should name service and admit no price: ${p}`);
  }
  if (/😊|📝|🙏/.test(p)) {
    failures.push('missingFieldPriceHonesty should avoid heavy emoji');
  }

  const o = missingFieldOtherHonesty('測試', '注意事項');
  if (!o.includes('注意事項') || !o.includes('亂講')) {
    failures.push(`missingFieldOtherHonesty should state gap honestly: ${o}`);
  }

  if (!clarifyWhichService().includes('服務')) {
    failures.push('clarifyWhichService should ask for service');
  }

  const hb = handoffReplyForTrigger('explicit_handoff');
  if (!hb.includes('同事')) {
    failures.push('handoff explicit should mention human follow-up');
  }

  const u = replyForUnknownType('business_question', '呢個療程幾錢呀');
  if (!u.includes('價錢') && !u.includes('查')) {
    failures.push(`business price unknown should hint follow-up: ${u}`);
  }

  const casual = replyForUnknownType('casual_chat', 'hi');
  if (casual.length > 80) {
    failures.push('casual reply should stay short');
  }

  return { ok: failures.length === 0, failures };
}
