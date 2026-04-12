import type { ChannelType } from '@ats/shared';

// ── Booking Draft (slot-filling state) ──

export interface BookingDraft {
  bookingId?: string | null;
  serviceName: string | null;
  serviceDisplayName: string | null;
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
}

// ── Service Matching ──

export interface ServiceEntry {
  code: string;
  displayName: string;
  aliases: string[];
  priceInfo: string | null;
  fullInfo: string;
  // Structured fields (Phase 1.5C)
  effect?: string | null;      // 功效
  suitable?: string | null;    // 適合對象
  unsuitable?: string | null;  // 不適合對象
  precaution?: string | null;  // 注意事項
  duration?: string | null;    // 時長
  // Pricing fields (Phase 1.5D)
  price?: string | null;         // 價錢
  discountPrice?: string | null;  // 優惠價
  // Steps field (Phase 1.5D)
  steps?: string[] | null;       // 步驟
  // FAQ items (Phase 1.5D)
  faqItems?: Array<{ question: string; answer: string }> | null;
}

export interface ServiceMatchResult {
  type: 'exact' | 'close' | 'ambiguous' | 'none';
  matches: { service: ServiceEntry; confidence: number }[];
}

// ── Input ──

export interface AiEngineInput {
  tenant: {
    id: string;
    plan: string;
    settings: Record<string, unknown>;
  };
  contact: {
    id: string;
    name?: string;
    tags: string[];
  };
  conversation: {
    id: string;
    channel: ChannelType;
    messageCount: number;
  };
  messages: AiMessageContext[];
  currentMessage: string;
  knowledge: KnowledgeChunk[];
  bookingDraft?: BookingDraft;
  existingBookings?: Array<{
    id: string;
    serviceName: string;
    startTime: Date;
    endTime: Date | null;
    status: string;
  }>;
  /** Prior conversation state passed in from chat.service.ts */
  signals?: {
    conversationMode?: string;
    confirmationPending?: boolean;
    [key: string]: unknown;
  };
  /** Resolved booking to modify/cancel (e.g. from draft or UI selection); falls back to bookingDraft.bookingId in engine */
  activeBookingId?: string | null;
}

export interface AiMessageContext {
  sender: 'CUSTOMER' | 'AI' | 'HUMAN';
  content: string;
  createdAt: string;
}

export interface KnowledgeChunk {
  documentId: string;
  title: string;
  content: string;
  score: number;
  // Service aliases for matching
  aliases?: string[];
  // Structured fields (Phase 1.5C)
  effect?: string | null;
  suitable?: string | null;
  unsuitable?: string | null;
  precaution?: string | null;
  duration?: string | null;
  // Pricing fields (Phase 1.5D)
  price?: string | null;
  discountPrice?: string | null;
  // Steps field (Phase 1.5D)
  steps?: string[] | null;
  // FAQ items (Phase 1.5D)
  faqItems?: Array<{ question: string; answer: string }> | null;
}

// ── Output ──

export interface AiEngineResult {
  replyText: string;
  signals: DetectedSignals;
  sideEffects: SideEffect[];
  shouldHandoff: boolean;
  analytics: AiRunAnalytics;
  aiTurnTrace?: AiTurnTrace;
  /** Debug field for demo verification. */
  enginePath?: 'thin-core-v1' | 'llm-first' | 'legacy-fallback' | 'legacy';
  /** When enginePath is legacy-fallback, why we fell back. */
  fallbackReason?: string;
}

export interface DetectedSignals {
  intents: AiIntent[];
  extractedFields: Record<string, string>;
  action: AiAction;
  bookingDraft?: BookingDraft;
  /** Persisted across turns for mode-driven conversation engine */
  conversationMode?: string;
  confirmationPending?: boolean;
  // Decision Engine v1: Customer signals and strategy
  conversationStage?: string;
  customerEmotion?: string;
  customerResistance?: string;
  customerReadiness?: number;
  customerTrust?: number;
  customerStyle?: string;
  strategy?: string;
  strategyMustDo?: string[];
  strategyForbidden?: string[];
}

export type AiIntent =
  | 'GREETING'
  | 'FAQ'
  | 'BOOKING_REQUEST'
  | 'BOOKING_CHANGE'
  | 'BOOKING_CANCEL'
  | 'PRICE_INQUIRY'
  | 'PRODUCT_INQUIRY'
  | 'AVAILABILITY_CHECK'
  | 'CONTACT_INFO'
  | 'OTHER';

export type AiAction =
  | 'REPLY_ONLY'
  | 'ASK_INFO'
  | 'ASK_TIME_SLOT'
  /** Slots complete; user text is pending submission. Side effect may still emit CREATE_BOOKING for downstream to verify & persist. */
  | 'REQUEST_BOOKING'
  | 'MODIFY_BOOKING'
  | 'CANCEL_BOOKING'
  /**
   * @deprecated Engine should use REQUEST_BOOKING when emitting booking payloads. Kept for backward compatibility
   * (e.g. older persisted signals or tests) and collectSideEffects still accepts it.
   */
  | 'CREATE_BOOKING'
  | 'UPDATE_CONTACT';

/**
 * Subset of booking fields for MODIFY_BOOKING (ISO strings for datetimes; maps to Prisma `Booking` update).
 */
export type SideEffectBookingChanges = {
  serviceName?: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

export type SideEffect =
  | { type: 'CREATE_BOOKING'; data: { serviceName: string; startTime: string; endTime?: string; notes?: string } }
  | { type: 'MODIFY_BOOKING'; bookingId: string; changes: SideEffectBookingChanges }
  | { type: 'CANCEL_BOOKING'; bookingId: string }
  | { type: 'UPDATE_CONTACT'; data: { name?: string; phone?: string; email?: string } };

export interface AiRunAnalytics {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

// ── LLM-first prototype (feature-flagged) ──

export type UserPhase =
  | 'exploring'
  | 'interested'
  | 'booking'
  | 'handoff'
  | 'post_booking';

export interface ConversationState {
  sessionId: string;
  serviceFocus: string | null;
  userPhase: UserPhase;
  turnCount: number;
  recentHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    ts: number;
  }>;
  updatedAt: number;
}

export interface KBFactBundle {
  serviceFocus: ServiceEntry | null;
  serviceWhitelist: string[];
  serviceAliasLookup: Record<string, string>;
  exactPrice: string | null;
  salonInfo: {
    address: string | null;
    hours: string | null;
    location: string | null;
  };
  faqMatches: Array<{
    id: string;
    question: string;
    answer: string;
    confidence: number;
  }>;
  noData: boolean;
  summary: string;
}

export interface LLMBrainOutput {
  thinking: string;
  decisions: {
    userIntent: string[];
    resolvedService: string | null;
    resolvedServiceConfidence: number;
    nextMove: 'answer' | 'ask_clarify' | 'ask_booking_info' | 'handoff' | 'post_booking';
    detectedSlots: Partial<{
      serviceName: string;
      date: string;
      time: string;
      customerName: string;
      phone: string;
    }>;
    phaseTransition: UserPhase | null;
  };
  reply: string;
}

export interface AiTurnTrace {
  sessionId: string;
  turnNumber: number;
  userMessage: string;
  serviceFocusBefore: string | null;
  serviceFocusAfter: string | null;
  phaseBefore: UserPhase;
  phaseAfter: UserPhase;
  retrievedServiceId: string | null;
  faqIds: string[];
  llmDecisions: LLMBrainOutput['decisions'] | null;
  guardrailIssues: string[];
  finalReply: string;
  latencyMs: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
  };
}