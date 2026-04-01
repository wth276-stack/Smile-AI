/**
 * response-components.ts
 *
 * Defines Response Components - the building blocks for responses.
 * These are not complete responses, but parts that can be assembled
 * based on strategy, tone, and customer style.
 *
 * Key principle: "Components are assembled by strategy, naturalized by LLM"
 */

import type { ConversationStrategy, ResponseTone } from './strategy-selector';

// ── Component Types ───────────────────────────────────────────────────────────

/**
 * Category of response component.
 */
export type ComponentCategory =
  | 'empathy_opener'      // Acknowledgment phrases
  | 'clarify_question'    // Questions to clarify
  | 'provide_info'        // Information delivery
  | 'recommend_frame'     // Service recommendations
  | 'objection_handle'    // Objection responses
  | 'value_frame'         // Value propositions
  | 'booking_prompt'      // Booking calls-to-action
  | 'confirmation'        // Confirmation requests
  | 'escalation_line'     // Human handoff
  | 'follow_up'           // Follow-up messages
  | 'close'               // Closing phrases
  | 'small_talk';        // Conversational fillers

/**
 * A single response component.
 */
export interface ResponseComponent {
  id: string;
  category: ComponentCategory;
  content: string;
  tone: ResponseTone[];
  mustDoType: string;      // Which mustDo this satisfies
  alternatives?: string[];  // Alternative phrasings
}

// ── Component Library ────────────────────────────────────────────────────────

/**
 * Response components organized by category.
 * Each component has:
 * - id: unique identifier
 * - content: the actual text
 * - tone: which tones it's suitable for
 * - mustDoType: which mustDo action it satisfies
 */
