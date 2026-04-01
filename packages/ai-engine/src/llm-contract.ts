/**
 * LLM planner JSON (v1). Used for structured understanding only.
 * Booking user-facing copy is NOT taken from replyText when intent is booking-related.
 */
export type LlmPlannerIntent =
  | 'GREETING'
  | 'INQUIRY'
  | 'PRICE'
  | 'DETAIL'
  | 'BOOKING'
  | 'BOOKING_SLOT_FILL'
  | 'CONTACT_INFO'
  | 'OTHER';

export type LlmNextSlot = 'serviceName' | 'date' | 'time' | 'customerName' | 'phone' | null;

export interface LlmPlannerExtracted {
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
}

export interface LlmPlannerOutput {
  schemaVersion: number;
  intent: LlmPlannerIntent;
  /** Used for inquiry / price / detail / greeting / other — ignored for booking + slot-fill intents in v1. */
  replyText: string;
  serviceMention: string | null;
  extracted: LlmPlannerExtracted;
  usesDraftContext: boolean;
  switchedAwayFromDraftService: boolean;
  needsClarification: boolean;
  clarificationReason: string | null;
  nextExpectedSlot: LlmNextSlot;
}

/** Embedded in system prompt so the model returns this shape. */
export const LLM_PLANNER_JSON_INSTRUCTION = `
Return a single JSON object only (no markdown), with this shape:
{
  "schemaVersion": 1,
  "intent": "GREETING" | "INQUIRY" | "PRICE" | "DETAIL" | "BOOKING" | "BOOKING_SLOT_FILL" | "CONTACT_INFO" | "OTHER",
  "replyText": "string — for GREETING, INQUIRY, PRICE, DETAIL, OTHER, CONTACT_INFO only: natural Cantonese/Traditional Chinese, concise, no fake availability or confirmed booking claims. For BOOKING or BOOKING_SLOT_FILL set to empty string \\"\\".",
  "serviceMention": "string or null — service name as user said it, if any",
  "extracted": {
    "date": "YYYY-MM-DD or null",
    "time": "HH:mm 24h or null",
    "customerName": "string or null",
    "phone": "digits string or null"
  },
  "usesDraftContext": boolean,
  "switchedAwayFromDraftService": boolean,
  "needsClarification": boolean,
  "clarificationReason": "string or null",
  "nextExpectedSlot": "serviceName" | "date" | "time" | "customerName" | "phone" | null
}

Rules:
- BOOKING: user wants to start or continue a booking (e.g. 想預約, book).
- BOOKING_SLOT_FILL: short reply filling date/time/name/phone in an ongoing booking.
- PRICE / DETAIL / INQUIRY: user asks price, effect, or general info.
- If user changes topic to another service while a draft exists, set switchedAwayFromDraftService true and set serviceMention to the new service.
- Never claim the shop already confirmed a booking; never invent prices not in context.
`.trim();
