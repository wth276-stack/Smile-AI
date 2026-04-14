/**
 * Comprehensive booking flow test suite
 * Tests session cutoff, date parsing, slot persistence, and edge cases
 *
 * Run all: npx tsx scripts/test-session-cutoff.ts
 * Run one:  npx tsx scripts/test-session-cutoff.ts --test=10
 * Subset:   npx tsx scripts/test-session-cutoff.ts --test=9,10
 * Throttle: npx tsx scripts/test-session-cutoff.ts --test=9 --delay-ms=2000
 * (--test matches numeric id or a case-insensitive substring of the test label, e.g. "TEST 10")
 * (--delay-ms waits that many ms after each successful chat request; default 0)
 *
 * NOTE: Date assertions assume run date = EXPECTED_RUN_DATE below.
 * Relative-date tests (聽日, 大後日, 星期X) will give wrong expected values on other days.
 *
 * Manual Check D (stale-confirmation escape — do not wipe modify flow):
 * While bot shows booking confirmation summary, send: 「唔正確，我想改時間」
 * Expected: draft kept; bot enters modify flow (asks what to change).
 * NOT expected: draft cleared as if new chat.
 */

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const TENANT = 'demo-tenant';

// ─── HKT-aware date helpers ───

function getHKTDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
}

function addDaysHelper(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function formatMonthDay(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * Next occurrence of a weekday (1=Mon … 6=Sat, 0=Sun).
 * If today IS that weekday, returns next week's occurrence.
 */
function getNextWeekday(base: Date, jsDay: number): Date {
  const current = base.getDay();
  let diff = jsDay - current;
  if (diff <= 0) diff += 7;
  return addDaysHelper(base, diff);
}

/**
 * "下星期X" in Cantonese: the X-day in the week starting next Monday.
 */
function getNextWeekXDay(base: Date, jsDay: number): Date {
  const current = base.getDay();
  const daysUntilNextMon = ((1 - current + 7) % 7) || 7;
  const nextMon = addDaysHelper(base, daysUntilNextMon);
  const offset = ((jsDay - 1 + 7) % 7);
  return addDaysHelper(nextMon, offset);
}

interface ApiResponse {
  reply: string;
  conversationId: string;
}

interface TestResult {
  name: string;
  passed: boolean;
  details: string[];
  warnings: string[];
  turns: Array<{ user: string; bot: string; durationMs: number }>;
}

const results: TestResult[] = [];

/** Set in main(); applied after each successful sendMessage (runner-only, reduces local API throttling). */
let runnerDelayBetweenRequestsMs = 0;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Test-runner only: one retry after 5–10s wait on HTTP 429 (does not change API behavior). */
async function sendMessage(
  message: string,
  conversationId?: string,
): Promise<ApiResponse & { durationMs: number }> {
  const body: Record<string, string> = { tenantSlug: TENANT, message };
  if (conversationId) body.conversationId = conversationId;

  const start = Date.now();

  const doFetch = () =>
    fetch(`${API_BASE}/api/chat/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  let res = await doFetch();
  if (res.status === 429) {
    const backoffMs = 5000 + Math.floor(Math.random() * 5000);
    console.warn(`  [runner] API 429 — waiting ${backoffMs}ms then retrying once...`);
    await sleep(backoffMs);
    res = await doFetch();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as ApiResponse;
  const out = { ...data, durationMs: Date.now() - start };

  if (runnerDelayBetweenRequestsMs > 0) {
    await sleep(runnerDelayBetweenRequestsMs);
  }

  return out;
}

// ─── Test Helpers ───

/** Collapse whitespace, full-width punctuation for formatting-tolerant comparison. */
function normalizeText(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/：/g, ':')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .trim();
}

function assertIncludes(reply: string, expected: string, label: string): string | null {
  if (reply.includes(expected)) return null;
  return `${label}: expected reply to include "${expected}" but got: "${reply.slice(0, 160)}"`;
}

/** Spacing-tolerant include check. Use for dates only (e.g. "4月16日" vs "4 月 16 日"). */
function assertIncludesNormalized(reply: string, expected: string, label: string): string | null {
  if (normalizeText(reply).includes(normalizeText(expected))) return null;
  return `${label}: expected normalized reply to include "${expected}" but got: "${reply.slice(0, 160)}"`;
}

function assertNotIncludes(reply: string, forbidden: string, label: string): string | null {
  if (!reply.includes(forbidden)) return null;
  return `${label}: reply should NOT include "${forbidden}" but does: "${reply.slice(0, 160)}"`;
}

function assertNotRegex(reply: string, pattern: RegExp, label: string): string | null {
  if (!pattern.test(reply)) return null;
  return `${label}: reply matched forbidden pattern ${pattern}: "${reply.slice(0, 160)}"`;
}

const ASKS_FOR_SERVICE_RE =
  /想預約的服務是什麼|請問你想預約什麼服務|請問你想預約邊個療程|想做邊個療程|想預約的服務|預約什麼服務|請問你想做什麼|你想預約哪/;
const FABRICATED_DEPOSIT_RE = /一定要訂金|必須先付|所有預約都需要訂金/;

/** TEST 7: after user confirms (好), bot must not fall back into slot collection. */
const ASKS_FOR_REQUIRED_SLOT_AFTER_CONFIRM_RE =
  /請問你的名字|請問您的名字|請問你叫什麼名字|請提供姓名|請提供你的姓名|請提供你的名字|請提供名字和電話|請提供你的名字和電話|請問你的聯絡電話|請提供電話|請提供你的電話|請問你想預約|請問日期|請問時間/;

/** TEST 7: “確認預約” embedded in a collection / hedging sentence — not true submit success. */
const FAKE_CONFIRMATION_COLLECTION_RE =
  /請問.*確認預約|以便.*確認預約|幫.*確認預約的詳細資料|確認預約.*請提供/;

/** TEST 7: final reply after confirm must read like real submit-success, not generic 確認預約 substring. */
const LOOKS_LIKE_SUCCESSFUL_SUBMIT_RE =
  /已經幫.*確認預約|預約成功|已幫你確認|已為你確認|期待.*光臨|期待見到你|期待見到您/;

// ─── TEST 1: Basic booking flow (clean conversation) ───

async function testBasicBookingFlow(): Promise<TestResult> {
  const name = 'TEST 1: Basic IPL booking flow (clean conversation)';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    // Turn 1: Start booking
    const t1 = await sendMessage('想預約 IPL');
    turns.push({ user: '想預約 IPL', bot: t1.reply, durationMs: t1.durationMs });
    const convId = t1.conversationId;

    const e1 = assertIncludes(t1.reply, 'IPL', 'T1 service');
    if (e1) details.push(e1);
    const e1b = assertNotIncludes(t1.reply, 'HIFU', 'T1 no HIFU');
    if (e1b) details.push(e1b);

    // Turn 2: Date + Time
    const t2 = await sendMessage('星期四 3點', convId);
    turns.push({ user: '星期四 3點', bot: t2.reply, durationMs: t2.durationMs });

    const expectedThursday = formatMonthDay(getNextWeekday(getHKTDate(), 4));
    const e2a = assertIncludesNormalized(t2.reply, expectedThursday, 'T2 date (星期四)');
    if (e2a) details.push(e2a);
    const e2c = assertNotIncludes(t2.reply, 'HIFU', 'T2 no HIFU');
    if (e2c) details.push(e2c);

    // Turn 3: Name
    const t3 = await sendMessage('陳小姐', convId);
    turns.push({ user: '陳小姐', bot: t3.reply, durationMs: t3.durationMs });

    // Turn 4: Phone
    const t4 = await sendMessage('91234567', convId);
    turns.push({ user: '91234567', bot: t4.reply, durationMs: t4.durationMs });

    const e4a = assertIncludes(t4.reply, 'IPL', 'T4 service preserved');
    if (e4a) details.push(e4a);
    const e4b = assertIncludes(t4.reply, '91234567', 'T4 phone in summary');
    if (e4b) details.push(e4b);

    // Turn 5: Confirm
    const t5 = await sendMessage('好', convId);
    turns.push({ user: '好', bot: t5.reply, durationMs: t5.durationMs });

    const e5 = assertIncludes(t5.reply, '確認', 'T5 booking confirmed');
    if (e5) {
      // Also accept 預約 as confirmation wording
      const e5b = assertIncludes(t5.reply, '預約', 'T5 booking alt');
      if (e5b) details.push(e5);
    }

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST 2: Session cutoff (new booking after completed booking) ───

async function testSessionCutoff(): Promise<TestResult> {
  const name = 'TEST 2: Session cutoff — new HIFU booking after completed IPL';
  const details: string[] = [];
  const warnings: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    // First complete an IPL booking
    const t1 = await sendMessage('想預約 IPL');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 IPL', bot: t1.reply, durationMs: t1.durationMs });

    const t2 = await sendMessage('聽日 下午2點', convId);
    turns.push({ user: '聽日 下午2點', bot: t2.reply, durationMs: t2.durationMs });

    const t3 = await sendMessage('李先生 98765432', convId);
    turns.push({ user: '李先生 98765432', bot: t3.reply, durationMs: t3.durationMs });

    const t4 = await sendMessage('確認', convId);
    turns.push({ user: '確認', bot: t4.reply, durationMs: t4.durationMs });

    await sleep(500);

    // NOW: Start a new booking for HIFU in the SAME conversation
    const t5 = await sendMessage('想預約 HIFU', convId);
    turns.push({ user: '想預約 HIFU (same conv)', bot: t5.reply, durationMs: t5.durationMs });

    const e5a = assertIncludes(t5.reply, 'HIFU', 'T5 should mention HIFU');
    if (e5a) details.push(e5a);
    const e5b = assertNotIncludes(t5.reply, 'IPL', 'T5 should NOT mention IPL');
    if (e5b) details.push(e5b);
    // Contact-level name reuse is acceptable — warn only, not hard fail
    if (t5.reply.includes('李先生')) {
      warnings.push('T5: contact-level name "李先生" reused (not a history leak, from Contact record)');
    }
    const e5d = assertNotIncludes(t5.reply, '98765432', 'T5 no old phone leak');
    if (e5d) details.push(e5d);

    // Continue the new HIFU booking
    const t6 = await sendMessage('星期六 11點', convId);
    turns.push({ user: '星期六 11點', bot: t6.reply, durationMs: t6.durationMs });

    const e6a = assertIncludes(t6.reply, 'HIFU', 'T6 service stays HIFU');
    if (e6a) details.push(e6a);
    const e6b = assertNotIncludes(t6.reply, 'IPL', 'T6 no IPL contamination');
    if (e6b) details.push(e6b);
    const expectedSaturday = formatMonthDay(getNextWeekday(getHKTDate(), 6));
    const e6c = assertIncludesNormalized(t6.reply, expectedSaturday, `T6 星期六=${expectedSaturday}`);
    if (e6c) details.push(e6c);

    return { name, passed: details.length === 0, details, warnings, turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings, turns };
  }
}

// ─── TEST 3: Date parsing — various formats ───

async function testDateParsing(): Promise<TestResult> {
  const name = 'TEST 3: Date parsing accuracy';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    // 3a: 聽日
    const t1 = await sendMessage('想預約 Botox');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 Botox', bot: t1.reply, durationMs: t1.durationMs });

    const today = getHKTDate();
    const expectedTomorrow = formatMonthDay(addDaysHelper(today, 1));
    const expectedDayAfterTomorrow = formatMonthDay(addDaysHelper(today, 2));
    const expectedThreeDays = formatMonthDay(addDaysHelper(today, 3));
    const expectedNextMonday = formatMonthDay(getNextWeekXDay(today, 1));

    const t2 = await sendMessage('聽日', convId);
    turns.push({ user: '聽日', bot: t2.reply, durationMs: t2.durationMs });
    const e2 = assertIncludesNormalized(t2.reply, expectedTomorrow, `T2 聽日=${expectedTomorrow}`);
    if (e2) details.push(e2);

    // 3b: New conv for 大後日
    const t3 = await sendMessage('想預約 IPL');
    const convId2 = t3.conversationId;
    turns.push({ user: '想預約 IPL (new conv)', bot: t3.reply, durationMs: t3.durationMs });

    const t4 = await sendMessage('大後日', convId2);
    turns.push({ user: '大後日', bot: t4.reply, durationMs: t4.durationMs });
    const e4 = assertIncludesNormalized(t4.reply, expectedThreeDays, `T4 大後日=${expectedThreeDays} (+3 days)`);
    if (e4) details.push(e4);

    // 3c: New conv for 後日
    const t5 = await sendMessage('想預約 HIFU');
    const convId3 = t5.conversationId;
    turns.push({ user: '想預約 HIFU (new conv)', bot: t5.reply, durationMs: t5.durationMs });

    const t6 = await sendMessage('後日', convId3);
    turns.push({ user: '後日', bot: t6.reply, durationMs: t6.durationMs });
    const e6 = assertIncludesNormalized(t6.reply, expectedDayAfterTomorrow, `T6 後日=${expectedDayAfterTomorrow} (+2 days)`);
    if (e6) details.push(e6);

    // 3d: New conv for 下星期一
    const t7 = await sendMessage('想預約 Botox');
    const convId4 = t7.conversationId;
    turns.push({ user: '想預約 Botox (new conv)', bot: t7.reply, durationMs: t7.durationMs });

    const t8 = await sendMessage('下星期一', convId4);
    turns.push({ user: '下星期一', bot: t8.reply, durationMs: t8.durationMs });
    const e8 = assertIncludesNormalized(t8.reply, expectedNextMonday, `T8 下星期一=${expectedNextMonday}`);
    if (e8) details.push(e8);

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST 4: Combined date+time in single message ───

async function testCombinedDateTime(): Promise<TestResult> {
  const name = 'TEST 4: Combined date+time in single message';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    const t1 = await sendMessage('想預約 IPL');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 IPL', bot: t1.reply, durationMs: t1.durationMs });

    const t2 = await sendMessage('15號3點', convId);
    turns.push({ user: '15號3點', bot: t2.reply, durationMs: t2.durationMs });

    // "15號" is an absolute day-of-month reference; expected to resolve to 15th of the current (or next) month
    const hkt = getHKTDate();
    const day15 = new Date(hkt.getFullYear(), hkt.getMonth(), 15);
    if (day15.getDate() !== 15 || day15 < new Date(hkt.getFullYear(), hkt.getMonth(), hkt.getDate())) {
      day15.setMonth(day15.getMonth() + 1);
    }
    const expected15 = formatMonthDay(day15);
    const e2a = assertIncludesNormalized(t2.reply, expected15, `T2 15號=${expected15}`);
    if (e2a) details.push(e2a);

    const e2b = assertNotIncludes(t2.reply, `${hkt.getMonth() + 1}月3日`, 'T2 no date/time swap');
    if (e2b) details.push(e2b);

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST 5: Name + phone in single message ───

async function testNamePhoneCombined(): Promise<TestResult> {
  const name = 'TEST 5: Name + phone in single message';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    const t1 = await sendMessage('想預約 HIFU');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 HIFU', bot: t1.reply, durationMs: t1.durationMs });

    const t2 = await sendMessage('聽日 下午3點', convId);
    turns.push({ user: '聽日 下午3點', bot: t2.reply, durationMs: t2.durationMs });

    const t3 = await sendMessage('王小姐 95551234', convId);
    turns.push({ user: '王小姐 95551234', bot: t3.reply, durationMs: t3.durationMs });

    // Should go straight to confirmation since all slots filled
    const hasConfirm = t3.reply.includes('確認') || t3.reply.includes('HIFU');
    if (!hasConfirm) {
      details.push('T3: Expected confirmation summary after name+phone, got: ' + t3.reply.slice(0, 100));
    }

    const e3a = assertIncludes(t3.reply, 'HIFU', 'T3 service preserved');
    if (e3a) details.push(e3a);

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST 6: No slot loop (date/time not re-asked) ───

async function testNoSlotLoop(): Promise<TestResult> {
  const name = 'TEST 6: No slot loop — bot does not re-ask date/time after filling';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    const t1 = await sendMessage('想預約 IPL');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 IPL', bot: t1.reply, durationMs: t1.durationMs });

    const t2 = await sendMessage('星期四', convId);
    turns.push({ user: '星期四', bot: t2.reply, durationMs: t2.durationMs });

    const t3 = await sendMessage('3點', convId);
    turns.push({ user: '3點', bot: t3.reply, durationMs: t3.durationMs });

    // After giving time, bot should ask for name, NOT re-ask date
    const asksDate = /什麼日期|幾時|哪一天|想約幾號|想預約的日期/.test(t3.reply);
    if (asksDate) {
      details.push('T3: Bot re-asked for date after time was already provided: ' + t3.reply.slice(0, 100));
    }

    const t4 = await sendMessage('張先生', convId);
    turns.push({ user: '張先生', bot: t4.reply, durationMs: t4.durationMs });

    // After giving name, bot should ask for phone, NOT re-ask date or time
    const asksDateAgain = /什麼日期|幾時|哪一天|想約幾號|想預約的日期|什麼時候/.test(t4.reply);
    if (asksDateAgain) {
      details.push('T4: Bot re-asked for date/time after name provided: ' + t4.reply.slice(0, 100));
    }

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST 7: Rapid-fire stress test (3 full bookings back-to-back) ───

async function testStressBackToBack(): Promise<TestResult> {
  const name = 'TEST 7: Stress — 3 full bookings in same conversation';
  const details: string[] = [];
  const warnings: string[] = [];
  const turns: TestResult['turns'] = [];
  const services = ['IPL', 'HIFU', 'Botox'];
  const names = ['測試1', '測試2', '測試3'];
  const phones = ['90001234', '91001234', '92001234'];

  try {
    let convId: string | undefined;

    for (let i = 0; i < 3; i++) {
      const svc = services[i];
      const custName = names[i];
      const custPhone = phones[i];

      // T1: Start booking
      const t1 = await sendMessage(`想預約 ${svc}`, convId);
      if (!convId) convId = t1.conversationId;
      turns.push({ user: `想預約 ${svc}`, bot: t1.reply, durationMs: t1.durationMs });

      if (i > 0) {
        const e = assertNotIncludes(t1.reply, services[i - 1], `Booking ${i + 1} T1: prev service leak`);
        if (e) details.push(e);
      }

      // T2: Date + Time
      const t2 = await sendMessage('聽日 下午3點', convId);
      turns.push({ user: '聽日 下午3點', bot: t2.reply, durationMs: t2.durationMs });

      // T3: Name + Phone
      const t3 = await sendMessage(`${custName} ${custPhone}`, convId);
      turns.push({ user: `${custName} ${custPhone}`, bot: t3.reply, durationMs: t3.durationMs });

      // ── Strict assertions on T3 reply (the slot-filling completion step) ──

      // Must NOT re-ask for service after name+phone — that's a slot regression
      const svcAsk = assertNotRegex(t3.reply, ASKS_FOR_SERVICE_RE, `Booking ${i + 1} T3: re-asks service`);
      if (svcAsk) details.push(svcAsk);

      // Must NOT leak a previous booking's name
      for (let prev = 0; prev < i; prev++) {
        const prevName = names[prev];
        const leak = assertNotIncludes(t3.reply, prevName, `Booking ${i + 1} T3: old name "${prevName}" leak`);
        if (leak) details.push(leak);
      }

      // Service should be preserved before confirmation
      if (!t3.reply.includes(svc)) {
        details.push(`Booking ${i + 1} T3: service "${svc}" disappeared from reply: "${t3.reply.slice(0, 160)}"`);
      }

      // Final confirmation turn — must submit successfully, not re-ask for slots (esp. booking 3)
      let finalConfirmReply: string;
      if (t3.reply.includes('確認') || t3.reply.includes(svc)) {
        const t4 = await sendMessage('好', convId);
        turns.push({ user: '好', bot: t4.reply, durationMs: t4.durationMs });
        finalConfirmReply = t4.reply;
      } else {
        const t3b = await sendMessage('確認', convId);
        turns.push({ user: '確認', bot: t3b.reply, durationMs: t3b.durationMs });
        finalConfirmReply = t3b.reply;
      }

      const slotAfterConfirm = assertNotRegex(
        finalConfirmReply,
        ASKS_FOR_REQUIRED_SLOT_AFTER_CONFIRM_RE,
        `Booking ${i + 1} after confirm: re-asks slot / collection`,
      );
      if (slotAfterConfirm) details.push(slotAfterConfirm);

      const fakeConfirm = assertNotRegex(
        finalConfirmReply,
        FAKE_CONFIRMATION_COLLECTION_RE,
        `Booking ${i + 1} after confirm: fake confirmation / collection wording`,
      );
      if (fakeConfirm) details.push(fakeConfirm);

      if (!LOOKS_LIKE_SUCCESSFUL_SUBMIT_RE.test(finalConfirmReply)) {
        details.push(
          `Booking ${i + 1} after confirm: expected real submit-success (已經幫…確認預約 / 期待見到你 / …): "${finalConfirmReply.slice(0, 160)}"`,
        );
      }

      await sleep(300);
    }

    return { name, passed: details.length === 0, details, warnings, turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings, turns };
  }
}

// ─── TEST 8: Service preservation through multiple turns ───

async function testServicePreservation(): Promise<TestResult> {
  const name = 'TEST 8: Service name preserved across all turns (IPL never becomes HIFU)';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    const t1 = await sendMessage('想預約 IPL');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 IPL', bot: t1.reply, durationMs: t1.durationMs });

    const msgs = ['星期四', '下午3點', '我叫May', '98765432'];
    for (const msg of msgs) {
      const t = await sendMessage(msg, convId);
      turns.push({ user: msg, bot: t.reply, durationMs: t.durationMs });

      const hasHIFU = t.reply.includes('HIFU');
      if (hasHIFU) {
        details.push(`Service switched to HIFU on message "${msg}": ${t.reply.slice(0, 100)}`);
      }
    }

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST 9: Long conversation + FAQ grounding + booking survivability ───

async function testRecentMessagesOrder(): Promise<TestResult> {
  const name = 'TEST 9: Long conversation — FAQ grounding + booking after 25+ msgs';
  const details: string[] = [];
  const warnings: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    const t1 = await sendMessage('你好');
    const convId = t1.conversationId;
    turns.push({ user: '你好', bot: t1.reply, durationMs: t1.durationMs });

    // Send several filler messages
    const fillers = [
      '有咩服務', '幾錢', '邊個最平', '有冇優惠',
      'Botox 有冇副作用', '營業時間', '點預約',
    ];
    for (const msg of fillers) {
      const t = await sendMessage(msg, convId);
      turns.push({ user: msg, bot: t.reply, durationMs: t.durationMs });
    }

    // ── FAQ grounding check 1: IPL 係咩 ──
    const tIplFaq = await sendMessage('IPL 係咩', convId);
    turns.push({ user: 'IPL 係咩', bot: tIplFaq.reply, durationMs: tIplFaq.durationMs });

    const iplKeywords = ['改善色斑', '均勻膚色', '收細毛孔', '減淡細紋', '彩光', '嫩膚', 'IPL'];
    const iplGrounded = iplKeywords.some((kw) => tIplFaq.reply.includes(kw));
    if (!iplGrounded) {
      details.push(`IPL FAQ: reply lacks IPL-related keywords: "${tIplFaq.reply.slice(0, 160)}"`);
    }

    // ── FAQ grounding check 2: 要唔要訂金 ──
    const tDeposit = await sendMessage('要唔要訂金', convId);
    turns.push({ user: '要唔要訂金', bot: tDeposit.reply, durationMs: tDeposit.durationMs });

    const fabricated = assertNotRegex(tDeposit.reply, FABRICATED_DEPOSIT_RE, 'Deposit FAQ: fabricated policy');
    if (fabricated) details.push(fabricated);
    // TODO: if reply invents a specific dollar amount not in KB, add a warning here

    // More fillers to push past 20 messages
    for (const msg of ['仲有咩', '多謝']) {
      const t = await sendMessage(msg, convId);
      turns.push({ user: msg, bot: t.reply, durationMs: t.durationMs });
    }

    // ── Booking after long conversation ──
    const tBook = await sendMessage('想預約 IPL 聽日 下午2點', convId);
    turns.push({ user: '想預約 IPL 聽日 下午2點', bot: tBook.reply, durationMs: tBook.durationMs });

    const hasIPL = tBook.reply.includes('IPL');
    if (!hasIPL) {
      details.push('Booking turn: IPL not mentioned, likely history issue: ' + tBook.reply.slice(0, 160));
    }

    return { name, passed: details.length === 0, details, warnings, turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings, turns };
  }
}

// ─── TEST 10: Edge case — "我個名係May" should NOT trigger SUBMIT ───

async function testNameNotTriggerSubmit(): Promise<TestResult> {
  const name = 'TEST 10: "我個名係May" does NOT trigger SUBMIT_BOOKING';
  const details: string[] = [];
  const turns: TestResult['turns'] = [];

  try {
    const t1 = await sendMessage('想預約 IPL');
    const convId = t1.conversationId;
    turns.push({ user: '想預約 IPL', bot: t1.reply, durationMs: t1.durationMs });

    const t2 = await sendMessage('星期四 3點', convId);
    turns.push({ user: '星期四 3點', bot: t2.reply, durationMs: t2.durationMs });

    const t3 = await sendMessage('我個名係May', convId);
    turns.push({ user: '我個名係May', bot: t3.reply, durationMs: t3.durationMs });

    // Should ask for phone, NOT say booking confirmed
    const wrongSubmit = /已經幫你確認預約|已幫你預約|booking.*confirmed/i.test(t3.reply);
    if (wrongSubmit) {
      details.push('T3: "我個名係May" wrongly triggered SUBMIT: ' + t3.reply.slice(0, 100));
    }

    return { name, passed: details.length === 0, details, warnings: [], turns };
  } catch (err) {
    details.push(`Error: ${(err as Error).message}`);
    return { name, passed: false, details, warnings: [], turns };
  }
}

// ─── TEST REGISTRY (id + label for --test filter; test bodies unchanged) ───

type TestEntry = { id: number; label: string; run: () => Promise<TestResult> };

const TEST_SUITE: TestEntry[] = [
  { id: 1, label: 'TEST 1: Basic IPL booking flow (clean conversation)', run: testBasicBookingFlow },
  { id: 2, label: 'TEST 2: Session cutoff — new HIFU booking after completed IPL', run: testSessionCutoff },
  { id: 3, label: 'TEST 3: Date parsing accuracy', run: testDateParsing },
  { id: 4, label: 'TEST 4: Combined date+time in single message', run: testCombinedDateTime },
  { id: 5, label: 'TEST 5: Name + phone in single message', run: testNamePhoneCombined },
  { id: 6, label: 'TEST 6: No slot loop — bot does not re-ask date/time after filling', run: testNoSlotLoop },
  { id: 7, label: 'TEST 7: Stress — 3 full bookings in same conversation', run: testStressBackToBack },
  { id: 8, label: 'TEST 8: Service name preserved across all turns (IPL never becomes HIFU)', run: testServicePreservation },
  { id: 9, label: 'TEST 9: Long conversation — FAQ grounding + booking after 25+ msgs', run: testRecentMessagesOrder },
  { id: 10, label: 'TEST 10: "我個名係May" does NOT trigger SUBMIT_BOOKING', run: testNameNotTriggerSubmit },
];

function parseTestFilterArg(argv: string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith('--test=')) return arg.slice('--test='.length);
  }
  return null;
}

function parseDelayMsArg(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith('--delay-ms=')) {
      const n = parseInt(arg.slice('--delay-ms='.length), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return 0;
}

function matchesTestFilter(entry: TestEntry, part: string): boolean {
  const p = part.trim();
  if (!p) return false;
  if (/^\d+$/.test(p)) {
    return entry.id === parseInt(p, 10);
  }
  return entry.label.toLowerCase().includes(p.toLowerCase());
}

function selectTestsFromFilter(suite: TestEntry[], filterRaw: string | null): TestEntry[] {
  if (filterRaw == null || filterRaw.trim() === '') return suite;
  const parts = filterRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const selected = new Set<number>();
  for (const part of parts) {
    for (const entry of suite) {
      if (matchesTestFilter(entry, part)) selected.add(entry.id);
    }
  }
  return suite.filter((e) => selected.has(e.id));
}

// ─── MAIN ───

async function main() {
  results.length = 0;

  const delayMs = parseDelayMsArg(process.argv);
  runnerDelayBetweenRequestsMs = delayMs;

  const testFilter = parseTestFilterArg(process.argv);
  const tests = selectTestsFromFilter(TEST_SUITE, testFilter);
  if (testFilter != null && testFilter.trim() !== '' && tests.length === 0) {
    console.error(
      `No tests matched --test="${testFilter}". Use --test=1..10 or a substring of the test label (e.g. --test=10 or --test=TEST 10).`,
    );
    process.exit(1);
  }

  console.log('='.repeat(70));
  console.log('  COMPREHENSIVE BOOKING FLOW TEST SUITE');
  console.log('  Target:', API_BASE);
  console.log('  Date: ', new Date().toISOString());
  if (testFilter != null && testFilter.trim() !== '') {
    console.log(`  Filter: --test=${testFilter} (${tests.length} test(s))`);
  }
  if (delayMs > 0) {
    console.log(`  Delay between requests: ${delayMs}ms`);
  }
  console.log('='.repeat(70));

  const hktToday = getHKTDate();
  const hktDateStr = `${hktToday.getFullYear()}-${String(hktToday.getMonth() + 1).padStart(2, '0')}-${String(hktToday.getDate()).padStart(2, '0')}`;
  console.log(`  Base date (Asia/Hong_Kong): ${hktDateStr}`);
  console.log(`  聽日=${formatMonthDay(addDaysHelper(hktToday, 1))}, 後日=${formatMonthDay(addDaysHelper(hktToday, 2))}, 大後日=${formatMonthDay(addDaysHelper(hktToday, 3))}`);
  console.log('');

  for (const entry of tests) {
    console.log(`Running: ${entry.label}...`);
    const result = await entry.run();
    results.push(result);
    const icon = result.passed ? '✅' : '❌';
    console.log(`  ${icon} ${result.name}`);
    if (result.details.length > 0) {
      for (const d of result.details) console.log(`     ❌ ${d}`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.log(`     ⚠ ${w}`);
    }
    console.log('');
    await sleep(200);
  }

  // ─── REPORT ───

  console.log('\n' + '='.repeat(70));
  console.log('  TEST REPORT SUMMARY');
  console.log('='.repeat(70));

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed}\n`);

  const totalWarnings = results.reduce((n, r) => n + r.warnings.length, 0);

  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (!r.passed) {
      for (const d of r.details) console.log(`     ↳ ${d}`);
    }
    if (r.warnings.length > 0) {
      for (const w of r.warnings) console.log(`     ⚠ ${w}`);
    }
  }

  if (totalWarnings > 0) {
    console.log(`\n  ⚠ ${totalWarnings} warning(s) — not failures, but worth reviewing`);
  }

  // Detailed conversation logs
  console.log('\n' + '='.repeat(70));
  console.log('  DETAILED CONVERSATION LOGS');
  console.log('='.repeat(70));

  for (const r of results) {
    console.log(`\n── ${r.name} ──`);
    for (const t of r.turns) {
      console.log(`  [User] ${t.user}`);
      console.log(`  [Bot]  ${t.bot.slice(0, 200)}${t.bot.length > 200 ? '...' : ''}`);
      console.log(`  (${t.durationMs}ms)`);
    }
  }

  // Performance stats
  console.log('\n' + '='.repeat(70));
  console.log('  PERFORMANCE STATS');
  console.log('='.repeat(70));

  const allDurations = results.flatMap((r) => r.turns.map((t) => t.durationMs));
  const avg = allDurations.reduce((a, b) => a + b, 0) / allDurations.length;
  const max = Math.max(...allDurations);
  const min = Math.min(...allDurations);
  const p95 = allDurations.sort((a, b) => a - b)[Math.floor(allDurations.length * 0.95)];

  console.log(`  Total API calls: ${allDurations.length}`);
  console.log(`  Avg latency:     ${avg.toFixed(0)}ms`);
  console.log(`  Min latency:     ${min}ms`);
  console.log(`  Max latency:     ${max}ms`);
  console.log(`  P95 latency:     ${p95}ms`);

  console.log('\n' + '='.repeat(70));
  if (failed > 0) {
    console.log(`  ❌ ${failed} TEST(S) FAILED`);
    process.exit(1);
  } else {
    console.log('  ✅ ALL TESTS PASSED');
  }
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
