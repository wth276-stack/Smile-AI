/**
 * llm-strategy-guard.ts
 *
 * Helper functions to apply strategy constraints to LLM prompts.
 * This ensures LLM-generated responses follow the mustDo/forbidden rules.
 *
 * Key principle: "Rule decides, KB supplies, LLM phrases"
 * - Strategy defines what MUST be done and what MUST NOT be done
 * - LLM uses this as guardrails while generating natural language
 */

import type { StrategyConfig } from './strategy-selector';
import type { ConversationStage } from './conversation-stage';
import type { CustomerSignals } from './customer-signals';

// ── Prompt Guardrails ───────────────────────────────────────────────────────────

/**
 * Generates a system prompt section with strategy constraints.
 * This should be added to the LLM system prompt.
 */
export function buildStrategyGuardPrompt(
  strategy: StrategyConfig,
  stage: ConversationStage,
  signals: CustomerSignals,
): string {
  const parts: string[] = [];

  // Stage context
  parts.push(`## 對話階段\n你目前處於「${stage}」階段。`);

  // Customer state
  parts.push(`## 客戶狀態`);
  parts.push(`- 情緒：${signals.emotion}`);
  parts.push(`- 信任程度：${signals.trust}/5`);
  parts.push(`- 購買準備度：${signals.readiness}/5`);
  if (signals.resistance !== 'none') {
    parts.push(`- 當前阻力：${signals.resistance}`);
  }
  parts.push(`- 溝通風格：${signals.style}`);

  // Strategy
  parts.push(`## 當前策略\n策略：${strategy.strategy}`);
  parts.push(`原因：${strategy.reason}`);

  // Must-do
  if (strategy.mustDo.length > 0) {
    parts.push(`\n### 必須做到（Must Do）`);
    parts.push(`以下動作必須在回覆中體現：`);
    for (const action of strategy.mustDo) {
      parts.push(`- ${formatMustDo(action)}`);
    }
  }

  // Forbidden
  if (strategy.forbidden.length > 0) {
    parts.push(`\n### 絕對禁止（Forbidden）`);
    parts.push(`以下行為絕對不能出現在回覆中：`);
    for (const action of strategy.forbidden) {
      parts.push(`- ${formatForbidden(action)}`);
    }
  }

  // Tone guidance
  parts.push(`\n## 語氣指導`);
  parts.push(`使用「${strategy.tone}」語氣。`);
  if (strategy.urgency === 'immediate') {
    parts.push(`這是緊急情況，請盡快回覆。`);
  } else if (strategy.urgency === 'delayed') {
    parts.push(`可以稍後再跟進，無需急於推進。`);
  }

  // Handoff warning
  if (strategy.shouldEscalate) {
    parts.push(`\n## 轉人工警告`);
    parts.push(`此情況需要轉交人工客服處理。請禮貌地告知客戶會有同事跟進。`);
  }

  return parts.join('\n');
}

/**
 * Formats must-do actions into human-readable instructions.
 */
function formatMustDo(action: string): string {
  const actionMap: Record<string, string> = {
    acknowledge_customer: '確認收到客戶訊息',
    ask_need: '詢問客戶需要',
    offer_help: '提供協助',
    ask_open_question: '提出開放式問題',
    listen_actively: '積極聆聽',
    give_answer: '提供準確答案',
    check_understanding: '確認理解正確',
    present_service: '介紹服務',
    explain_benefit: '說明好處',
    ask_interest: '詢問興趣',
    acknowledge_emotion: '確認並回應情緒',
    clarify_issue: '釐清問題',
    offer_next_step: '提供下一步選項',
    acknowledge_price_concern: '確認價格關注',
    clarify_value: '說明價值',
    offer_alternatives: '提供替代方案',
    provide_proof: '提供證明/案例',
    offer_flexibility: '提供彈性選擇',
    acknowledge_timing: '確認時間考慮',
    leave_open: '保持開放',
    ask_missing_slot: '詢問缺少嘅資料',
    confirm_collected: '確認已收集嘅資料',
    summarize_booking: '總結預約資料',
    ask_explicit_confirmation: '請求明確確認',
    acknowledge: '確認收到',
    apologize_sincerely: '真誠道歉',
    acknowledge_concern: '確認關注點',
    address_objection: '回應異議',
    check_resolution: '確認是否解決',
    offer_solution: '提供解決方案',
    provide_contact: '提供聯絡方式',
    set_expectation: '設定期望',
    thank_customer: '感謝客戶',
    confirm_booking: '確認預約',
    provide_next_steps: '說明下一步',
    offer_support: '提供支援',
    clarify_budget_concern: '釐清預算關注',
    quantify_benefit: '量化好處',
    quantify_value: '量化價值',
    offer_right_sized_option: '提供合適選項',
    build_trust: '建立信任',
    avoid_push: '避免硬推',
    avoid_pressure: '避免壓力',
    avoid_hard_sell: '避免硬銷',
    handle_objection: '處理異議',
    discover_need: '探索需求',
    validate_understanding: '確認理解',
    educate: '教育客戶',
    build_rapport: '建立關係',
    soft_close: '軟性促成',
    handle_change: '處理變更',
    clarify_need: '釐清需求',
    ask_clarifying_questions: '提出釐清問題',
    ask_confirmation: '請求確認',
    offer_consultation: '提供諮詢',
    suggest_future_follow: '建議未來跟進',
    offer_reminder: '提供提醒',
    check_satisfaction: '確認滿意度',
  };

  return actionMap[action] || action;
}