export const RESPONSE_COMPONENTS: ResponseComponent[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // EMPATHY OPENERS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'empathy_acknowledge',
    category: 'empathy_opener',
    content: '明白，{concern} 係一個重要嘅考慮。',
    tone: ['friendly', 'empathetic', 'professional'],
    mustDoType: 'acknowledge',
  },
  {
    id: 'empathy_understand',
    category: 'empathy_opener',
    content: '理解你嘅擔心，{concern} 係好正常嘅。',
    tone: ['empathetic', 'friendly'],
    mustDoType: 'acknowledge',
  },
  {
    id: 'empathy_hear',
    category: 'empathy_opener',
    content: '收到，我聽到你講 {concern}。',
    tone: ['friendly', 'professional'],
    mustDoType: 'acknowledge',
  },
  {
    id: 'empathy_issue',
    category: 'empathy_opener',
    content: '抱歉令你有唔愉快嘅經驗，我會跟進 {issue}。',
    tone: ['empathetic', 'professional'],
    mustDoType: 'acknowledge_emotion',
  },
  {
    id: 'empathy_price',
    category: 'empathy_opener',
    content: '明白，價錢係好多人會考慮嘅因素。',
    tone: ['empathetic', 'professional'],
    mustDoType: 'acknowledge_price_concern',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLARIFY QUESTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'clarify_need',
    category: 'clarify_question',
    content: '想了解下，你主要想改善邊方面？',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_clarifying_questions',
    alternatives: ['你主要想達到咩效果？', '有咩特別想解決嘅問題？'],
  },
  {
    id: 'clarify_service',
    category: 'clarify_question',
    content: '你想了解邊個服務？',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_clarifying_questions',
  },
  {
    id: 'clarify_timing',
    category: 'clarify_question',
    content: '你大概想幾時做？',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_clarifying_questions',
  },
  {
    id: 'clarify_budget',
    category: 'clarify_question',
    content: '你預算大概係幾多？',
    tone: ['professional', 'friendly'],
    mustDoType: 'clarify_budget_concern',
  },
  {
    id: 'clarify_issue',
    category: 'clarify_question',
    content: '可以講多啲發生咩事嗎？',
    tone: ['empathetic', 'friendly'],
    mustDoType: 'clarify_issue',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVIDE INFO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'info_service',
    category: 'provide_info',
    content: '{service} 可以幫你 {benefit}。',
    tone: ['professional', 'friendly'],
    mustDoType: 'give_answer',
  },
  {
    id: 'info_price',
    category: 'provide_info',
    content: '{service} 價錢係 {price}。',
    tone: ['professional', 'direct'],
    mustDoType: 'give_answer',
  },
  {
    id: 'info_duration',
    category: 'provide_info',
    content: '{service} 大概需要 {duration}。',
    tone: ['professional', 'friendly'],
    mustDoType: 'give_answer',
  },
  {
    id: 'info_comparison',
    category: 'provide_info',
    content: '{service1} 同 {service2} 主要分別係 {difference}。',
    tone: ['professional', 'analytical'],
    mustDoType: 'provide_comparison',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // RECOMMEND FRAME
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'recommend_based_on',
    category: 'recommend_frame',
    content: '根據你講嘅，我會推薦 {service}，因為 {reason}。',
    tone: ['professional', 'friendly'],
    mustDoType: 'present_service',
  },
  {
    id: 'recommend_option',
    category: 'recommend_frame',
    content: '{service} 會適合你，主要因為 {reason}。',
    tone: ['friendly', 'professional'],
    mustDoType: 'present_service',
  },
  {
    id: 'recommend_personalized',
    category: 'recommend_frame',
    content: '針對 {concern}，{service} 係比較合適嘅選擇。',
    tone: ['professional', 'empathetic'],
    mustDoType: 'present_service',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OBJECTION HANDLE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'objection_value',
    category: 'objection_handle',
    content: '{service} 雖然價錢稍高，但 {value_reason}。',
    tone: ['professional', 'empathetic'],
    mustDoType: 'clarify_value',
  },
  {
    id: 'objection_alternative',
    category: 'objection_handle',
    content: '如果預算係考慮，{alternative} 都係一個好選擇。',
    tone: ['friendly', 'professional'],
    mustDoType: 'offer_alternatives',
  },
  {
    id: 'objection_trust',
    category: 'objection_handle',
    content: '我哋做咗 {years} 年，服務過好多客人，{proof}。',
    tone: ['professional', 'friendly'],
    mustDoType: 'provide_proof',
  },
  {
    id: 'objection_timing',
    category: 'objection_handle',
    content: '唔緊要，你可以慢慢考慮。有需要隨時聯絡我哋。',
    tone: ['friendly', 'empathetic'],
    mustDoType: 'offer_flexibility',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VALUE FRAME
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'value_duration',
    category: 'value_frame',
    content: '{service} 效果可以維持 {duration}，比起頻密做其他療程更划算。',
    tone: ['professional', 'analytical'],
    mustDoType: 'quantify_benefit',
  },
  {
    id: 'value_result',
    category: 'value_frame',
    content: '一般客人做 {service} 後，{result}。',
    tone: ['professional', 'friendly'],
    mustDoType: 'quantify_benefit',
  },
  {
    id: 'value_investment',
    category: 'value_frame',
    content: '平均每次只需 {per_session}，效果持久。',
    tone: ['professional', 'analytical'],
    mustDoType: 'clarify_value',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING PROMPT
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'booking_ask_date',
    category: 'booking_prompt',
    content: '你想約邊一日？',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_missing_slot',
  },
  {
    id: 'booking_ask_time',
    category: 'booking_prompt',
    content: '方便講下想約幾點？',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_missing_slot',
  },
  {
    id: 'booking_ask_contact',
    category: 'booking_prompt',
    content: '可以留個聯絡電話嗎？方便同事確認。',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_missing_slot',
  },
  {
    id: 'booking_soft_prompt',
    category: 'booking_prompt',
    content: '有興趣嘅話，可以約個時間了解多啲。',
    tone: ['friendly', 'professional'],
    mustDoType: 'offer_consultation',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRMATION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'confirm_summary',
    category: 'confirmation',
    content: '幫你整理好預約資料：\n{summary}\n\n如資料正確，請回覆「確認預約」。',
    tone: ['professional', 'friendly'],
    mustDoType: 'summarize_booking',
  },
  {
    id: 'confirm_ask',
    category: 'confirmation',
    content: '咁樣安排可以嗎？',
    tone: ['friendly', 'professional'],
    mustDoType: 'ask_explicit_confirmation',
  },
  {
    id: 'confirm_reassure',
    category: 'confirmation',
    content: '同事確認後會跟你聯絡，到時見！',
    tone: ['friendly', 'professional'],
    mustDoType: 'provide_next_steps',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ESCALATION LINE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'escalate_handoff',
    category: 'escalation_line',
    content: '明白，我幫你轉交同事跟進。請稍等，同事會盡快聯絡你 🙏',
    tone: ['professional', 'empathetic'],
    mustDoType: 'handoff_to_human',
  },
  {
    id: 'escalate_contact',
    category: 'escalation_line',
    content: '你可以直接聯絡我哋客服：{contact}。',
    tone: ['professional', 'friendly'],
    mustDoType: 'provide_contact',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FOLLOW UP
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'follow_up_check',
    category: 'follow_up',
    content: '之前 {service} 做完感覺點樣？',
    tone: ['friendly', 'casual'],
    mustDoType: 'check_satisfaction',
  },
  {
    id: 'follow_up_remind',
    category: 'follow_up',
    content: '提醒返，下次 {service} 建議 {timing} 做。',
    tone: ['friendly', 'professional'],
    mustDoType: 'provide_reminder',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOSE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'close_natural',
    category: 'close',
    content: '仲有咩想了解？隨時問我 😊',
    tone: ['friendly', 'casual'],
    mustDoType: 'offer_help',
  },
  {
    id: 'close_booking',
    category: 'close',
    content: '預約完成，到時見！',
    tone: ['friendly', 'professional'],
    mustDoType: 'confirm_booking',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SMALL TALK
  // ═══════════════════════════════════════════════════════════════════════════
  {
    id: 'smalltalk_greeting',
    category: 'small_talk',
    content: '你好！',
    tone: ['friendly', 'casual'],
    mustDoType: 'acknowledge_customer',
  },
  {
    id: 'smalltalk_thanks',
    category: 'small_talk',
    content: '唔使客氣～',
    tone: ['friendly', 'casual'],
    mustDoType: 'acknowledge',
  },
];

