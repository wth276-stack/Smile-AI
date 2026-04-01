/**
 * conversation-stage.ts
 *
 * Defines ConversationStage - the high-level phases of a customer conversation.
 * This extends the existing ConversationMode with sales/CS-specific stages.
 *
 * Key principle: "Rule decides, KB supplies, LLM phrases"
 * - Stages are decision points, not just states
 * - Each stage has clear entry/exit conditions
 * - Stages guide strategy selection
 */

// ── Base Conversation Mode (from existing system) ──────────────────────────────

export type BaseConversationMode =
  | 'GREETING'
  | 'INQUIRY'
  | 'RECOMMENDATION'
  | 'BOOKING_DRAFT'
  | 'CONFIRMATION_PENDING'
  | 'POST_BOOKING'
  | 'HANDOFF';

// ── Conversation Stage (extends mode with sales/CS stages) ────────────────────

/**
 * ConversationStage represents the high-level phase of customer interaction.
 * Unlike ConversationMode (which is about dialog state), Stage is about
 * what the customer is trying to accomplish and what we should do next.
 *
 * Stages flow in a typical sequence, but can branch based on customer behavior.
 */
export type ConversationStage =
  // Initial contact
  | 'greeting'           // First contact, establishing rapport
  // Discovery
  | 'discover'           // Understanding customer needs
  | 'clarify'            // Clarifying ambiguous requests
  // Information
  | 'answer'             // Providing information/FAQ
  | 'recommend'          // Recommending services/products
  // Sales progression
  | 'objection'          // Handling resistance/objections
  | 'price_discuss'      // Discussing pricing
  | 'negotiate'          // Active negotiation
  // Booking flow
  | 'booking_init'       // Starting booking process
  | 'booking_slots'      // Collecting booking details
  | 'confirm'            // Confirming booking
  | 'post_booking'       // After booking confirmed
  // Service issues
  | 'complaint'          // Customer has complaint
  | 'repair'             // Attempting to repair relationship
  | 'escalation'         // Handing off to human
  // Follow-up
  | 'follow_up'          // Checking in after service
  | 'upsell'             // Attempting to upsell/add-on
  | 'close'              // Closing conversation naturally
  | 'unknown';           // Unclear stage

// ── Stage Transitions ──────────────────────────────────────────────────────────

/**
 * Defines valid stage transitions.
 * Not all transitions are allowed - this prevents illogical jumps.
 */
export const VALID_STAGE_TRANSITIONS: Record<ConversationStage, ConversationStage[]> = {
  greeting: ['discover', 'answer', 'booking_init', 'unknown'],
  discover: ['clarify', 'answer', 'recommend', 'booking_init', 'objection', 'unknown'],
  clarify: ['discover', 'answer', 'recommend', 'unknown'],
  answer: ['discover', 'recommend', 'booking_init', 'objection', 'follow_up', 'close', 'unknown'],
  recommend: ['objection', 'price_discuss', 'booking_init', 'discover', 'unknown'],
  objection: ['recommend', 'price_discuss', 'negotiate', 'booking_init', 'discover', 'escalation', 'unknown'],
  price_discuss: ['objection', 'recommend', 'booking_init', 'negotiate', 'discover', 'unknown'],
  negotiate: ['booking_init', 'objection', 'price_discuss', 'escalation', 'unknown'],
  booking_init: ['booking_slots', 'discover', 'objection', 'unknown'],
  booking_slots: ['confirm', 'booking_init', 'objection', 'unknown'],
  confirm: ['post_booking', 'booking_slots', 'escalation', 'unknown'],
  post_booking: ['upsell', 'follow_up', 'close', 'unknown'],
  complaint: ['repair', 'escalation', 'unknown'],
  repair: ['complaint', 'escalation', 'close', 'unknown'],
  escalation: ['close', 'unknown'],
  follow_up: ['upsell', 'close', 'booking_init', 'unknown'],
  upsell: ['booking_init', 'follow_up', 'close', 'objection', 'unknown'],
  close: ['greeting', 'unknown'],
  unknown: ['greeting', 'discover', 'answer', 'booking_init', 'complaint', 'unknown'],
};

// ── Stage Detection ───────────────────────────────────────────────────────────

/**
 * Context for detecting the current stage.
 */
export interface StageDetectionContext {
  currentMode: BaseConversationMode;
  currentStage: ConversationStage | null;
  message: string;
  intent: string;
  customerSignals: CustomerSignalsSummary;
  bookingDraft: {
    hasService: boolean;
    hasDate: boolean;
    hasTime: boolean;
    hasContact: boolean;
  };
  conversationHistory: Array<{
    stage: ConversationStage;
    intent: string;
    timestamp: number;
  }>;
}

/**
 * Summary of customer signals (simplified for stage detection).
 */
export interface CustomerSignalsSummary {
  emotion: 'calm' | 'confused' | 'anxious' | 'impatient' | 'angry' | 'distrustful';
  trustLevel: number;        // 0-5
  readinessLevel: number;    // 0-5
  resistanceType: 'none' | 'price' | 'trust' | 'timing' | 'need' | 'other';
}