/**
 * Formats forbidden actions into human-readable instructions.
 */
function formatForbidden(action: string): string {
  const actionMap: Record<string, string> = {
    upsell: '不要推銷額外服務',
    push_booking: '不要強迫預約',
    hard_close: '不要硬性成交',
    argue: '不要爭辯',
    blame_customer: '不要責怪客戶',
    pressure: '不要施加壓力',
    random_discount: '不要隨意折扣',
    long_explanations: '不要長篇大論',
    irrelevant_info: '不要提供無關資訊',
    vague_answers: '不要模糊回答',
    dry_facts_only: '不要只講事實',
    assume_details: '不要假設資料',
    skip_verification: '不要跳過核實',
    create_urgency_artificially: '不要人為製造緊急',
    push_booking_without_interest: '不要在未有興趣時推預約',
    dismissive_response: '不要敷衍回應',
    complex_explanations: '不要複雜解釋',
    ask_personal_questions: '不要問私人問題',
    ask_contact: '不要索取聯絡方式',
    recommend_before_understanding: '不要未了解就推薦',
    assume_confirmed: '不要假設已確認',
    defend: '不要辯護',
    minimize_issue: '不要輕視問題',
    delay_response: '不要延遲回覆',
    hard_push: '不要硬推',
    over_explain_policy: '不要過度解釋政策',
  };

  return actionMap[action] || action;
}

/**
 * Validates that a response meets the strategy requirements.
 * Returns list of violations found.
 */
export function validateResponseAgainstStrategy(
  response: string,
  strategy: StrategyConfig,
): {
  valid: boolean;
  missingMustDo: string[];
  containsForbidden: string[];
} {
  const missingMustDo: string[] = [];
  const containsForbidden: string[] = [];

  // Check must-do (simplified - real validation needs semantic understanding)
  // For now, we just check if the response is substantial enough
  for (const action of strategy.mustDo) {
    // Simple heuristic checks
    if (action === 'acknowledge_emotion' && !hasAcknowledge(response)) {
      missingMustDo.push(action);
    }
    if (action === 'ask_missing_slot' && !hasQuestion(response)) {
      missingMustDo.push(action);
    }
    if (action === 'provide_next_steps' && !hasNextStep(response)) {
      missingMustDo.push(action);
    }
  }

  // Check forbidden
  for (const action of strategy.forbidden) {
    if (action === 'upsell' && hasUpsell(response)) {
      containsForbidden.push(action);
    }
    if (action === 'push_booking' && hasPushBooking(response)) {
      containsForbidden.push(action);
    }
    if (action === 'hard_close' && hasHardClose(response)) {
      containsForbidden.push(action);
    }
    if (action === 'pressure' && hasPressure(response)) {
      containsForbidden.push(action);
    }
  }

  return {
    valid: missingMustDo.length === 0 && containsForbidden.length === 0,
    missingMustDo,
    containsForbidden,
  };
}

// ── Helper Functions ───────────────────────────────────────────────────────────

function hasAcknowledge(text: string): boolean {
  return /明白|了解|收到|明白|理解|抱歉|不好意思|唔好意思/i.test(text);
}

function hasQuestion(text: string): boolean {
  return /\?|？|嗎|呢|邊個|幾時|點樣|幾多/i.test(text);
}

function hasNextStep(text: string): boolean {
  return /會.*跟進|同事.*聯絡|下一步|之後|確認後/i.test(text);
}

function hasUpsell(text: string): boolean {
  return /加購|升級|upgrade|額外|加埋/i.test(text);
}

function hasPushBooking(text: string): boolean {
  return /立即預約|馬上約|現在就約|即刻約|快啲約/i.test(text);
}

function hasHardClose(text: string): boolean {
  return /一定要|必須|一定要依家|今日內|限時/i.test(text);
}

