/**
 * business-rule-validator.ts
 *
 * P5 Lite: Basic business rule validation for booking requests.
 * Per ChatGPT safety advice: "如果 request 明顯超出規則，就唔好直接入 confirmation，
 * 改為「我先幫你記低，需由同事確認」"
 *
 * This validator checks:
 * - Business day (is it an operating day?)
 * - Business hours (is time within operating hours?)
 * - Minimum lead time (enough advance notice?)
 * - Same-day booking allowed?
 *
 * When validation fails, we DON'T reject outright — we flag for human confirmation.
 */

import type { BookingDraft } from './types';

// ── Business Hours Configuration (per-tenant) ─────────────────────────────────

export interface BusinessHoursConfig {
  /** Operating days: 0=Sun, 1=Mon, ..., 6=Sat. Empty = all days. */
  operatingDays: number[];
  /** Opening hour (24h format). E.g., 10 for 10:00. */
  openHour: number;
  /** Closing hour (24h format). E.g., 20 for 20:00. */
  closeHour: number;
  /** Minimum hours in advance for booking. Default: 2 hours. */
  minLeadHours: number;
  /** Allow same-day bookings. Default: true. */
  allowSameDay: boolean;
  /** Latest hour for same-day booking (if allowSameDay). E.g., 17 means no new same-day bookings after 17:00. */
  sameDayCutoffHour?: number;
}

/** Default business hours: Mon-Sat, 10:00-20:00, 2-hour lead time, same-day OK until 17:00. */
export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  operatingDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
  openHour: 10,
  closeHour: 20,
  minLeadHours: 2,
  allowSameDay: true,
  sameDayCutoffHour: 17,
};

// ── Validation Result ────────────────────────────────────────────────────────

export interface ValidationResult {
  /** Whether booking passes all basic rules. */
  valid: boolean;
  /** If not valid, why it needs human confirmation. */
  reason: string | null;
  /** Suggested alternative time (if applicable). */
  suggestion: string | null;
  /** Category of validation failure. */
  failureType: 'none' | 'non_operating_day' | 'outside_hours' | 'insufficient_lead_time' | 'same_day_restricted';
}

// ── Core Validation Functions ────────────────────────────────────────────────

/**
 * Check if a date is an operating day.
 */
function isOperatingDay(date: Date, config: BusinessHoursConfig): boolean {
  if (config.operatingDays.length === 0) return true;
  return config.operatingDays.includes(date.getDay());
}

/**
 * Check if time is within operating hours.
 */
function isWithinHours(date: Date, config: BusinessHoursConfig): boolean {
  const hour = date.getHours();
  return hour >= config.openHour && hour < config.closeHour;
}

/**
 * Check if booking has sufficient lead time.
 * Returns true if the booking time is at least minLeadHours in the future.
 */
function hasSufficientLeadTime(bookingDate: Date, now: Date, config: BusinessHoursConfig): boolean {
  const diffMs = bookingDate.getTime() - now.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= config.minLeadHours;
}

/**
 * Check if same-day booking is allowed and within cutoff.
 */
