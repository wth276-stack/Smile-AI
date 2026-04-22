/**
 * How upcoming bookings are resolved when modify/cancel lookup runs (shouldLookupExisting).
 * - phone-cross-contact: match by conversation contact OR same phone last-8 on other contacts.
 * - test-session-contact-only: WhatsApp #test:block* — same wa_id must not see other sessions' bookings.
 * - contact-only: no phone cross-match (short digits or forced contact scope).
 */
export type ModifyFlowBookingLookupMode =
  | 'phone-cross-contact'
  | 'test-session-contact-only'
  | 'contact-only';

export function resolveModifyFlowBookingLookup(input: {
  whatsappTestSessionActive: boolean;
  phoneForLookup: string;
}): { lookupPhone: string | null; lookupMode: ModifyFlowBookingLookupMode } {
  const trimmed = input.phoneForLookup.trim();
  const digitsOk = trimmed.length >= 8;
  const usePhoneAcrossContacts = !input.whatsappTestSessionActive && digitsOk;

  if (usePhoneAcrossContacts) {
    return { lookupPhone: trimmed, lookupMode: 'phone-cross-contact' };
  }
  if (input.whatsappTestSessionActive && digitsOk) {
    return { lookupPhone: null, lookupMode: 'test-session-contact-only' };
  }
  return { lookupPhone: digitsOk ? trimmed : null, lookupMode: 'contact-only' };
}
