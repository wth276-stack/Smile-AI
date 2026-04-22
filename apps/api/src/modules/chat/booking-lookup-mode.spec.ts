import { resolveModifyFlowBookingLookup } from './booking-lookup-mode';

describe('resolveModifyFlowBookingLookup', () => {
  const longPhone = '91234567';

  it('test session active + same phone digits → test-session-contact-only and null phone (no cross-contact leak)', () => {
    const r = resolveModifyFlowBookingLookup({
      whatsappTestSessionActive: true,
      phoneForLookup: longPhone,
    });
    expect(r.lookupMode).toBe('test-session-contact-only');
    expect(r.lookupPhone).toBeNull();
  });

  it('non-test WhatsApp path + long phone → phone-cross-contact for shared-phone lookup', () => {
    const r = resolveModifyFlowBookingLookup({
      whatsappTestSessionActive: false,
      phoneForLookup: longPhone,
    });
    expect(r.lookupMode).toBe('phone-cross-contact');
    expect(r.lookupPhone).toBe(longPhone);
  });

  it('short phone → contact-only regardless of test session', () => {
    expect(
      resolveModifyFlowBookingLookup({
        whatsappTestSessionActive: true,
        phoneForLookup: '123',
      }),
    ).toEqual({ lookupPhone: null, lookupMode: 'contact-only' });
    expect(
      resolveModifyFlowBookingLookup({
        whatsappTestSessionActive: false,
        phoneForLookup: '1234567',
      }),
    ).toEqual({ lookupPhone: null, lookupMode: 'contact-only' });
  });
});