/**
 * Result of stage detection.
 */
export interface StageDetectionResult {
  stage: ConversationStage;
  confidence: number;
  reason: string;
  suggestedActions: string[];
}

/**
 * Detects the current conversation stage based on context.
 * This is the core decision function that guides all subsequent behavior.
 */
export function detectStage(ctx: StageDetectionContext): StageDetectionResult {
  const { currentMode, currentStage, message, intent, customerSignals, bookingDraft } = ctx;

  // ── Mode-based inference (fast path) ────────────────────────────────────────

  // Greeting mode -> greeting stage
  if (currentMode === 'GREETING') {
    return {
      stage: 'greeting',
      confidence: 0.95,
      reason: 'Conversation just started',
      suggestedActions: ['establish_rapport', 'ask_need'],
    };
  }

  // Handoff mode -> escalation stage
  if (currentMode === 'HANDOFF') {
    return {
      stage: 'escalation',
      confidence: 0.95,
      reason: 'Human handoff requested',
      suggestedActions: ['acknowledge_handoff', 'provide_contact'],
    };
  }

  // Post booking mode -> post_booking stage
  if (currentMode === 'POST_BOOKING') {
    return {
      stage: 'post_booking',
      confidence: 0.95,
      reason: 'Booking confirmed',
      suggestedActions: ['confirm_details', 'offer_follow_up'],
    };
  }

  // ── Booking flow stages ──────────────────────────────────────────────────────

  if (currentMode === 'BOOKING_DRAFT') {
    // Determine which booking stage based on what's collected
    if (!bookingDraft.hasService) {
      return {
        stage: 'booking_init',
        confidence: 0.9,
        reason: 'Service not selected yet',
        suggestedActions: ['ask_service', 'clarify_need'],
      };
    }

    if (!bookingDraft.hasDate || !bookingDraft.hasTime) {
      return {
        stage: 'booking_slots',
        confidence: 0.9,
        reason: 'Collecting time slots',
        suggestedActions: ['ask_date', 'ask_time'],
      };
    }

    if (!bookingDraft.hasContact) {
      return {
        stage: 'booking_slots',
        confidence: 0.9,
        reason: 'Collecting contact info',
        suggestedActions: ['ask_name', 'ask_phone'],
      };
    }

    return {
      stage: 'booking_slots',
      confidence: 0.85,
      reason: 'Booking in progress',
      suggestedActions: ['confirm_details'],
    };
  }

  if (currentMode === 'CONFIRMATION_PENDING') {
    return {
      stage: 'confirm',
      confidence: 0.95,
      reason: 'Awaiting confirmation',
      suggestedActions: ['ask_confirmation', 'handle_change'],
    };
  }

  // ── Emotion-based stage detection ────────────────────────────────────────────

  const { emotion, resistanceType } = customerSignals;

  // Angry customer -> complaint stage
  if (emotion === 'angry') {
    return {
      stage: 'complaint',
      confidence: 0.9,
      reason: 'Customer is angry',
      suggestedActions: ['acknowledge_emotion', 'clarify_issue', 'offer_resolution'],
    };
  }

  // Distrustful customer with trust resistance -> objection
  if (emotion === 'distrustful' && resistanceType === 'trust') {
    return {
      stage: 'objection',
      confidence: 0.85,
      reason: 'Customer has trust concerns',
      suggestedActions: ['build_trust', 'provide_proof', 'avoid_push'],
    };
  }

  // ── Intent-based stage detection ─────────────────────────────────────────────

  // Price discussion
  if (intent === 'PRICE' || /幾錢|價錢|貴|平|優惠|折扣/.test(message)) {
    if (currentStage === 'recommend') {
      return {
        stage: 'price_discuss',
        confidence: 0.85,
        reason: 'Customer asking about price after recommendation',
        suggestedActions: ['present_value', 'offer_options'],
      };
    }
    return {
      stage: 'answer',
      confidence: 0.8,
      reason: 'Price inquiry',
      suggestedActions: ['provide_price', 'offer_context'],
    };
  }

  // Booking intent
  if (intent === 'BOOKING_REQUEST' || /預約|book|約|訂/.test(message)) {
    return {
      stage: 'booking_init',
      confidence: 0.9,
      reason: 'Customer wants to book',
      suggestedActions: ['start_booking', 'check_availability'],
    };
  }

  // Product inquiry
  if (intent === 'PRODUCT_INQUIRY' || intent === 'DETAIL_QUESTION') {
    if (currentStage === 'discover') {
      return {
        stage: 'discover',
        confidence: 0.8,
        reason: 'Still discovering needs',
        suggestedActions: ['clarify_need', 'ask_questions'],
      };
    }
    return {
      stage: 'answer',
      confidence: 0.85,
      reason: 'Product inquiry',
      suggestedActions: ['provide_info', 'check_understanding'],
    };
  }

  // ── Resistance detection ─────────────────────────────────────────────────────

  if (resistanceType !== 'none') {
    if (resistanceType === 'price') {
      return {
        stage: 'objection',
        confidence: 0.85,
        reason: 'Price resistance detected',
        suggestedActions: ['reframe_value', 'offer_alternatives', 'avoid_pressure'],
      };
    }
    if (resistanceType === 'timing') {
      return {
        stage: 'objection',
        confidence: 0.8,
        reason: 'Timing resistance detected',
        suggestedActions: ['acknowledge_timing', 'offer_flexibility'],
      };
    }
  }

  // ── Default: continue from current stage or discover ──────────────────────────

  if (currentStage && currentStage !== 'unknown') {
    return {
      stage: currentStage,
      confidence: 0.6,
      reason: 'Continuing from previous stage',
      suggestedActions: ['continue_flow'],
    };
  }

  return {
    stage: 'discover',
    confidence: 0.5,
    reason: 'Unknown context, defaulting to discovery',
    suggestedActions: ['ask_need', 'clarify_intent'],
  };
}

