/**
 * Structured JSON from the single thin-core LLM call (LV1).
 */
export type ThinNextAction =
  | 'reply'
  | 'booking_collect'
  | 'booking_confirm'
  | 'booking_submit'
  | 'handoff';

export interface ThinBookingSlots {
  serviceName: string | null;
  serviceDisplayName: string | null;
  date: string | null;
  time: string | null;
  customerName: string | null;
  phone: string | null;
}

export interface ThinLlmOutput {
  intent: string;
  matchedEntityId: string | null;
  confidence: number;
  nextAction: ThinNextAction;
  bookingSlots: ThinBookingSlots;
  handoffRequired: boolean;
  reply: string;
}

export function emptyThinBookingSlots(): ThinBookingSlots {
  return {
    serviceName: null,
    serviceDisplayName: null,
    date: null,
    time: null,
    customerName: null,
    phone: null,
  };
}