function isSameDayAllowed(bookingDate: Date, now: Date, config: BusinessHoursConfig): { allowed: boolean; reason: string | null } {
  if (!config.allowSameDay) {
    return { allowed: false, reason: '恕不接受即日預約，需提前至少一日預約。' };
  }

  const isSameDay = bookingDate.toDateString() === now.toDateString();
  if (!isSameDay) {
    return { allowed: true, reason: null };
  }

  if (config.sameDayCutoffHour !== undefined && now.getHours() >= config.sameDayCutoffHour) {
    return {
      allowed: false,
      reason: `即日預約已截單（${config.sameDayCutoffHour}:00 前截止），請改約其他日子。`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Get weekday name in Chinese.
 */
function getWeekdayName(day: number): string {
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return `星期${names[day]}`;
}

/**
 * Main validation function.
 * Checks business rules and returns whether booking needs human confirmation.
 */
export function validateBookingRules(
  draft: BookingDraft,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
  now: Date = new Date(),
): ValidationResult {
  // If date or time not set, can't validate yet — return valid
  if (!draft.date || !draft.time) {
    return {
      valid: true,
      reason: null,
      suggestion: null,
      failureType: 'none',
    };
  }

  const [year, month, day] = draft.date.split('-').map(Number);
  const [hour, minute] = draft.time.split(':').map(Number);
  const bookingDate = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Check 1: Operating day
  if (!isOperatingDay(bookingDate, config)) {
    const dayName = getWeekdayName(bookingDate.getDay());
    const operatingDayNames = config.operatingDays.map(getWeekdayName).join('、');
    return {
      valid: false,
      reason: `抱歉，${dayName}為非營業日。本店營業日為 ${operatingDayNames}。`,
      suggestion: `請選擇營業日預約。`,
      failureType: 'non_operating_day',
    };
  }

  // Check 2: Within operating hours
  if (!isWithinHours(bookingDate, config)) {
    return {
      valid: false,
      reason: `抱歉，營業時間為 ${config.openHour}:00 至 ${config.closeHour}:00。`,
      suggestion: `請選擇營業時間內的時段。`,
      failureType: 'outside_hours',
    };
  }

  // Check 3: Same-day restrictions
  const sameDayCheck = isSameDayAllowed(bookingDate, now, config);
  if (!sameDayCheck.allowed) {
    return {
      valid: false,
      reason: sameDayCheck.reason,
      suggestion: `請改約其他日子。`,
      failureType: 'same_day_restricted',
    };
  }

  // Check 4: Minimum lead time
  if (!hasSufficientLeadTime(bookingDate, now, config)) {
    const minHours = config.minLeadHours;
    return {
      valid: false,
      reason: `抱歉，需提前至少 ${minHours} 小時預約。`,
      suggestion: `請選擇較後嘅時間。`,
      failureType: 'insufficient_lead_time',
    };
  }

  return {
    valid: true,
    reason: null,
    suggestion: null,
    failureType: 'none',
  };
}

/**
 * Generate a human-friendly validation message.
 * Used when we want to inform user about rule violation before handoff.
 */
export function formatValidationMessage(result: ValidationResult): string {
  if (result.valid) return '';

  const base = result.reason || '此預約需要同事確認。';
  if (result.suggestion) {
    return `${base}\n\n${result.suggestion}`;
  }
  return base;
}

// ── Regression Tests ─────────────────────────────────────────────────────────

export function verifyBusinessRuleValidatorRegression(): { ok: boolean; failures: string[] } {
  const failures: string[] = [];

  const config: BusinessHoursConfig = {
    operatingDays: [1, 2, 3, 4, 5], // Mon-Fri
    openHour: 10,
    closeHour: 19,
    minLeadHours: 2,
    allowSameDay: true,
    sameDayCutoffHour: 16,
  };

  // Monday 2026-03-30 at 15:00 (valid)
  const validDraft: BookingDraft = {
    serviceName: 'test',
    serviceDisplayName: 'Test',
    date: '2026-03-30', // Monday
    time: '15:00',
    customerName: 'Test',
    phone: '12345678',
  };

  // Test on Sunday 2026-03-29 at 14:00 (before Monday 15:00)
  const now = new Date(2026, 2, 29, 14, 0, 0);

  // Test 1: Valid booking (Mon 15:00)
  const r1 = validateBookingRules(validDraft, config, now);
  if (!r1.valid) {
    failures.push(`Test 1: Mon 15:00 should be valid, got: ${r1.reason}`);
  }

  // Test 2: Non-operating day (Sunday)
  const sunDraft: BookingDraft = { ...validDraft, date: '2026-03-29' }; // Sunday
  const r2 = validateBookingRules(sunDraft, config, now);
  if (r2.valid) {
    failures.push('Test 2: Sunday should fail (non-operating day)');
  }
  if (!r2.reason?.includes('非營業日')) {
    failures.push(`Test 2: Expected non-operating day message, got: ${r2.reason}`);
  }

  // Test 3: Outside hours (20:00)
  const lateDraft: BookingDraft = { ...validDraft, time: '20:00' };
  const r3 = validateBookingRules(lateDraft, config, now);
  if (r3.valid) {
    failures.push('Test 3: 20:00 should fail (outside hours)');
  }
  if (!r3.reason?.includes('營業時間')) {
    failures.push(`Test 3: Expected hours message, got: ${r3.reason}`);
  }

  // Test 4: Insufficient lead time (same day, only 1 hour ahead)
  // Use 2026-03-30 (Monday) which is an operating day
  const shortLeadNow = new Date(2026, 2, 30, 14, 0, 0); // Mon 14:00
  const shortLeadDraft: BookingDraft = { ...validDraft, date: '2026-03-30', time: '15:00' }; // Mon 15:00 (only 1 hour ahead)
  const r4 = validateBookingRules(shortLeadDraft, config, shortLeadNow);
  if (r4.valid) {
    failures.push('Test 4: 1-hour lead time should fail');
  }
  if (!r4.reason?.includes('提前')) {
    failures.push(`Test 4: Expected lead time message, got: ${r4.reason}`);
  }

  // Test 5: Same-day cutoff (after 16:00, trying to book same day)
  // Use same day (Monday) but after cutoff time
  const lateNow = new Date(2026, 2, 30, 16, 30, 0); // Mon 16:30
  const sameDayDraft: BookingDraft = { ...validDraft, date: '2026-03-30', time: '18:00' }; // Mon 18:00
  const r5 = validateBookingRules(sameDayDraft, config, lateNow);
  if (r5.valid) {
    failures.push('Test 5: Same-day after cutoff should fail');
  }
  if (!r5.reason?.includes('截單')) {
    failures.push(`Test 5: Expected cutoff message, got: ${r5.reason}`);
  }

  // Test 6: No date/time set (valid - can't check yet)
  const emptyDraft: BookingDraft = { ...validDraft, date: null, time: null };
  const r6 = validateBookingRules(emptyDraft, config, now);
  if (!r6.valid) {
    failures.push('Test 6: Empty draft should be valid (pending)');
  }

  return { ok: failures.length === 0, failures };
}