// ── Stage Utility Functions ────────────────────────────────────────────────────

/**
 * Check if a stage transition is valid.
 */
export function isValidStageTransition(from: ConversationStage, to: ConversationStage): boolean {
  const allowed = VALID_STAGE_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Get the default stage for a mode.
 */
export function getDefaultStageForMode(mode: BaseConversationMode): ConversationStage {
  const modeToStage: Partial<Record<BaseConversationMode, ConversationStage>> = {
    GREETING: 'greeting',
    INQUIRY: 'discover',
    RECOMMENDATION: 'recommend',
    BOOKING_DRAFT: 'booking_slots',
    CONFIRMATION_PENDING: 'confirm',
    POST_BOOKING: 'post_booking',
    HANDOFF: 'escalation',
  };
  return modeToStage[mode] || 'unknown';
}

// ── Regression Tests ────────────────────────────────────────────────────────────

export function verifyConversationStageRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  // Test 1: Mode to stage mapping
  if (getDefaultStageForMode('GREETING') !== 'greeting') {
    failures.push('GREETING mode should map to greeting stage');
  }
  if (getDefaultStageForMode('BOOKING_DRAFT') !== 'booking_slots') {
    failures.push('BOOKING_DRAFT mode should map to booking_slots stage');
  }

  // Test 2: Stage transitions
  if (!isValidStageTransition('greeting', 'discover')) {
    failures.push('greeting should transition to discover');
  }
  if (!isValidStageTransition('discover', 'recommend')) {
    failures.push('discover should transition to recommend');
  }
  if (!isValidStageTransition('complaint', 'escalation')) {
    failures.push('complaint should transition to escalation');
  }
  if (isValidStageTransition('escalation', 'discover')) {
    failures.push('escalation should NOT transition to discover');
  }

  // Test 3: Stage detection for price inquiry
  const priceContext: StageDetectionContext = {
    currentMode: 'INQUIRY',
    currentStage: null,
    message: 'HIFU 幾錢',
    intent: 'PRICE',
    customerSignals: {
      emotion: 'calm',
      trustLevel: 3,
      readinessLevel: 1,
      resistanceType: 'none',
    },
    bookingDraft: {
      hasService: false,
      hasDate: false,
      hasTime: false,
      hasContact: false,
    },
    conversationHistory: [],
  };
  const priceResult = detectStage(priceContext);
  if (priceResult.stage !== 'answer' && priceResult.stage !== 'price_discuss') {
    failures.push(`Price inquiry should be 'answer' or 'price_discuss', got '${priceResult.stage}'`);
  }

  // Test 4: Stage detection for booking
  const bookingContext: StageDetectionContext = {
    currentMode: 'BOOKING_DRAFT',
    currentStage: null,
    message: '我想約聽日',
    intent: 'BOOKING',
    customerSignals: {
      emotion: 'calm',
      trustLevel: 3,
      readinessLevel: 3,
      resistanceType: 'none',
    },
    bookingDraft: {
      hasService: true,
      hasDate: false,
      hasTime: false,
      hasContact: false,
    },
    conversationHistory: [],
  };
  const bookingResult = detectStage(bookingContext);
  if (bookingResult.stage !== 'booking_slots') {
    failures.push(`Booking in progress should be 'booking_slots', got '${bookingResult.stage}'`);
  }

  // Test 5: Stage detection for angry customer
  const angryContext: StageDetectionContext = {
    currentMode: 'INQUIRY',
    currentStage: null,
    message: '我要投訴',
    intent: 'OTHER',
    customerSignals: {
      emotion: 'angry',
      trustLevel: 1,
      readinessLevel: 1,
      resistanceType: 'none',
    },
    bookingDraft: {
      hasService: false,
      hasDate: false,
      hasTime: false,
      hasContact: false,
    },
    conversationHistory: [],
  };
  const angryResult = detectStage(angryContext);
  if (angryResult.stage !== 'complaint') {
    failures.push(`Angry customer should be 'complaint' stage, got '${angryResult.stage}'`);
  }

  return { ok: failures.length === 0, failures };
}