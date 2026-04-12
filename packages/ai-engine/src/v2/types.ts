export type {
  BookingDraft,
  AiEngineInput,
  AiEngineResult,
  KnowledgeChunk,
  ServiceEntry,
  AiIntent,
  AiAction,
  SideEffect,
  SideEffectBookingChanges,
} from '../types';

import type { BookingDraft, KnowledgeChunk, AiIntent, AiAction } from '../types';

// ── LLM structured output (single-call response) ──

export interface LLMOutput {
  thinking: string;
  reply: string;
  intent: AiIntent;
  action: AiAction;
  newSlots: Partial<BookingDraft>;
}

// ── Post-validation result ──

export interface ValidatedOutput {
  reply: string;
  intent: AiIntent;
  action: AiAction;
  newSlots: Partial<BookingDraft>;
  validatedReply: string;
  mergedDraft: BookingDraft;
  validationIssues: string[];
}

// ── Data assembled for prompt builder ──

export interface TenantProfile {
  businessName?: string;
  businessType?: string;
  assistantRole?: string;
  language?: string;
}

export interface PromptContext {
  tenantProfile?: TenantProfile;
  knowledgeChunks: KnowledgeChunk[];
  conversationHistory: Array<{ role: 'customer' | 'assistant'; content: string }>;
  currentMessage: string;
  currentDraft: BookingDraft;
  contactName: string | null;
  tenantSettings: Record<string, unknown>;
  existingBookings?: Array<{
    id: string;
    serviceName: string;
    startTime: Date;
    endTime: Date | null;
    status: string;
  }>;
  /** Booking id for MODIFY/CANCEL side effects (from input.activeBookingId or draft.bookingId). */
  activeBookingId?: string | null;
}