function hasPressure(text: string): boolean {
  return /限時|今日最後|唔買就冇|最後機會/i.test(text);
}

// ── Stage-Based Response Guidance ───────────────────────────────────────────────

/**
 * Returns stage-specific response guidance.
 * This helps LLM understand what kind of response is appropriate.
 */
export function getStageGuidance(stage: ConversationStage): string {
  const guidance: Record<ConversationStage, string> = {
    greeting: '這是初次接觸。保持友善、簡潔，詢問客戶需要什麼。',
    discover: '正在探索需求。提出開放式問題，了解客戶真正需要。',
    clarify: '需要釐清。提出具體問題，確認理解。',
    answer: '提供資訊。清晰、準確地回答問題。',
    recommend: '推薦服務。根據已知需求，建議適合的服務。',
    objection: '處理異議。先確認關注點，再回應，不要急於推銷。',
    price_discuss: '討論價格。說明價值，提供選擇，不要隨意打折。',
    negotiate: '協商中。聆聽需求，尋找雙贏方案。',
    booking_init: '開始預約流程。詢問服務、日期、時間。',
    booking_slots: '收集預約資料。逐一詢問缺少的資料。',
    confirm: '確認預約。總結資料，請求明確確認。',
    post_booking: '預約完成。確認細節，提供跟進資訊。',
    complaint: '處理投訴。先聆聽、道歉、確認問題、提供解決方案。',
    repair: '修復關係。真誠回應，解決問題。',
    escalation: '轉交人工。禮貌告知，提供聯絡方式。',
    follow_up: '跟進中。確認滿意度，提供支援。',
    upsell: '嘗試加購。根據需求自然引入，不要硬推。',
    close: '結束對話。禮貌道別，保持開放。',
    unknown: '未知狀態。保持友善，詢問客戶需要什麼。',
  };

  return guidance[stage] || guidance.unknown;
}

// ── Regression Tests ───────────────────────────────────────────────────────────

export function verifyLlmStrategyGuardRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Strategy guard prompt should contain must-do
  const testStrategy: StrategyConfig = {
    strategy: 'discover_need',
    priority: 'primary',
    reason: 'Customer is exploring',
    mustDo: ['ask_need', 'listen_actively'],
    niceToDo: ['offer_help'],
    forbidden: ['push_booking', 'upsell'],
    tone: 'friendly',
    urgency: 'normal',
    shouldEscalate: false,
    shouldPushBooking: false,
  };

  const prompt = buildStrategyGuardPrompt(testStrategy, 'discover', {
    emotion: 'calm',
    resistance: 'none',
    readiness: 1,
    trust: 3,
    style: 'supportive',
    engagementScore: 60,
    riskScore: 20,
    urgencyLevel: 15,
    conversationTurn: 2,
    topicHistory: [],
    previousPurchases: 0,
    lastPurchaseDate: null,
  });

  if (!prompt.includes('discover')) {
    failures.push('Prompt should include stage name');
  }
  if (!prompt.includes('必須做到')) {
    failures.push('Prompt should include must-do section');
  }
  if (!prompt.includes('絕對禁止')) {
    failures.push('Prompt should include forbidden section');
  }
  if (!prompt.includes('friendly')) {
    failures.push('Prompt should include tone');
  }

  // Test 2: Validate response against strategy
  const validResponse = '明白，你想了解邊個服務？我可以幫你介紹。';
  const result = validateResponseAgainstStrategy(validResponse, testStrategy);

  if (result.containsForbidden.length > 0) {
    failures.push(`Valid response should not contain forbidden: ${result.containsForbidden.join(', ')}`);
  }

  // Test 3: Response with upsell should fail
  const upsellResponse = '明白，你想了解邊個服務？我可以幫你介紹，同時加購優惠套餐。';
  const upsellResult = validateResponseAgainstStrategy(upsellResponse, testStrategy);

  if (!upsellResult.containsForbidden.includes('upsell')) {
    failures.push('Response with upsell should be flagged');
  }

  // Test 4: Stage guidance should exist for all stages
  const stages: ConversationStage[] = [
    'greeting', 'discover', 'clarify', 'answer', 'recommend',
    'objection', 'price_discuss', 'negotiate', 'booking_init', 'booking_slots',
    'confirm', 'post_booking', 'complaint', 'repair', 'escalation',
    'follow_up', 'upsell', 'close', 'unknown',
  ];

  for (const stage of stages) {
    const guidance = getStageGuidance(stage);
    if (!guidance || guidance.length < 10) {
      failures.push(`Stage ${stage} should have guidance`);
    }
  }

  return { ok: failures.length === 0, failures };
}