// ── Component Selection ──────────────────────────────────────────────────────

/**
 * Selects components that satisfy the given mustDo requirements.
 */
export function selectComponentsForMustDo(
  mustDo: string[],
  tone: ResponseTone,
  limitPerMustDo: number = 2,
): Map<string, ResponseComponent[]> {
  const result = new Map<string, ResponseComponent[]>();

  for (const action of mustDo) {
    const matching = RESPONSE_COMPONENTS.filter(
      (c) => c.mustDoType === action && c.tone.includes(tone)
    );

    if (matching.length > 0) {
      result.set(action, matching.slice(0, limitPerMustDo));
    }
  }

  return result;
}

/**
 * Gets a random alternative phrasing for variety.
 */
export function getAlternativePhrasing(component: ResponseComponent): string {
  if (!component.alternatives || component.alternatives.length === 0) {
    return component.content;
  }

  const allOptions = [component.content, ...component.alternatives];
  return allOptions[Math.floor(Math.random() * allOptions.length)];
}

/**
 * Gets all components of a given category.
 */
export function getComponentsByCategory(category: ComponentCategory): ResponseComponent[] {
  return RESPONSE_COMPONENTS.filter((c) => c.category === category);
}

/**
 * Gets all components suitable for a given tone.
 */
export function getComponentsByTone(tone: ResponseTone): ResponseComponent[] {
  return RESPONSE_COMPONENTS.filter((c) => c.tone.includes(tone));
}

// ── Template Filling ──────────────────────────────────────────────────────────

/**
 * Fills placeholders in a component template with actual values.
 */
export function fillComponentTemplate(
  template: string,
  values: Record<string, string>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    const placeholder = `{${key}}`;
    result = result.replace(new RegExp(placeholder, 'g'), value);
  }

  return result;
}

// ── Response Assembly Helper ───────────────────────────────────────────────────

/**
 * Assembles a response from multiple components.
 */
export function assembleResponse(
  components: ResponseComponent[],
  values: Record<string, string>,
  separator: string = '\n',
): string {
  const filled = components.map((c) => fillComponentTemplate(c.content, values));
  return filled.join(separator);
}

// ── Regression Tests ───────────────────────────────────────────────────────────

export function verifyResponseComponentsRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Must have empathy openers
  const empathyComponents = getComponentsByCategory('empathy_opener');
  if (empathyComponents.length < 3) {
    failures.push(`Should have at least 3 empathy_openers, got ${empathyComponents.length}`);
  }

  // Test 2: Must have booking prompts
  const bookingComponents = getComponentsByCategory('booking_prompt');
  if (bookingComponents.length < 2) {
    failures.push(`Should have at least 2 booking_prompts, got ${bookingComponents.length}`);
  }

  // Test 3: Must have escalation lines
  const escalationComponents = getComponentsByCategory('escalation_line');
  if (escalationComponents.length < 1) {
    failures.push(`Should have at least 1 escalation_line`);
  }

  // Test 4: Component selection by mustDo
  const mustDoComponents = selectComponentsForMustDo(
    ['acknowledge', 'give_answer'],
    'professional',
    2,
  );
  if (!mustDoComponents.has('acknowledge')) {
    failures.push(`Should find components for 'acknowledge' mustDo`);
  }
  if (!mustDoComponents.has('give_answer')) {
    failures.push(`Should find components for 'give_answer' mustDo`);
  }

  // Test 5: Template filling
  const filled = fillComponentTemplate(
    '{service} 可以幫你 {benefit}。',
    { service: 'HIFU', benefit: '緊緻輪廓' },
  );
  if (filled !== 'HIFU 可以幫你 緊緻輪廓。') {
    failures.push(`Template filling failed, got: ${filled}`);
  }

  return { ok: failures.length === 0, failures };
}