import { createHash } from 'crypto';

/**
 * Deterministic key for the same logical AI booking request (tenant + contact + service + instant).
 * Collisions across different bookings are cryptographically negligible; same inputs always yield same key.
 */
export function computeBookingIdempotencyKey(
  tenantId: string,
  contactId: string,
  serviceName: string,
  startTimeMs: number,
): string {
  const normalizedService = serviceName.trim();
  const payload = `${tenantId}\0${contactId}\0${normalizedService}\0${startTimeMs}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Pure regression: node -e "const { verifyBookingIdempotencyRegression } = require('./dist/modules/bookings/booking-idempotency.util.js'); ..." */
export function verifyBookingIdempotencyRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  const t = 1_700_000_000_000;
  const a = computeBookingIdempotencyKey('tenant-a', 'contact-b', 'Eye Treatment', t);
  const b = computeBookingIdempotencyKey('tenant-a', 'contact-b', 'Eye Treatment', t);
  if (a !== b) failures.push('same inputs should yield same key');
  const c = computeBookingIdempotencyKey('tenant-a', 'contact-b', 'Eye Treatment', t + 1);
  if (a === c) failures.push('different startTime should yield different key');
  const trimA = computeBookingIdempotencyKey('t', 'c', ' Eye ', t);
  const trimB = computeBookingIdempotencyKey('t', 'c', 'Eye', t);
  if (trimA !== trimB) failures.push('service name should be trimmed for key stability');
  return { ok: failures.length === 0, failures };
}
