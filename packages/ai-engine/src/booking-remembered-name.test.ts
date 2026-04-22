import { describe, expect, it } from 'vitest';
import { provisionalCustomerNameFromExistingBookings } from './booking-state';

describe('provisionalCustomerNameFromExistingBookings (live-path edge cases)', () => {
  it('falls back to single-row name when bookingId is stale (not in existing list)', () => {
    const n = provisionalCustomerNameFromExistingBookings(
      { bookingId: 'stale-id', customerName: null },
      [{ id: 'real-id', customerName: 'Kept' }],
    );
    expect(n).toBe('Kept');
  });

  it('prefers id match when present', () => {
    const n = provisionalCustomerNameFromExistingBookings(
      { bookingId: 'a', customerName: null },
      [
        { id: 'a', customerName: 'First' },
        { id: 'b', customerName: 'Second' },
      ],
    );
    expect(n).toBe('First');
  });
});
