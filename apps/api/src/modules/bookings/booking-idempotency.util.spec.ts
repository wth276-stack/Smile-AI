import { verifyBookingIdempotencyRegression, computeBookingIdempotencyKey } from './booking-idempotency.util';

describe('booking idempotency', () => {
  it('verifyBookingIdempotencyRegression passes', () => {
    const r = verifyBookingIdempotencyRegression();
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('duplicate logical keys collide (same row key)', () => {
    const k = computeBookingIdempotencyKey('t', 'c', 'Svc', 1_700_000_000_000);
    expect(computeBookingIdempotencyKey('t', 'c', 'Svc', 1_700_000_000_000)).toBe(k);
  });
});
